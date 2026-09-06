## 1. Extension API: creation-time fact

- [x] 1.1 Add an optional `createdAt` to `AgentDiscoveredFile` in `packages/extension-api/src/types.ts` and populate it from the host's existing stat in the local observation path. Verified by a unit test asserting a listed file carries a `createdAt` matching its birth time, and by `npm run typecheck` passing across the workspace.
- [x] 1.2 Extend the `fixtureTerminal` testing harness so a fixture file can declare a creation time and a fixture process can declare `startedAt`. Verified by a harness test in which a file created before the process start is visible to `listDirectory` but excluded by a post-start filter.

## 2. Claude Code binding fix

- [x] 2.1 Add a primary discovery path to `extensions/agent-claude-code/src/provider.ts`: resolve the provider-encoded project directory from the exact descendant `claude` process CWD via `resolveHomeDirectory`, and admit the single `.jsonl` root whose `createdAt` is after that process's `startedAt`. Reuse `claudeProjectJournalPath`'s encoding. Verified by a new unit test that binds with `openFiles` returning `[]`.
- [x] 2.2 Order discovery as: explicit `--resume` identity, then the post-process-start rule, then the existing open-writable fallback. Verified by a test asserting the fallback is not consulted when the primary rule binds, and is consulted when it finds nothing.
- [x] 2.3 Keep ambiguity unbound: two eligible post-start roots for one process bind nothing. Verified by a test asserting no events are emitted for two eligible roots, and that neither mtime nor filename breaks the tie.
- [x] 2.4 Exclude `subagents/` journals and any candidate whose header fails `rootSessionId` from the primary path, matching the existing fallback's checks. Verified by a test offering a sidechain journal as the only post-start candidate and asserting no binding.
- [x] 2.5 Admit a journal live via `watchDirectory` when it appears after discovery starts, so a `claude` process that has not yet written its journal binds on the first write rather than on the next foreground change. Verified by a test that starts observation against an empty project directory and then creates the journal.
- [x] 2.6 Replace the `openFiles`-supplying fixtures in `extensions/agent-claude-code/test/claude-code.test.mjs` with fixtures that reproduce real Claude Code evidence — a journal on disk and no open writable handle. Verified by the suite passing with every `openFiles` stub returning `[]` except the one test that explicitly exercises the fallback.

## 3. Claude Code lifecycle and inference

- [x] 3.1 Stop treating per-turn header records as session starts in `extensions/agent-claude-code/src/mapping.ts`: the first `permission-mode` starts the session, later ones open a turn. Verified by a mapping test over a two-turn fixture asserting exactly one `session.started` and no return to `idle` mid-turn.
- [x] 3.2 Map the turn header to `turn.started` and `system`/`turn_duration` to `agent.done`, with `idle` between a `turn_duration` and the next header. Verified by a mapping test asserting the idle→working→done→idle cycle across two turns.
- [x] 3.3 Remove `AskUserQuestion` as a live `waiting` signal, since its record is flushed only after the question is answered. Verified by a mapping test asserting no `wait.started` is emitted for an `AskUserQuestion` tool_use.
- [x] 3.4 Measure Claude Code's in-turn quiet intervals across several hosts and repository sizes, and set the input-request window from that measurement with a stated margin. Verified by the recorded measurement and the chosen window living beside the rule, with the window exceeding the measured ceiling.
- [x] 3.5 Implement the `waiting` inference: an open turn, quiescence past the window, a live writer, and a `permissionMode` that can prompt. Suppress on `bypassPermissions` and while a descendant is performing work; clear on any appended record. Verified by tests for each gate — fires, suppressed by bypass mode, suppressed by a busy descendant, cleared by a record.
- [x] 3.6 Map `isApiErrorMessage` to `blocked` when it halts a turn with no `turn_duration`, and to `done` with an error outcome when the turn completes. Verified by a mapping test over both fixtures.
- [x] 3.7 Discover and follow Claude Code subagents: list and watch the bound root's `<session-uuid>/subagents/` directory, admit each `agent-<agentId>.jsonl` as a child of that root, and follow it for that child's own `working`/`done`. Verified by a test admitting a child created after the root binds, and asserting the child's state moves independently of its root.
- [x] 3.8 Project a subagent at its `Agent` tool-use launch rather than on its result, using the recorded `description` as the label, and complete it on the child journal's completion or the parent's task notification for that `agentId`. Verified by a test over an async-launch fixture asserting `subagent.started` is emitted at the launch record, and `subagent.stopped` at the notification.
- [x] 3.9 Keep a root `working` while any child is working, and ensure a child completing does not complete its root. Verified by a reducer test with two children completing at different times.
- [x] 3.10 Carry an `inferred` flag on entries whose state came from an inference, through the canonical event and the reduced snapshot. Verified by a reducer test asserting the flag survives to the snapshot and clears when an explicit record supersedes it.

