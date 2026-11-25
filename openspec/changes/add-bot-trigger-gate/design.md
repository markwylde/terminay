## Context

A bot trigger firing becomes a durable pending source event (`PendingSourceEvent` in `sourceState.ts`), which snapshots the trigger's name and prompt when the firing is accepted. `BotTriggers.drain` (`packages/server-core/src/botService/triggers.ts`) turns each pending event into a session with `service.send`. Before that call, `drain` already applies the skip rules: queue full, waiting for you, an existing session, and bot busy. A skipped firing is stored with `outcome: 'skipped'` and a `reason`, which the Triggers table already shows. Pending events survive a server restart and resume dispatch.

Trigger sources run in the bot's container through `BotSourceRunner` (`sourceRunner.ts`). It execs the image's `terminay-source` worker under `terminay-run`, which drops to the `bot` user. For a `command` source the worker runs `bash -c <command>` and, when the command finishes inside its limits, returns `{stdout, stderr, exitCode}`. A timeout, output over 1 MiB or non-UTF-8 output returns an error frame with no script output. The runner starts a stopped container, reports activity, kills the process group afterwards, and classifies runs that end without a result.

The code accepts schedule, command, HTTP, SSE and files sources. It refuses project-event triggers on save ("Choose a container source"), although the canonical spec still describes them; the active `outbound-bot-triggers` change owns that source inventory. This change adds the gate to whatever sources a trigger can have and does not alter the inventory.

Decisions that constrain this design:

- ADR-0096 (status: proposed, and the contract the code follows): trigger work executes only in the owning bot's container as the bot user; the server owns definitions and admission.
- ADR-0109 and ADR-0099: Terminay reports failures as facts and the bot judges them; a bot is woken by its own failures.
- ADR-0138: another bot's inspection tools return allowlisted fields only and never trigger commands.
- ADR-0028: no polling. The gate adds none: it runs once per firing.
- ADR-0093 and ADR-0134: runtime tools are bound to their bot; trigger changes are recorded as actions.

## Goals / Non-Goals

**Goals:**

- Let any trigger, whatever its source, skip a firing cheaply and deterministically before an AI session starts.
- Record why a firing was skipped, without treating it as a failure.
- Never let a broken gate silence a trigger.
- Make bots that manage their own triggers reach for a gate by default.

**Non-Goals:**

- No gate arguments, environment configuration, per-trigger timeout, or inline script text. The gate is a path.
- No test button or `triggers_test` support for gates. A bot can run its script in its own shell.
- No gate for chat messages, failure follow-ups, or Run now.
- No change to the bot image or the `terminay-source` worker, and so no script output for a gate that times out.
- No new health state or table column for gates.
- No change to which sources a trigger may use.

## Decisions

### 1. The gate is an optional string on the trigger, snapshotted on the firing

`BotTriggerDraft` and `BotTrigger` gain `gate?: string`. Absent or empty means no gate; the server stores a non-empty gate trimmed and omits the field otherwise. Validation lives in `triggerState.ts` beside the failure settings, so the editor and the runtime tools share it: at most 4096 UTF-8 bytes, no `\n`, `\r` or NUL. A relative path is allowed and resolves against `/home/bot`, because the working directory is fixed there.

`PendingSourceEvent` gains `gate?: string`, set in `BotSourceStore.commit` from the trigger when the event's origin is `trigger`. A Run now event never carries one, which is how Run now bypasses the gate. The snapshot matches how the prompt is already handled and keeps the canonical rule that edits apply to later firings: editing a trigger never changes, restarts or cancels the gate of a firing that has already occurred. The loader validates the field as an optional string.

Alternative: read the gate from the current trigger at dispatch. Rejected: an edit between firing and dispatch would change an accepted firing, and a gate in flight would need cancelling on every edit.

Alternative: a `gate` object with command, cwd and timeout. Rejected: the owner asked for a simple path, and a script can do anything a command line could.

### 2. The gate runs in the container through the existing source runner

The server runs the gate with `sourceRunner.run(botId, {kind: 'command', …})`, using a command it builds itself:

```
g=<single-quoted path>; case "$g" in /*) ;; *) g="./$g" ;; esac
if [ -x "$g" ]; then exec "$g"; else exec bash "$g"; fi
```

