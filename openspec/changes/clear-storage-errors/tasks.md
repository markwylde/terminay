## 1. Server classification

- [x] 1.1 Export the storage failure reasons from `@terminay/protocol`. Verify: the package builds.
- [x] 1.2 Add the `storageFailure` classifier in server-core. Verify: unit tests using real Node-shaped errors cover each code, retryability, data-root and outside paths (including a sibling sharing the prefix and a missing path), each durable-save syscall, malformed errors, cycles, the eight-link bound, and the `watch`, `kill` and `spawn` exclusions.
- [x] 1.3 Use it in the dispatcher for commands only and pass the data root through the server-core options. Verify: dispatcher tests show no path or platform text in the result, protocol and scope errors unchanged, queries unchanged, and the cause logged.
- [x] 1.4 Supply the data root from the standalone server and Desktop's embedded server. Verify: typecheck passes, and tests show the server-core composition and the standalone composition options carry the data root into a permission message; Desktop's wiring is checked by a source assertion.

## 2. Preserve causes

- [x] 2.1 Keep `cause` in file save, workflow save, dropped-file upload, terminal start and recording storage failures, and let the shell-profile protocol mapping pass a storage failure on; rethrow the storage case from `files.save` and the workflow protocol mapping. Verify: tests drive each with a failing storage fake; the file save goes through the file adapter and the dispatcher and leaves disk bytes, draft and revisions unchanged; the workflow case leaves the workflow unchanged, publishes nothing, and MCP still answers `internal`.
- [x] 2.2 Prove the reported path: a workspace command on a store whose commit throws `ENOSPC` answers `storage_full`. Verify: dispatcher-level test that also shows an unchanged revision and no published change.

## 3. Client

- [x] 3.1 Add `isServerStorageFailure` to client-core and exempt storage failures where `unavailable` is rewritten (feature failure copy, transport-failure suppression, project root update). Verify: tests assert the server's message reaches the client error, `isTransportFeatureFailure` is false, and a root update rethrows the original storage error.

## 4. Documentation and checks

- [x] 4.1 Add a full-disk note to the standalone operator runbook in `docs/operations/`. Verify: the note names the client messages.
- [x] 4.2 Run builds, typecheck, lint, the affected test suites and `openspec validate`. Verify: they pass; `openspec validate --all` shows no failure beyond those already on `main`.
- [x] 4.3 Note the low-disk health signal as follow-up. Verify: the pull request names it.