## 4. Grok and OpenCode fault inference

- [x] 4.1 Derive `blocked` for Grok from a fault that halts a turn with no `turn_ended`, keeping an error `turn_ended` as `done` with an error outcome. Verified by mapping tests over both fixtures.
- [x] 4.2 Enumerate Grok subagents from the bound root's `subagents/` metadata directory, admitting each named child session live and refusing any sessions-tree session that metadata does not name. Verified by a test admitting a child created after the root binds and rejecting an unrelated session.
- [ ] 4.3 Follow each Grok child's own `subagent_progress` and `subagent_finished` records for its state, keeping the root `working` while any child works. Verified by a mapping test asserting independent child states and an unchanged root.
- [ ] 4.4 Re-measure Grok's subagent layout against the installed CLI before implementing, capturing a real `subagents/meta.json` and a real `subagent_progress`/`subagent_finished` pair as fixtures. Verified by the fixtures being taken from a recorded live session rather than authored by hand.
- [ ] 4.5 Derive `blocked` for OpenCode from a recorded error with no completion event following, under the same rule. Verified by a mapping test over the fixture.

## 5. OpenCode provider — decide the read boundary

- [x] 5.1 Resolve design.md's open question: bounded read-only SQLite accessor in the Extension API, or direct read inside the extension child under `agent-observation`. Verified by a written decision in the change folder and, if it lands as a new public API surface, a new repository-level ADR.
- [x] 5.2 Implement the chosen read path with read-only WAL-aware access, a bounded `SQLITE_BUSY` retry, and no write lock on the provider's store. Verified by a test that reads a store while a second connection holds a write transaction, and by asserting the provider's store file is never opened writable.

## 6. OpenCode provider extension

- [x] 6.1 Scaffold `extensions/agent-opencode/` (`terminay-agent-opencode`) following the `agent-grok` package layout: manifest with `processMatchers` for `opencode`, `requiredEnvironmentCapabilities`, mapping `0.1`, and `permissions: ["agent-observation"]`. Verified by `npm run build` in the package and by the packed-extension test loading it.
- [x] 6.2 Implement the data-root rule: `opencode.db` below `$XDG_DATA_HOME/opencode`, defaulting to `~/.local/share/opencode`. Exclude `snapshot/`, `tool-output/`, `log/`, `auth.json`, and `account.json` as lifecycle sources. Verified by a test asserting a candidate outside the data root is ineligible.
- [x] 6.3 Implement binding: the exact writable `opencode.db` or its WAL held by a PTY descendant, selecting the parentless `session` row whose `directory` matches that descendant's CWD, most-recently-updated on ambiguity. Verified by tests covering a single match, a directory mismatch, and several eligible roots.
- [x] 6.4 Enumerate and follow OpenCode children from `session` rows whose `parent_id` equals the bound root id, each carrying its own state. Verified by a test admitting a child row created after the root binds and asserting independent child state.
- [x] 6.5 Implement the `(opencode, 0.1)` mapping over the append-only `event` log ordered by `aggregate_id`/`seq`: `session.created` → `session.started` + `idle`; `slug` as the pre-title label; `title` replacing it in place; first user message → `turn.started`/`working`; tool part begin/complete → tool start/finish; permission request → `waiting` and resolution → `working`; assistant completion → `done` with outcome; `parent_id` rows → named children; a recorded error with no completion event following → `blocked`; unknown types ignored. Verified by a fixture-driven mapping test asserting the exact canonical event sequence.
- [x] 6.6 Enforce the privacy boundary: `message.data` and `part.data` payloads never cross the extension boundary and are never logged. Verified by a boundary test asserting no emitted event or log line contains fixture payload text, modelled on `extensions/agent-omp/test/boundary.test.mjs`.
- [ ] 6.7 Register the extension in `extensions/builtins.json` and the catalog. Verified by an integration test asserting the provider id appears in the enabled-by-default provider set.

## 7. Shared conformance harness

