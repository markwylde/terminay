# Implementation verification — 2026-11-04

Implementation and proposal share PR #489 at the owner's explicit request. All
changes were made in the `terminay-outbound-triggers-proposal` worktree.

## Local checks

- `npm run build:shared` and `npx tsc --noEmit`: passed.
- `npm run lint`: passed, with existing warnings/informational diagnostics.
- Server suites: `node --test --test-concurrency=2 packages/server-core/test/bot-*.test.mjs packages/server-core/test/schedule-engine.test.mjs packages/server-core/test/automation-*.test.mjs`: 308 passed, 14 optional-environment skips. Subsequent focused source/trigger checks cover frame validation, canonical corruption/future-version refusal and disable-during-redaction fencing.
- Protocol/client checks: 11 passed; trigger form model: 7 passed.
- Chromium grouped editor/wide/narrow draft-retention checks: 2 passed.
- `npm run test:e2e -- e2e/bots.spec.ts`: all 16 passed in isolated Electron/Chromium/Xvfb container.
- Additional HTTP/SSE/files editor test: `npm run test:e2e -- e2e/bots.spec.ts --grep 'generic network'`: passed without retry. Its timeout allows the two deliberate ten-second stream/watch test windows plus Electron startup. No Electron test ran on the host.
- `npm run test:bots:mcp-real`: 7 passed on Podman 6.1.4 (client/server), Linux arm64. The production image worker exercised bot UID/cwd, command descendants after timeout, bounded pathological regex, in-container HTTP/SSE and missing-path file creation. No bot ports were published. An earlier run exposed an orphan/zombie command descendant; the worker now uses subreaper cleanup, and the rerun passed.

## Real Docker and CI

Gitea run 23309, job 69709, on implementation commit `50280d5b`, passed the
real source-worker smoke on Docker/Linux amd64:

> real container sources use bot uid, bounded commands, loopback HTTP/SSE and event-driven files without ports

That job subsequently found an existing Claude assertion that only recognized
MCP tools exposed directly in the model catalog. The real chat/reply succeeded
through ToolSearch; the assertion now also recognizes the discovered tool
reference. Final PR-head CI must pass before the PR is reported ready.

## Specification checks and archive boundary

`openspec validate --all`: 108 passed, zero failed.
`openspec validate --all --archived`: 204 passed, four pre-existing incomplete
archive task failures, unchanged by this feature:

- `2026-09-06-agent-provider-status-conformance`
- `2026-10-07-notifications-icon-and-project-dot`
- `2026-10-10-macros-script-editor`
- `2026-10-27-github-worktree-status`

The bot capabilities still include active prerequisite deltas. Reconcile and
archive in dependency order only after implementation merges. Task 7.5 remains
open for that post-merge operation; no canonical capability or accepted ADR was
edited as part of implementation. ADR-0096 remains proposed for review.
