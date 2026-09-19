# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-19
- Reviewer: Claude (for Mark Wylde)
- Change: builtin-agents-extension

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md: native modules must load under both Electron's Node and the pinned Node, so they must be N-API.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md: removing `agent-conformance.yml` keeps the merge gate within its scope.
- openspec/adr/0011-security-trust-boundary-model.md: extensions stay trusted Node programs. Allowing prebuilt native modules adds no authority; install scripts stay off.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md: superseded by 0025. Capability proof moves to the library.
- openspec/adr/0020-per-operation-canonical-roots.md: project scoping canonicalises roots per operation.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md: process ancestry is read only on edges; there are no idle spawns.
- openspec/adr/0022-watch-do-not-poll.md: still in force. The library never polls, and the worktree-metadata watch uses the shared ramp.
- openspec/adr/0024-providers-name-the-directories-they-await.md: superseded by 0025. No not-bound wait sets remain.

## Repository-Level ADRs Created

- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md: detection is delegated to `@markwylde/all-your-agents` in one extension. Extensions publish machine-wide session snapshots. The host scopes them by directory and repository worktrees and binds them by process ancestry. Supersedes 0014 and 0024.
- openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md: prebuilt native modules are accepted for all extensions. `binding.gyp` builds and install scripts stay refused. Built-in staging ships optional dependencies.

## Notes

- The README index was updated with the two new rows and the superseded markers. No prior ADR file was edited.
