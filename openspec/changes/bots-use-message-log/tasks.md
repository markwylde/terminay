## 1. Durable communication and bounded reads
- [x] 1.1 Implement versioned message/event storage, idempotent posts, edit/delete/clear and one-time transcript import; verify persistence, restart, import deduplication and no execution replay.
- [x] 1.2 Implement authenticated scope/snapshot/revision-bound cursors, bounded summaries/details/search and finite event waits; verify pagination under concurrent posts, malformed cursors, byte budgets, expiry, cancellation and UTF-8.
- [x] 1.3 Implement durable message attachments and binary reads with quotas and ownership; verify source disappearance/container replacement and deletion cleanup.

## 2. Runtime and coordination
- [x] 2.1 Replace conversation continuation with fresh bounded briefings and parallel bounded admission; verify every message gets a new provider ID, failure persistence, trigger parity and coordination while busy.
- [x] 2.2 Implement scoped MCP catalog, stdio container relay and execution capability lifecycle; verify protocol framing, validation, token redaction/revocation and no host/project authority.
- [x] 2.3 Implement session summaries/details/inbox/events and atomic stop/replace with expected revisions/idempotency; verify correction races, terminal targets, consumed receipts and refusal of late posts.
- [x] 2.4 Implement shared-work ownership and shell/desktop gating with coordination capacity; verify unrelated parallel work, blocked desktop access, replacement transfer and cleanup.

## 3. Client and UI
- [x] 3.1 Add canonical message APIs and paginated shared chat with platform edit/delete/clear controls and durable inline images; verify client authority, loading/history and mutation races.
- [x] 3.2 Keep raw thoughts/tools/output in execution details and show concurrent execution state independently; verify no stdout mirroring, session selection isolation and trigger-only posts.
- [x] 3.3 Reconcile pending specs, prior tests and fixtures with the final model; verify OpenSpec and absence of contradictory continuation contracts.

## 4. Delivery verification
- [x] 4.1 Run builds, workspace/renderer typechecks, lint, server/client/UI tests and Docker-isolated bot E2E; record actual results and limitations.
- [x] 4.2 Verify real pinned adapter MCP posting, a busy-session BBC News→BBC Sports correction and screenshot persistence in the development app; preserve the real profile and record evidence.
- [x] 4.3 Update the existing Gitea PR, read back its description and inspect every final head status; leave draft until required checks pass.

- [x] 4.4 Make Chat enter at the bottom without animation and follow delayed image layout while pinned; verify delayed images, re-entry and manual history scrolling.

## 5. Agent trigger management
- [x] 5.1 Specify bot-scoped trigger tools, read budgets, stale-write refusal and change events; reconcile the pending trigger capability.
- [x] 5.2 Implement trigger CRUD, enable/disable, preview and Run now on the existing runtime; preserve scheduler validation and ownership.
- [x] 5.3 Verify complete CRUD, schedule execution, pagination/UTF-8, stale and repeated mutations, cross-bot and revoked calls, event delivery and persistence.
- [x] 5.4 Rebuild the development app, verify real tool discovery and trigger management, update the existing PR and check every final-head CI status.
