## Context

The current `BotTriggers` adapts `ScheduleEngine` and project `EventFanout`, tracks pending work in a process-local map keyed by trigger ID, records events in `BotStore`, and calls `BotService.send`. `runtimeTriggers.ts` exposes revision-checked same-bot management tools. `triggerState.ts`, protocol DTOs and `triggersModel.ts` assume schedule-or-project-event. `BotTriggerEditor.tsx` is a modal. `BotIdleDeadline` counts sessions, queues, shells and desktops, with no source activity. Engine `exec`/`execStream`, supervised `terminay-run` process groups, the local image build and container lifecycle already provide execution boundaries. Current work admission is four work executions plus a reserved user coordination execution, not the older single-session design still present in some historical design prose.

The affected product contracts live in the active `add-terminay-bots` deltas, not yet in main specs. This proposal modifies their exact requirement names and must archive after them. The separate `terminay-atlas-runtime-proposal` worktree is not merged and is not the baseline for this proposal; integration must preserve this source/dispatch contract if the runtime changes first.

The owner requested generic outbound sources on 2026-11-04, explicitly including command and HTTP polling every 60,000 ms, same-container execution, agent-created triggers, independent sessions per item, and per-trigger recovery after server downtime. Claude CLI supplied read-only UI advice: grouped list, adjacent editor, progressive source fields, source tests and distinct health/check/fire state. The original OAuth invocation failed; the subsequent plain `claude -p` invocation succeeded.

### ADR constraints

Review the ADR inventory by Supersedes fields, carrying forward only clauses explicitly reaffirmed by partial supersessions. The relevant live constraints are ADR-0028 (poll approval and lifecycle teardown), ADR-0003 (vault boundaries), ADR-0041 (suspension-aware liveness), ADR-0044 (bounded event-driven output), ADR-0047 (server-owned bundle), ADR-0051/0067 (terminal observation and agent launch boundaries), ADR-0072 (MCP authority), ADR-0088 (durable replace), and bot rules carried forward by ADR-0092/0093/0094/0095-claude (local socket, independent credentials, scoped tools, admission and process cleanup). Neither host credential sharing nor the superseded single-session/no-bot-tools clauses apply. The two existing `0095` filenames are distinct records; do not renumber them. The next new number is 0096.

## Goals / Non-Goals

**Goals:** Generic file, SSE, HTTP and command sources; cheap checks without AI sessions; durable conditional-event admission; clear recovery and pause semantics; same definitions through UI and authenticated bot tools; server-owned operation with or without clients.

**Non-Goals:** Inbound webhooks, hosted runners, keeping sources alive while the server is offline, Git/PR/provider integrations, host-path watches, historical reconstruction unsupported by a source, exactly-once external side effects, a new general-purpose workflow language, arbitrary JavaScript selectors or prompt interpolation, changing automation behaviour, or replacing the bot runtime in this change.

## Decisions

### D1. Server owns definitions and acceptance; sources execute in the bot container

**Boundary: server authority to container execution.** Add a small image-shipped source worker, invoked over authenticated engine exec streams as `bot` with the bot environment and working directory. Its operations are file watch/snapshot, SSE stream, HTTP GET, and supervised shell command. Use the image's existing Python 3 runtime and standard library for worker framing, HTTP and SSE; file watches use Linux inotify via a small audited adapter, and fail visibly rather than falling back to scanning on a timer. Verify this runtime/input set in the image build before shipping. There is no host command executor, host HTTP fallback, host path mount or published port. Source configuration travels through bounded stdin, never by embedding credentials in argv. Commands use `/bin/bash -c` with the script passed as a separate argument inside the container under the existing root-supervised launcher; the launcher drops to `bot`. Script text is user/agent configuration, not generated from observed values.

Server `BotSourceSupervisor` owns workers, timers and generation tokens independently of provider sessions. It validates worker frames and derives bot identity from the managed stream, never from worker-supplied IDs. A frame can supply observations, not arbitrary server operations. At most one check per trigger and four concurrent source checks per bot; excess due work waits and retains due time. Continuous file/SSE workers are bounded by the existing 50-trigger limit. File/SSE can share a per-bot transport but keep per-trigger cancellation. Shutdown/edit/delete/disable revokes generations and confirms process cleanup before replacement. Surviving workers from a server crash are reaped during reconciliation and never reconnect with ambient authority.

Alternative: server-side fetch/watch is simpler but observes the wrong filesystem/network/credentials and weakens the required environment boundary. Agent sessions for polling cost tokens and turn observations into probabilistic work. A second per-bot daemon or inbound listener adds a lifecycle/authentication boundary without benefit.

### D2. Typed source and condition definitions