with `cwd: '/home/bot'` and `timeoutMs: 30000`. The path is the only user-supplied text and is single-quoted with `'` escaped as `'\''`, so it is data, never shell syntax. Reusing the runner keeps every property the command source already has: execution as the bot user in the owning container (ADR-0096), a started container, the time limit, the output cap and process-group cleanup. It needs no image change, so the gate works on existing bots without a rebuild.

This crosses the server-to-container exec boundary that ADR-0096 governs. The gate gets no authority the bot's own command sources lack; the worker already strips `TERMINAY_RUNTIME_*` and `TERMINAY_MCP_*` from the environment.

Alternative: a new `gate` mode in `terminay-source` that returns partial output on timeout. Rejected for now: it needs an image rebuild for every bot. The cost is that a timed-out gate reports its cause without its stderr.

Alternative: run on the host. Rejected by ADR-0096.

### 3. Verdict from stdout, then exit status

After trimming white space from stdout:

| result | verdict |
| --- | --- |
| stdout has text, any exit | skip |
| stdout empty, exit 0 | open |
| stdout empty, exit non-zero | broken, with exit status and stderr |
| run threw: deadline, oversized or non-UTF-8 output, worker not executable, interrupted, engine unavailable | broken, with Terminay's reason only |
| run aborted, or the fence in decision 4 fails | none |

Stdout wins over the exit status because the owner defined the gate by its output, and a script that prints a reason and then exits non-zero has still said "do not run". A cleanup error after a result still means the run could not be completed and is broken; its stdout does not become a skip verdict. Runner error messages are credential-redacted before they are bounded.

A missing file reaches the table as bash's exit 127 with empty stdout, so it is broken with bash's own message as stderr.

### 4. Where the gate runs in `drain`, and what cancels it

The gate runs immediately before `service.send`, after the existing checks for queue capacity, waiting for you, an existing session, and bot busy, and only for an event that carries a gate. A firing that an earlier rule would skip never runs a script. Distinct accepted events may wait concurrently, as required by `outbound-bot-triggers`; an earlier queued firing does not itself skip the next firing or bypass its gate. This preserves ordinary admission for triggers with and without gates.

`open` and `broken` verdicts are kept in an in-memory map keyed by event ID until the event is delivered or skipped. `drain` can return with the event still pending (for example when `send` reports a resource limit, or the session is queued for capacity), and the next drain must reuse the verdict instead of running the script again. The map is not persisted. Pending events survive a restart, so a firing that was still pending runs its gate again afterwards; this is the one case where a gate runs twice for a firing, and the spec states it.

Each gate run has an `AbortController` registered under its trigger ID until its verdict, including asynchronous credential redaction, is complete. Cancellation during redaction also discards the verdict. It is aborted by `cancelPending` (trigger disabled or deleted, which also records the pending firing as cancelled), by bot disable, and by `stop`. An edit that keeps the trigger enabled does not abort it, because the firing carries its own gate snapshot.

When the run settles, `drain` applies a fence before acting on the result: the service is not stopped, the bot is enabled, the trigger still exists, and the event is still pending. If the fence fails, the result is discarded, nothing is cached, and `drain` moves on. An event left pending this way (bot disabled, or server stopping) runs its gate again when dispatch resumes.

`drain` handles one bot's events serially, and `drain` calls made while one is running return at once. A gate therefore holds up that bot's other pending firings, including a Run now, for the script's 30-second limit plus the runner's overhead: starting a stopped container before the script, a 5-second grace on the limit, and up to 15 seconds of cleanup after it. Those firings are delayed, not lost. So that an event accepted during a gate is not left until the next unrelated wake-up, `drain` records that it was asked to run again while the gate is running or its output is being redacted and runs once more when it finishes. It re-runs only for such a request, never merely because events remain pending, so retained events that cannot be admitted cannot cause a loop.

### 5. A gated firing reuses `skipEvent`

Skip calls the existing `skipEvent` with the reason `gate: <output>`. The output is redacted with `service.redactMessage`, then white space is collapsed and trimmed, then it is cut to 512 bytes on a character boundary. Redaction comes first, before even trimming the raw output, so that trimming, collapsing and cutting cannot alter a secret before it is matched. If redaction throws, the reason is `gate`.

