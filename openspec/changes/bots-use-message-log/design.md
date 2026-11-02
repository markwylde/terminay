## Context

Terminay currently stores communication inside ACP transcripts, resumes provider chats and serializes turns per bot. Atlas demonstrates explicit message posting and bounded recent-context construction. The owner authorizes fresh invocations, overlapping coordination and paginated/event-based tools. Existing bot-only container, socket transport, credential and project/terminal boundaries remain in force.

## Goals / Non-Goals

Separate communication from execution; support corrections promptly; bound model context and resource consumption; retain durable attachments and existing communication without replay. No workspace/project/terminal MCP reach, hosted storage, implicit stdout posting or hostile-sibling isolation is introduced.

## Decisions

### Durable bot communication store

Add server-owned per-bot message/event persistence with IDs, sequence, revision and author/source execution. Accept user communication durably before attempting dispatch. Import existing user/assistant transcript entries once using deterministic source identities and persist a migration marker; retain diagnostics separately. Edits create revisions/tombstones and events. Clear starts a new log epoch; old execution mutations are revoked or stopped rather than resurrecting cleared messages.

### Read budgets and cursors

Default lists are 10 summaries, maximum 25 and 8 KiB of JSON payload; summaries include IDs, timestamps, revisions and at most a short excerpt. Details are explicit UTF-8-safe slices with 8 KiB maximum and revision-bound continuation. Opaque authenticated cursors bind bot, operation/filter, epoch, snapshot high-water and continuation position. Search uses the same budgets. Initial context has a separate 8 KiB recent-context budget and includes truncation/count/cursor information. Full provider traces and attachment data never enter MCP list results.

Events use monotonic per-bot sequence and bounded durable retention. `events.next` supports cursor/limit and optional wait up to 20 seconds, waking on events or cancellation rather than polling. Retention gaps return an explicit expired-cursor result with resync guidance. Lists expose a snapshot cursor so consumers can page a stable view and then request later events.

### Fresh executions and scheduling

Each user post has its own fresh ACP `session/new`. No ordinary send resumes a provider session. Up to four work executions plus one reserved coordination execution may be admitted; excess triggers/messages retain explicit queued state. Coordination is independent of shared-work ownership. An execution obtains one bot-scoped work lease before shell/desktop changes. Its tool-shell entrypoint checks ownership; runtime MCP remains usable without the lease. This coordinates normal sibling work, not adversarial processes sharing the bot uid; the bot container remains the security boundary.

### Scoped MCP transport

ACP receives only a bot-runtime stdio MCP server definition. A small image adapter connects over a private container Unix socket to a per-execution relay served through the existing authenticated engine exec stream. The host binds requests to its captured bot/execution and a revocable random capability. No host TCP listener, project MCP registry, arbitrary host method or published container port is exposed. Tokens are redacted and excluded from transcripts/argv. JSON-lines, requests, tool responses and outstanding calls are bounded. Relay and adapter lifetimes follow execution cleanup.

### Coordination semantics

Execution summaries expose trigger, state, revision, current work and supersession, not entire transcripts. `sessions.post` writes a durable inbox record; consumed acknowledgement is distinct and inbox reads are paginated. `sessions.replace` is a server transition with expected revision and idempotency key. It revokes old posts before cancellation, awaits process-group cleanup and then transfers work ownership. A newer execution cannot be replaced by an older correction, and concurrent replacements return conflicts. Completed targets return their terminal outcome. No already-performed external action is rolled back implicitly.

### Bot-owned trigger management

Extend the existing scoped runtime catalog with triggers_list/get/create/update/delete/enable/preview/run. Resolve the bot from the authenticated execution, never from tool arguments. Delegate to BotTriggers so UI and agent operations share schedule validation, time zone, minimum interval, 50-trigger limit, persistence, pending-firing cancellation and scheduler notifications. Trigger management does not need the shell/desktop work lease.

Lists return metadata without prompts, default to 10 and cap at 25 items and 8 KiB. A server revision binds list continuation; changes invalidate the cursor and require a fresh listing. Detail prompt slices are UTF-8-safe, byte-bounded and bound to the trigger content revision. Reads return the current server revision and event cursor. All mutations, including Run now, require the observed server revision; stale requests fail before taking effect, preventing a repeated create/run request from silently duplicating work. Agents refresh on conflict and inspect the result before deciding what to do next. Update replaces a complete draft; enable/disable preserves its prompt and interval anchor semantics. Run now starts an independent session, following the existing admission rules. Trigger configuration changes, including UI edits and automatic once-trigger disabling, emit bounded trigger events without prompt bodies.

This extends the accepted runtime boundary rather than creating a new transport, scheduler, credential grant or architecture decision. Existing accepted ADRs remain unchanged.


### Messages and attachments

Only `chat.post` creates a bot reply; streamed ACP output stays diagnostic. Retry keys deduplicate posts after disconnects. Raster attachments are copied as the bot user from validated container paths through the bounded image reader into server-owned message storage before acknowledging a post. IDs, MIME, size and descriptions are returned to models; clients fetch binary bytes separately. Per-file, per-message and total storage quotas are explicit and enforced. Deletion/clear removes owned attachment references and retention performs cleanup. Existing volatile image previews remain available in old diagnostics but new posted screenshots are durable.

### UI and reconciliation

Replace session-backed Chat with paginated communication using the existing transcript presentation, context menu and platform dialogs. Entering Chat pins its viewport to the bottom without animation; a content/viewport ResizeObserver maintains that position through delayed image decoding and layout changes, while explicit wheel, touch, scrollbar or keyboard gestures disable following. Layout-generated scroll events do not unpin the viewport. User-facing session labels remain Sessions. Execution list/details remains separate, with concurrent work indicators and Stop controls. Sending no longer depends on selected session or offers New chat. Message revisions affect future context and event readers; they do not rebuild old providers. Reconcile the pending bot/trigger/socket specifications and update fixtures rather than maintaining two contradictory contracts.

## Risks / Trade-offs

- Concurrent sessions share home and credentials → bounded admission, work ownership and explicit same-bot trust boundary.
- Cancellation may race external actions → revoke communication immediately, confirm cleanup, report terminal outcomes honestly.
- Provider MCP compatibility → fake transport, pinned adapter conformance and real dev execution gate before declaring completion.
- Large histories/attachments → hard response and storage budgets, revision-bound cursors and explicit expired-cursor recovery.
- Crash between message acceptance and dispatch → durable linkage/state and reconciliation without replaying completed side effects.

## Migration Plan

Persist a versioned one-time import from existing chat transcripts; do not launch executions for imported communication. Keep originals until verified. Fresh schema and import paths have restart tests. Existing accepted ADRs are unchanged; ADR-0093 supersedes only the no-bot-MCP, single-session and continued-conversation decisions in ADR-0089. Delivery stays in the existing branch/PR as requested. Archive only after implementation and merge under the repository workflow.

## Open Questions

No user-blocking decisions remain. Numeric limits above are implementation defaults, covered by tests and adjustable together with the contract. Adapter behavior is a required implementation verification, not an assumed capability.
