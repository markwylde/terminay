# Bot triggers

Triggers belong to a bot on its owning Terminay Server. They continue running
when clients disconnect. All file watches, outbound connections and commands run
inside that bot's container as `bot`; paths and `localhost` refer to that
container. There is no inbound webhook URL and no published container port.

In **Configure > Triggers**, choose a source group and type, configure its
condition, select its offline policy, and enter the prompt. The selected event
is attached to a fresh session as labelled data. No AI provider starts for an
ordinary check that does not match.

## Sources

- **Files:** watch an absolute file or folder path, optionally recursively with
  include/exclude shell patterns. Debounce defaults to 5,000 ms. Continuous
  changes flush by 30 seconds. Missing targets wait for creation. Watches do not
  follow symbolic links and never fall back to a periodic scan.
- **Network / SSE:** connect outward to an HTTP(S) event stream, optionally
  filtering its event name. Headers are stored in the server vault and masked
  when editing. SSE comments do not start sessions.
- **Network / HTTP:** GET a URL at an interval of at least one minute. Compare
  the response body or select a JSON value. Failed responses do not replace a
  successful baseline; HTTP 304 preserves it.
- **Commands:** execute a shell script with an absolute working directory
  (default `/home/bot`). Use the tools, environment and logins installed in the
  bot. Match changed stdout, literal text, a regular expression, an exit code,
  or new JSON items. Scripts can have side effects. Checks of one trigger never
  overlap; timeout defaults to 30 seconds.
- **Time:** five-field cron in the server's local time zone, elapsed intervals
  of at least one minute, or a single date/time.

JSON selectors use JSON Pointer: the empty pointer selects the root, `/items`
selects a property and `/id` selects an identity within each item. Escape `/`
in a property name as `~1`, and `~` as `~0`. Selectors are data, not executable
expressions.

A generic command source can return:

```json
[{"id":"item-100","title":"Something to inspect"}]
```

Choose **New JSON items**, leave the items pointer blank and set identity to
`/id`. Each new identity gets its own session. First check defaults to processing
existing items; choose baseline-only to remember them without running. Missing,
updated or reappearing known identities do not count as new. The script must
fetch every relevant page itself. Terminay has no provider, forge or PR-specific
interpretation.

Changed-output sources establish their first baseline without running. Text and
exit-code matching defaults to firing when matching becomes true, including an
initially true result; enable repeat to fire on every matching check.

## Server downtime

Each time or periodic source chooses:

- **Skip missed runs:** record the gap and wait for the next regular due time.
- **Run once on return:** make one current check/run describing the gap.
- **Run each missed occurrence:** replay original due times oldest first through
  bounded admission. Replayed HTTP/command checks still read *current* state;
  they do not reconstruct earlier responses.

Continuous sources choose recover-available or ignore-gap. File recovery finds
net differences between snapshots, so it cannot recover a file created and
removed entirely offline. SSE recovery asks the service to continue from the
last accepted event ID. It needs source replay support; unidentified events
cannot be deduplicated reliably. A source gap is never proof of complete history.

The server's availability matters, not the client. A remote server can observe
24/7 while a laptop client is closed. A server running on that laptop applies
recovery when it resumes. Explicitly disabled periods do not accumulate missed
work.

## Disable and idle shutdown

**Disable bot** is a persisted pause. It stops watching and automatic admission,
blocks new manual execution until enabled, and retains definitions, observation
memory and accepted undelivered events. Already running sessions remain visible
and can be stopped separately. Enable resumes accepted work and establishes a
fresh observation boundary without catching up the deliberately disabled period.

Container **Stop** is an environment operation, not a persisted pause; enabled
triggers can start it again. Configured idle shutdown also leaves the bot enabled.
Periodic sources hold activity only during a check; future checks can wake an
idle-stopped container. Continuous file/SSE watchers keep it active, which the
editor explains. A one-minute check may naturally keep a thirty-minute-idle bot
running, whereas a six-hour check can let it sleep between checks.

## Testing, memory and failures

**Test source** executes the configured command/request or observes a stream/watch
for up to ten seconds. It shows bounded diagnostics and would-fire results,
without starting an AI session or consuming live observation memory. It can have
external side effects. **Run now** is separate: time runs directly; observation
sources make a real check and apply their conditions, so a nonmatch starts no
session and file/SSE activity is never fabricated.

Health distinguishes check attempts, last success, last firing, connection state,
retry/failure and recovery gaps. Errors expose Retry. Remembered IDs can be viewed
in pages and reset explicitly; reset can reprocess existing items. Source/condition
edits reset comparison generations, while name/prompt-only edits retain them.

Checks are bounded to 1 MiB of output/body and 32 KiB per selected event. Pending
events are bounded to 1,000 or 16 MiB per bot; remembered IDs to 100,000 per trigger
and 16 MiB per bot. Limits visibly block acceptance rather than silently evicting
work or IDs. A saturated execution queue defers accepted events. Started failed
sessions are inspected/retried explicitly: external side effects are not exactly
once. Use stable source IDs and external idempotency checks in scripts/agents.

## Upgrade and rollback

Existing time triggers retain their IDs, anchors and skip-missed policy. Existing
project-event bot definitions are retained disabled with a source replacement
message; project automations are unchanged. The new source worker is an input to
the locally built image fingerprint. An old running image must be recreated to
support new sources; the server does not fall back to host execution.

Bot state upgrades to version 2 and preserves a pre-upgrade v1 file. Unsupported
future state versions fail closed instead of rolling back through an older
previous copy. An operator rollback is an explicit restore of the pre-upgrade
state, with possible repeated external work; keep the complete current state for
inspection before restoring anything.