**Boundary: renderer/runtime input to privileged service.** Extend protocol DTOs with discriminated source definitions and bounded validation shared by UI, tool calls and stored-state decoding. Retain stable trigger IDs, prompt and enabled state; add source generation, recovery and first-observation settings. Keep schedules in their current semantic forms; classify source presentation as Files, Network, Commands, Time. Command conditions are variants of one source, not separate executors.

Use JSON Pointer (RFC 6901 syntax, implemented locally with no executable expressions) for HTTP selection, item-array selection and per-item identity. Empty pointer means the whole document. Stable canonical JSON comparison ignores object key order while preserving array order and scalar type. New-item keys distinguish numeric and string values. Reject duplicate IDs, invalid selection and over-limit input as a whole. No partial result is committed as if complete. Text contains is literal; regex uses a bounded non-backtracking evaluator or a separately killed matcher under the source deadline, never unbounded server-thread regex evaluation. No third-party library is selected until a necessary bounded evaluator is verified against the package policy.

Proposed implementation defaults: 60-second minimum interval; 30-second check timeout (configurable 1–300 seconds); combined stdout/stderr or HTTP body at most 1 MiB; selected event payload at most 32 KiB. Over-limit selected payload fails acceptance rather than silently truncating context. Test display can truncate with a label. File debounce defaults to 5 seconds, accepts 0–60 seconds and has a 30-second maximum wait. Cap one file snapshot at 100,000 entries/16 MiB; cap one coalesced event at 1,000 paths and explicitly report omitted-path count rather than misrepresenting a full list. Scan traversals and watcher counts have explicit caps and symbolic links are not followed. These resource limits are proposed engineering defaults, not owner-provided performance measurements.

Changed-value first observations establish a baseline; initially true match conditions fire. New-item first observations process existing items by default, with baseline-only opt-in. Remembered identity removal is never inferred from absence. Source/condition edits create a new generation; prompt/name edits do not. Reset is explicit and warns about repeated item processing. Sources can trigger their own future activity; debounce/conditions and visible session origins aid diagnosis rather than pretending to prevent every feedback loop.

Alternative: arbitrary JSONPath/scripts inside the server makes evaluation and authority hard to bound. Bot scripts can do complex transformation/pagination inside the container and return a simple JSON result.

### D3. Durable acceptance before observation acknowledgement

**Boundary: external observation to durable server event/session.** Store source checkpoints, comparison memory, recovered due-time cursor and pending event records outside the disposable container filesystem. Use ADR-0088 durable-replace canonical snapshots and a serial writer, with one per-bot observation-state snapshot that commits checkpoint/memory changes and the complete accepted observation batch together. Do not use one file per event plus an unrelated checkpoint write; a crash between them would lose or duplicate work. Store redacted selected payloads only, not whole HTTP bodies, arbitrary terminal output or headers. File snapshots retain relative paths and change metadata/content fingerprints within their caps, not copies of file contents.

Event keys combine trigger ID, generation and source identity: due timestamp for time occurrences, SSE ID when supplied, remembered new-item identity, or a persisted sequence for unkeyed changes. The server acknowledges a worker only after durable acceptance. Unknown outcomes are re-observed/retried against the same generation and identity. Commit all items from one check atomically or leave its checkpoint unchanged.

Pending acceptance is a spool separate from the existing twenty-waiting-execution queue. Drain oldest events fairly across triggers into ordinary work slots without taking the reserved coordination slot. Limits: 1,000 pending events or 16 MiB pending context per bot; 100,000 remembered IDs per trigger and 16 MiB total remembered IDs per bot. At a limit, block acceptance with a visible error; do not evict IDs or lose accepted work. File/SSE sources that cannot apply backpressure without losing upstream data expose an unrecoverable gap; retry cannot claim to restore that history. Bulk replay enumerates dates lazily, never materializes an unbounded list.

Reserve a deterministic session ID and persist it with the event before calling the existing session creation/send path. Teach admission to find-or-create by that ID, so a crash after session creation but before spool acknowledgement does not create another session. A session that has started and later fails/interruption is recorded for user/agent inspection, not automatically rerun. Never claim exactly-once comments or other external side effects; scripts/agents must use source IDs and external idempotency checks for explicit retries.

Alternative: retaining the current `pending` map loses events on restart and suppresses distinct items from one trigger. Marking items seen before queue acceptance loses work on saturation. Unbounded disk queues merely move resource exhaustion.

### D4. Downtime is server-side; recovery is source-specific

**Boundary: wall-clock schedules versus live server/source lifecycle.** Persist evaluated-through and anchor state. At startup, and after a detected gap in an already scheduled wake deadline, evaluate the elapsed due range. Bot due ticks allow one second of scheduling jitter; later ticks use the selected recovery policy. Automation retains its existing tolerance. No new health timer is required. Client connection state does not participate. Do not apply missed-work policy to liveness deadlines: idle and cleanup deadlines remain suspension-aware under ADR-0041 and are rearmed rather than retroactively honoured.