`service.redactMessage` covers the bot's credentials: its sign-in secrets and runtime tokens. It does not cover the header secrets of the bot's HTTP and SSE sources, which exist only in the vault and are injected into those sources' own worker runs; a gate is never given them, so the spec promises credential redaction only.

`skipEvent` marks the event delivered, touches no health and starts no follow-up. Once triggers are already disabled when their event is accepted, and observation memory is already committed, so neither needs new code.

### 6. A broken gate fails open and tells the bot

On a broken verdict the firing continues to `service.send` under the ordinary rules. Failing open permits admission; it does not guarantee a session. If the engine is unavailable, the gate is broken and `send` then fails as it would have anyway, with the existing failed-firing record, health and follow-up.

Two things are added to the first message:

- a fixed sentence after the prompt: `Terminay note: this trigger's gate gave no verdict, so this run started anyway. Check and repair the gate; details are in the context below.`
- a `gate` object inside the existing `<untrusted-source-context>` JSON: `{ path, status: 'failed', exitCode, error, stderr? }`.

`exitCode` is the script's status, or `null` when the script did not run to completion. `error` is Terminay's own wording for the cause: a non-zero exit, the time limit, or that the gate could not be run. `stderr` is present only when the script ran to completion: its last 1 KiB, redacted before the cut, with a partial first line dropped, and omitted if redaction throws. The path and the script's output are bot-controlled text, so they travel inside the block that is already marked untrusted and escaped; only Terminay's fixed sentence sits outside it.

This follows ADR-0109: Terminay reports the fact and the bot judges and repairs. It adds no health change and no failure follow-up, because the session that started is itself the bot's chance to act, and it can report `needs-human` or `fixed` through `outcome_report`.

Alternatives, both declined by the owner: fail closed and mark the trigger failed (a broken gate silently stops a trigger until someone notices), or skip quietly.

### 7. Editor and tool guidance

`BotTriggerEditor.tsx` gets a text field labelled Gate at the end of the When section, shown for every source, with the hint: "Optional. Path to a script in {bot}'s container, run each time this trigger fires. If it prints any text, the run is skipped and the text is kept as the reason. If it prints nothing, the bot runs. Run now ignores the gate." `triggersModel.ts` carries `gate` in the form and draft, sending it only when non-empty.

In `runtimeTriggers.ts`, the draft schema gains `gate` with a description of its contract, and `parseDraft` accepts it. The `triggers_create` and `triggers_update` descriptions add the instruction to give a trigger a gate whenever a cheap script can tell that a run would have nothing to do. The bot's own `triggers_get` and `triggers_list` return the gate because they spread trigger metadata. `runtimeInspect.ts` builds other-bot views field by field (ADR-0138) and is left unchanged, so the gate is withheld there, like trigger commands.

## Risks / Trade-offs

- [A gate with side effects runs on every firing, and again after a restart or a bot re-enable] → It is the bot's own script in its own container, with the same authority as a command source. The tool description says the gate must be a cheap, read-only check.
- [A slow gate delays the bot's other firings and Run now by the script limit plus container start and cleanup] → Bounded; firings are queued, not lost.
- [A gate that always prints silences a trigger] → Every skipped firing is recorded with its reason in the Triggers table, and Run now bypasses the gate.
- [A broken gate costs an AI run each firing until fixed] → Accepted by the owner: the run tells the bot what broke.
- [A timed-out gate reports no stderr] → The cause names the time limit; the bot can run the script itself.
- [Gate output could carry a secret into the firing record] → Redacted with the bot's credentials before storage, and bounded. Other secrets a script prints are the script's responsibility, as with any command source.
- [A server older than this change reading a stored trigger with `gate`] → Trigger records are validated with an exact key list; a downgrade would report such a trigger as unsupported. Downgrade across this change is not supported for gated triggers.
- [A stopped container is started to run a gate that then skips] → Cheaper than the AI session it avoids; the container idles out as it does after any source check.

## Migration Plan

Additive. Triggers without a gate are unchanged, stored pending events without a gate load as before, and no stored data is rewritten. Rollback removes the field's handling; a trigger saved with a gate would need its gate cleared first.

## Open Questions

None.
