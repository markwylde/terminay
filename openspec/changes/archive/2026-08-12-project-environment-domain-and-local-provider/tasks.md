## 1. Domain, persistence, and migration

- [x] 1.1 Define runtime-validated environment/profile/revision/capability/status records and a revisioned, crash-safe repository separate from workspace, verified by repository tests including crash recovery
- [x] 1.2 Reserve the undeletable This server environment and migrate every legacy project/session idempotently, verified by schema-v2 fixtures migrating once and preserving all ids and state
- [x] 1.3 Advance workspace/protocol/client reconciliation with immutable project environment and matching terminal-session metadata, verified by reconciliation tests

## 2. Authorization and workspace invariants

- [x] 2.1 Bind actor/scope/project claim/explicit permissions to authenticated transports rather than `ClientHello`, covering embedded, standalone, and test compositions, verified by forged-identity tests
- [x] 2.2 Derive source/destination project scope for every workspace mutation, including panel create/update/close/move and generic project update, verified by scope-derivation tests per command
- [x] 2.3 Reject cross-environment panel moves before mutation and make generic project updates presentation-only, verified by asserting no process, file, or workspace mutation occurs on rejection

## 3. Built-in provider and conformance

- [x] 3.1 Define the internal environment registry/router contract and implement This server using existing terminal/filesystem/Git/shell services, verified by This server passing existing server-core tests with no second Local authority
- [x] 3.2 Add capability/status queries and bounded safe presentation DTOs, verified by asserting the DTOs carry no credentials or host detail
- [x] 3.3 Prove existing Local launch, files, Git, recording, agents, MCP, macros, project moves, reconnect, and server restart are unchanged, verified by the existing suites remaining green