Time/poll policy is `skip`, `once`, or `replay`. Skip advances past the range with a missed count; once accepts one current occurrence/check with the gap range; replay enumerates due times oldest first under spool limits, preserving a durable cursor. Defaults are skip for time triggers, once for periodic observation. A one-shot applies the same policy then disables after acceptance/skip. Repeated current command/HTTP checks are explicitly labelled as such, not snapshots from the past. A check does not overlap itself. If a live check spans another due time, the elapsed occurrence is handled by the same selected policy rather than an overlapping process.

Continuous policy is `ignore-gap` or `recover-available`, default recover-available. SSE recovery supplies the accepted Last-Event-ID; identified replays deduplicate. The server cannot generally prove an SSE endpoint honoured replay, so status records attempted continuation and any known gap, never an unfounded complete-history claim. Respect bounded server retry hints within local retry ceilings. File recovery compares a bounded stored snapshot to a fresh snapshot and emits net changes; establish watch before scan and reconcile buffered watch notifications to close scan/watch races. Transient changes may be unknowable. Ignore-gap uses a fresh baseline/cursor without dispatch for the unavailable period.

Failures/engine unavailability also create observable source gaps. Use up to five reconnect attempts with exponential delays capped at 60 seconds, then failed with Retry; regular configured poll deadlines remain the only periodic retries of periodic sources. No infinite auxiliary retry or health poll. HTTP redirects are limited to five, authentication headers never follow a change of origin, TLS verification stays enabled, and URL userinfo is refused. Only HTTP(S) source URLs are accepted.

Alternative: replay every missed poll by default wastes resources and implies history it cannot recover. Universal skip denies user-selected catch-up. Keeping container workers running beyond server lifetime creates undefined orphan authority and still cannot survive laptop sleep.

### D5. Enabled bot, sleeping container and explicit disable are different

**Boundary: durable availability versus ephemeral environment.** Add `enabled` default true to bot state, independent of environment status. Disable pauses observation/admission, cancels tests, retains definitions/checkpoints/pending accepted events and blocks manual execution until Enable; already running sessions continue until stopped. Source workers close, then ordinary idle shutdown can save resources once actual sessions/shells/desktops finish. Pending trigger spool does not hold an idle lease while disabled.

Continuous enabled sources hold activity leases. Periodic checks acquire leases only while executing; completion resets activity timing. A future due check wakes an idle-stopped container through the existing environment start path. A minute check can keep a thirty-minute-idle container running; a six-hour check need not. Explicit container Stop ends current work but is not a durable pause; show that triggers may restart it and offer Disable bot. Enable resumes accepted pre-disable events, starts enabled continuous sources, resets time boundaries and establishes observation baselines without replaying activity from deliberately disabled periods. Existing remembered item identities remain retained; the re-enable baseline adds newly present IDs without creating disabled-period events. Brand-new trigger first-observation settings remain distinct from re-enable baseline semantics.

Alternative: treating every stopped container as paused defeats power-saving wake-on-trigger; keeping all interval sources alive defeats idle shutdown.

### D6. Poll approval is narrow and explicit

**Boundary: ADR-0028 background-work policy.** Owner Mark Wylde explicitly requested HTTP and shell-command polling with a 60,000 ms example interval on 2026-11-04 and authorized this proposal after the exploration. This change records approval for enabled user/bot-defined HTTP and command source checks, default/minimum 60,000 ms and user-configurable longer intervals. Generic HTTP endpoints provide request/response without push; generic terminating CLI commands provide no universal subscription protocol. Where an SSE or file source exists, users/agents can choose those event-driven variants. No default ambient poll is created. Disable/delete tears down each timer and worker. Code sites must cite ADR-0028 and `outbound-bot-triggers`.

This is not approval to poll projects, credentials, engine availability, file health, UI state or unrelated application state. ADR-0028 itself does not need supersession; this uses its owner-approved exception mechanism. File debounce follows the explicitly requested source setting, rather than introducing a periodic rescan. The new durable ADR records the source/authority boundary and this bounded exception.

### D7. Shared UI and same-bot tools

**Boundary: untrusted client/tool inputs versus server-owned operations.** Extend `runtimeTriggers.ts` tools with typed definitions, source test, status and paginated memory metadata/reset. Reuse current revision checks and execution-bound bot identity; no workspace MCP registry access. Mask header values and redact exact injected secrets across fragmented output before diagnostics/persistence. Sensitive header fields are encrypted through the existing vault, scoped to bot and trigger; definitions return masked values/opaque references, never ciphertext as executable input. No host CLI-login discovery is added. Scripts can instead use installed container CLI logins or bot environment variables. Agent tools cannot enable a disabled bot.