- [x] 7.1 Decide where the harness ships: a new subpath of `@terminay/extension-api/testing` alongside `createAgentExtensionHarness`, or a separate dev-only package each extension dev-depends on. Verified by a written decision in the change folder and every extension importing the harness from one place.
- [x] 7.2 Build the PTY side of the harness on `node-pty`: spawn a shell in a disposable working directory, launch a CLI in it, write input, and tear down the CLI and PTY on completion, timeout, and failure alike. Verified by a self-test that spawns a trivial command, drives it, and asserts no orphaned process or PTY remains after an induced timeout.
- [x] 7.3 Build a real terminal observation context over the live process tree and filesystem, satisfying the same `AgentTerminalContext` the extension uses in production, sourced from the adapter logic in `packages/server-core/src/extensions/localAgentObservation.ts` rather than a second implementation. Verified by running an existing extension's `observe` against a real CLI and obtaining a binding.
- [x] 7.4 Collect emitted canonical lifecycle events with an `awaitState(entry, state, timeout)` helper, so assertions are made on the extension's own output as it arrives and never by reading provider files. Verified by a self-test asserting a state transition is observed within its timeout and that a missing transition fails with the events seen so far.
- [x] 7.5 Express every matrix capability as one shared assertion in the harness, parameterised by a provider descriptor carrying launch, subagent prompt, input-request gesture, fault gesture, quit gesture, resume gesture, and matrix row. Verified by a unit assertion that each descriptor's row covers all ten capabilities and that adding a capability fails every provider until its descriptor is updated.
- [x] 7.6 Gate each provider's test on its own opt-in environment variable, skipping rather than failing without a provisioned authenticated CLI. Verified by running the extension test suites with no variables set and observing skips and zero failures.

## 8. Per-extension conformance tests

- [x] 8.1 Add `extensions/agent-codex/test/conformance.test.mjs` with the Codex descriptor, and run the full matrix against a real authenticated Codex CLI. Verified by every Codex cell passing, or by a corrected matrix verdict.
- [x] 8.2 Add `extensions/agent-claude-code/test/conformance.test.mjs` with the Claude Code descriptor. Its input-request gesture must run the CLI in a permission mode that prompts, so the inferred `waiting` is exercised by a real outstanding prompt. Verified by every Claude Code cell passing, including the inferred `waiting` and `blocked`.
- [x] 8.3 Add `extensions/agent-grok/test/conformance.test.mjs` with the Grok descriptor, including a prompt that genuinely spawns subagents so `subagent_progress` and `subagent_finished` are observed rather than assumed. Verified by every Grok cell passing and by the captured records matching the rewritten Grok subagent requirement.
- [x] 8.4 Add `extensions/agent-opencode/test/conformance.test.mjs` with the OpenCode descriptor, including its session-resume gesture. Verified by every OpenCode cell passing.
- [x] 8.5 Cover quit and resume in every descriptor: assert the root goes inactive on quit, rebinds on resume with no second root and no replayed transitions, reports `done` when the resumed session had completed, and moves through `working` and `done` again on further work. Verified per provider against its real CLI.
- [x] 8.6 Retire `e2e/real-codex-agent-runtime.spec.ts` and the per-extension `real-cli-smoke.mjs` files in favour of the conformance tests. Verified by their assertions surviving in the new tests and the old files being removed.
- [x] 8.7 Keep the conformance tests off the pull-request merge gate per ADR-0010, and document how to provision credentials and run each provider's test locally. Verified by inspecting the workflow files for their absence and by the documented command running end to end on a provisioned host.

## 9. Documentation and closeout

- [ ] 9.1 Publish the capability matrix in user-facing documentation alongside the Agents feature, distinguishing `Y` from `Y*` and naming the inference rule behind each `Y*`. Verified by the rendered table matching the matrix in `specs/agent-provider-conformance/spec.md` exactly.
- [ ] 9.2 Add the fixture-parity question to the provider review checklist: does every fixture supply only evidence the real CLI actually produces? Verified by the checklist item existing in the contributor documentation for new agent providers.
- [ ] 9.3 Run the full conformance suite against all four provisioned CLIs and record the result. Verified by every claimed cell passing, or by a matrix verdict corrected to match observed behaviour.
- [ ] 9.4 Confirm the original defect is fixed in the real app: a running Claude Code session shows the amber working indicator, green when it stops, and red when a permission prompt is left outstanding. Verified by the `/run` flow with a live `claude` session and a screenshot of each state.