Use the Claude-advised grouped list and adjacent editor within existing Configure > Triggers. Preserve unsaved drafts on responsive list/editor navigation. Keep source choice, source fields, condition, missed-run policy and Then prompt visible; hide less-used limits/filter/header editing behind disclosures without hiding the selected recovery policy. Provide contextual summaries for first-run and memory reset consequences. Health is fed by observation events, not renderer polling.

Test source uses a separate bounded worker against a cloned checkpoint. It may execute side effects in the configured script/GET and states that fact; it never starts an AI session or modifies live memory/anchor. File and SSE tests observe for at most ten seconds and can return no observed event. Run now is separate: time directly runs, observation sources do one real observation and apply conditions; file/SSE wait at most ten seconds and do not fabricate activity. A no-event manual observation is logged as a check without a session. Disabled trigger testing/manual invocation is allowed only while its bot is enabled.

Alternatives: a larger modal constrains diagnostics; forge-specific forms defeat generic agent-authored scripts; shared test/live checkpoints accidentally consume real work.

### UI sketch

```text
Triggers                   Review incoming items       Healthy [Enabled]
                           WHEN
COMMANDS                   [Commands v] [Command result v]
  Review incoming items    Command [...............................]
  Checked 20 seconds ago   Every   [1 minute]
                           Fire on [New JSON items v]
NETWORK                    Items   [empty pointer: root array]
  Service status           ID      [/id]
  Connected                First check [Process existing v]
                           If server was offline [Run once v]
TIME                       THEN
  Weekly summary           [Review this item and report risks...]
                           [Test source]  12 items; 1 would fire
                           Runs inside this bot's container
                                             [Discard] [Save]
```

## Risks / Trade-offs

- [Source data can contain instructions or secrets] -> label it untrusted, select bounded payloads, mask header values and injected credentials; arbitrary transformations by scripts cannot be perfectly redacted.
- [Arbitrary scripts have side effects] -> execute only inside the owning bot environment, show actual command/cwd, label tests as execution; container engine access remains the already accepted broad engine authority, not a new sandbox claim.
- [Large histories exhaust memory/spool] -> explicit limits and blocked status, no silent eviction; documented reset/retry. Long-lived item sources may need scripts returning stable cursors instead of endless ID sets.
- [Source cannot replay] -> expose unknown gaps and net-change/current-check semantics; never promise exactly-once external actions or complete event history.
- [Watcher prevents energy saving] -> name active continuous sources keeping container awake; periodic sources release leases between checks.
- [Worker/image dependency] -> locally built image fingerprint includes the worker, runtime and helper; real Docker/Podman smoke tests gate support.
- [Incomplete canonical bot specs] -> archive base deltas before these deltas, and revalidate exact requirement anchors before archive.

## Migration Plan

1. Merge this planning state to main before implementation. Resolve any bot-runtime proposal merge order explicitly; no unmerged runtime code is assumed.
2. Introduce a versioned bot/trigger state decoder and protocol feature capability. Existing bots default enabled; existing time triggers retain IDs, anchors, prompts and explicit skip policy to preserve old missed-run behaviour. Existing project-event bot triggers are retained disabled with their definition and an actionable unsupported-source message. They never silently map to a new source or break loading all bots.
3. Ship the source worker as an image fingerprint input, then contracts/storage/lifecycle/source runners and tools before enabling the editor. Stopped bots rebuild/recreate through existing rules; running old images report source support unavailable until updated, without fallback to host execution.
4. Exercise crash boundaries and real engine tests, then enable generic source creation. Automation tests prove its original behaviour remains intact.
5. Rollback: disable new source admission, stop workers, retain the complete new-format state and a pre-upgrade backup. Old binaries must refuse unsupported state versions rather than drop definitions or restore an older copy as though current; operator restore is explicit and warns about repeated side effects.
6. Archive `add-terminay-bots` and relevant prior bot deltas in dependency order before this change, checking all exact MODIFIED requirement anchors against canonical specs. Do not modify accepted ADRs or rewrite earlier change artifacts as a shortcut.

## Open Questions

No remaining product decision blocks this proposal. Limits, default recovery policies, redirect behaviour, retry ceilings and the worker implementation are proposed engineering defaults documented here for review. No in-force ADR requires replacement; ADR-0028 approval is explicitly scoped above.

Implementation must verify the image-shipped Python/inotify worker on supported local Docker/Podman engines and select a bounded regex evaluator under package policy. The existing duplicate ADR-0095 numbers remain untouched; new records start at 0096. These are validation/integration obligations, not authorization to expand scope or change runtime architecture.
