## 1. Public package and manifest surface

- [x] 1.1 Add `extensions/*` to the npm workspace graph and boundary tooling, verified by `npm ci --ignore-scripts --dry-run` resolving the workspace and `npm run check:boundaries` accepting all workspace packages
- [x] 1.2 Add `agent-observation` to the public permission types and runtime validation, verified by the Extension API suite rejecting agent publication without it
- [x] 1.3 Add optional `contributes.agentProviders` and require at least one supported contribution across project environments and agent providers, verified by manifest validation tests for combined and optional contributions
- [x] 1.4 Define and validate namespaced agent provider ids, display metadata, platforms, process matchers, mapping declarations, and capability needs, verified by the bounded-declaration validation tests
- [x] 1.5 Export the canonical agent lifecycle, model, tool, wait, completion, subagent, binding, diagnostic, and cancellation types from the public SDK, verified by `npm run typecheck --workspace @terminay/extension-api`
- [x] 1.6 Add runtime schemas and size, count, and depth limits for every new public DTO, verified by the DTO bound tests in the Extension API suite
- [x] 1.7 Update the manifest reference, API reference, permissions guide, author guide, fixtures, conformance CLI, and generated declarations, verified by `npm test --workspace @terminay/extension-api` and conformance against an independently packed third-party fixture

## 2. Extension host protocol

- [x] 2.1 Add child and parent messages for provider registration and disposal, verified by the extension-host suite
- [x] 2.2 Add terminal-incarnation admission and cancellation messages, verified by descriptor-threading and admission tests
- [x] 2.3 Add bounded request and response operations for environment observation, verified by scoped observation-request tests
- [x] 2.4 Add flow-controlled lifecycle publication with deadlines and backpressure, verified by the per-context overflow, deadline expiry, and atomic batch-rejection tests
- [x] 2.5 Reject undeclared providers, duplicate ids, stale contexts, invalid event transitions, oversized messages, and cross-terminal handles, verified by the host rejection matrix
- [x] 2.6 Ensure disable, update, terminal exit, project removal, environment change, child crash, and server shutdown cancel observers exactly once, verified by the table-driven retirement matrix invoking each cause twice
- [x] 2.7 Preserve per-extension process isolation and restart and backoff behaviour, verified by the crash-isolation tests

## 3. Observation adapters and SDK toolkit

- [x] 3.1 Define the public observation-adapter interface used by driver utilities, verified by the SDK typecheck and adapter tests
- [x] 3.2 Implement **This server** adapters using Node process, TTY, open-file, and filesystem APIs, verified by a black-box harness proving environment values and roots come from the admitted terminal's exact shell PID rather than the server process environment
- [x] 3.3 Route remote adapters through project-environment capabilities without substituting local PIDs, cwd, home directories, or paths, verified by the runtime routing suite rejecting a remote context before any local adapter call
- [x] 3.4 Implement bounded JSONL replay and follow, partial-line buffering, truncation, inode and device replacement, and cancellation helpers, verified by the SDK suite covering split UTF-8, over-limit discard, and watcher disposal
- [x] 3.5 Implement versioned mapping selection and safe event-builder helpers, verified by greatest-compatible mapping selection and canonical event validation tests
- [x] 3.6 Add typed unavailable and fallback diagnostics without raw provider errors, verified by the diagnostic content assertions
- [x] 3.7 Add the public in-memory agent-extension test harness used by the author example, verified by the harness tests and the packed third-party fixture

## 4. Generic Server Core composition

- [x] 4.1 Replace the closed provider union with validated namespaced provider ids, verified by the canonical reducer accepting only extension lifecycle DTOs
- [x] 4.2 Build an extension-backed agent provider registry, verified by the focused agent runtime and host suites
- [x] 4.3 Compose providers with the exact project environment and terminal incarnation, verified by exact terminal-incarnation claim tests before child admission
- [x] 4.4 Keep authorization, binding scope, canonical sequence assignment, replay rejection, store reduction, acknowledgement, and snapshots in Server Core, verified by the status and client sequence regression suites
- [x] 4.5 Preserve the existing client protocol and provider-neutral Agents UI, verified by Client Core suites and protocol conformance
- [x] 4.6 Retire provider entries on disable or crash without affecting other providers, verified by the per-provider retirement isolation tests
- [x] 4.7 Preserve generic terminal activity whenever authoritative observation is unavailable, verified by fallback tests for non-matching and remote-routed terminals
- [x] 4.8 Validate a whole publication batch before store mutation and bound, serialize, and coalesce per-context publications, verified by the hardening and flow-control suites

## 5. SSH and Puzed relocation

- [x] 5.1 Copy the canonical SSH package content into `extensions/ssh` excluding `.git`, `node_modules`, caches, and generated build output, verified by the SSH workspace suite and `git diff --check`
- [x] 5.2 Copy the canonical Puzed package content into `extensions/puzed` with the same exclusions, verified by the Puzed workspace suite
- [x] 5.3 Preserve npm names, extension ids, provider ids, profile ids, and persisted environment compatibility, verified by public manifest conformance and persisted-environment tests
- [x] 5.4 Replace repository-relative SDK dependencies with workspace and public package declarations that also pack correctly, verified by packed activation tests for both packages
- [x] 5.5 Move tests, fixtures, generated-contract workflows, licences, READMEs, and publication metadata, verified by both packages passing conformance from their packed tarballs
- [x] 5.6 Remove the private Puzed and SSH production composition after packed-extension parity passes, verified by the packed Puzed-to-host-to-SSH-to-vault Docker integration and a production-source search finding no SSH or Puzed composition symbols

## 6. Codex extension

- [x] 6.1 Create the independently packable `extensions/agent-codex` project, verified by its packed-package test and public manifest conformance
- [x] 6.2 Move executable recognition, effective home resolution, process-bound rollout discovery, root and subagent selection, and resume and rebind behaviour, verified by the package suite
- [x] 6.3 Move all Codex mapping versions, compatibility selection, fixtures, and privacy exclusions, verified by `npm run test:compat --workspace terminay-agent-codex`
- [x] 6.4 Verify title, prompt, model, tool, approval, elicitation, completion, exit, collaboration child, and malformed-record behaviour, verified by the table-driven mapper tests covering all five supported wait variants and fail-closed malformed input
- [x] 6.5 Document supported versions, evidence, mappings, limitations, and real-CLI smoke commands, verified by the package README
- [x] 6.6 Follow the exact terminal's Codex session index so an explicit `thread_name` title is reflected initially and every later rename updates the existing sidebar root live, verified by the compound test covering initial title, two renames, replacement, truncation, a resumed root id, and unrelated-session exclusion
- [x] 6.7 Discover Codex subagent rollout journals from the bounded exact-terminal sessions root and attach them only when the native `source.subagent.thread_spawn.parent_thread_id` equals the current root session, verified by the compound tests for initial and late children, exact-parent matching, and unrelated-child rejection

## 7. Claude Code extension

- [x] 7.1 Create the independently packable `extensions/agent-claude-code` project, verified by its packed-package test and public manifest conformance
- [x] 7.2 Move executable recognition, project-root resolution, process-bound new-session discovery, exact resume binding, and persistent rebind behaviour, verified by the package suite proving exact `--resume`/`-r` UUID binding before a writable journal exists
- [x] 7.3 Move title, model, tool, permission, completion, and Agent child mappings, verified by the mapping tests
- [x] 7.4 Verify unrelated-history rejection, subagent-root exclusion, privacy, and malformed-record behaviour, verified by the mismatching-root-header and sidechain-exclusion tests
- [x] 7.5 Document supported versions, evidence, mappings, limitations, and real-CLI smoke commands, verified by the package README

## 8. Cursor Agent extension

- [x] 8.1 Create the independently packable `extensions/agent-cursor` project, verified by its packed-package test and public manifest conformance
- [x] 8.2 Move `agent` and Cursor process recognition and exact writable chat-store binding, verified by the two-terminal resume isolation test
- [x] 8.3 Move transcript-path validation, bounded title refresh, read-only model metadata extraction, user-query fallback, turn state, and completion mapping, verified by the package suite
- [x] 8.4 Verify that title and model changes preserve lifecycle state and that resume binds the correct terminal, verified by the title and model refresh test asserting no UUID or lifecycle replacement
- [x] 8.5 Keep unsupported child lifecycle absent until stable native identity and completion evidence exist, verified by the no-inferred-subagent assertions
- [x] 8.6 Document the SQLite fields read, fields excluded, supported versions, limitations, and real-CLI smoke commands, verified by the package README
- [x] 8.7 Fail closed for remote Cursor observation by requiring remote sibling-file and SQLite operations before binding, verified by the remote-binding test returning no binding rather than reading local state

## 9. omp extension

- [x] 9.1 Create the independently packable `extensions/agent-omp` project, verified by its packed-package test and public manifest conformance
- [x] 9.2 Move omp and Bun recognition, profile and data-root resolution, PTY breadcrumb identity, root and child journal discovery, and atomic replacement behaviour, verified by the OMP/profile/XDG/root precedence tests using exact terminal environment facts
- [x] 9.3 Move title-slot handling, mapping versions, model, tool, message, and exit records, child lifecycle, fixtures, and privacy exclusions, verified by the package and compatibility suites
- [x] 9.4 Verify memory-only pre-file fallback, resume and rebind, malformed breadcrumb, unrelated writer, and unsupported wait behaviour, verified by the compound OMP tests
- [x] 9.5 Document supported versions, evidence, mappings, limitations, and real-CLI smoke commands, verified by the package README

## 10. Built-in artifact production

- [x] 10.1 Build and test each `extensions/*` workspace before staging, verified by `npm run build:app`
- [x] 10.2 Pack each extension with `npm pack` and validate the packed package rather than repository source, verified by the packed-package tests
- [x] 10.3 Materialize and inventory every production dependency with scripts disabled and the existing native and lifecycle restrictions enforced, verified by the staged production closures
- [x] 10.4 Produce deterministic package, file, dependency, permission, contribution, and compatibility digests, verified by `npm run verify:built-in-extensions` rehashing every built-in
- [x] 10.5 Stage identical artifacts and inventory into the Electron and standalone server release inputs, verified by byte-identical inventory comparison between an `electron-builder --dir` package and the standalone payload
- [x] 10.6 Add release-boundary tests that detect absent, stale, divergent, or non-conformant built-ins, verified by the focused artifact and release tests covering tampering, absent inventory, and stale dependency trees

## 11. Installation and lifecycle

- [x] 11.1 Materialize bundled artifacts transactionally into immutable server slots on first run without network access, verified by the offline immutable-floor installer test
- [x] 11.2 Enable built-ins by default only when no explicit user choice exists, verified by the default-enablement and disable-persistence tests
- [x] 11.3 Preserve disablement, selected overrides, and active slots across release reconciliation, verified by a disabled external override remaining selected after a newer bundled release
- [x] 11.4 Support compatible npm override, drain, activation, rollback, and override removal to the bundled floor, verified by the update drain and rollback tests
- [x] 11.5 Prevent physical removal of the release's bundled slot, verified by the reference-safe removal test
- [x] 11.6 Merge catalogue, bundled, installed, override, enabled, compatibility, and runtime state into one Settings entry per extension id, verified by the Settings DTO test asserting exactly one entry per built-in
- [x] 11.7 Isolate materialization and activation failure to the affected extension while failing release creation for invalid shipped artifacts, verified by the malformed-artifact isolation test and release validation

## 12. Documentation and enforcement

- [x] 12.1 Turn the proposed author example into shipped SDK documentation, verified by the generated API reference
- [x] 12.2 Add one complete README and troubleshooting guide per built-in extension, verified by each package README carrying installation, compatibility, troubleshooting, privacy, support, and limitation sections
- [x] 12.3 Add a minimal third-party agent package that is not derived from an official provider, verified by its independent pack, activation, and conformance run
- [x] 12.4 Add import-graph rules preventing `extensions/*` from using private Terminay packages or source paths, verified by the boundary gate
- [x] 12.5 Add reverse boundary rules preventing provider executable names, journal roots, record schemas, and mapping versions from returning to generic core or renderer code, verified by the reverse agent boundary gate
- [x] 12.6 Document that extensions are trusted Node programs rather than OS-sandboxed code, verified by the security guide and installation warning text

## 13. Development admission and host wiring

- [x] 13.1 Stage built-in packed artifacts before development Electron starts and recover when the development artifact directory is absent, verified by the development pre-stage tests
- [x] 13.2 Resolve a foreground CLI through Node, Bun, and interpreter wrapper processes before applying an extension's executable matcher, verified by the interpreter-chain tests
- [x] 13.3 Subscribe a live terminal to registered extension providers and dispose those subscriptions when the terminal or provider retires, verified by the subscription teardown tests
- [x] 13.4 Use the selected development resource root rather than an installed-app resource root for built-in artifact staging and discovery, verified by the development staging tests
- [x] 13.5 Classify only canonical persisted-workspace failures as workspace recovery so ordinary startup failures remain visible as startup failures, verified by the startup classification tests
- [x] 13.6 Migrate legacy failed extension records so stale installed or failed state cannot mask a newly materialized bundled floor, verified by the legacy-record reconciliation test
- [x] 13.7 Hot-reconcile built-ins, activate successful replacements, notify contributions, and re-observe existing terminals without restarting healthy provider contexts, verified by the hot reconcile and re-observation tests
- [x] 13.8 Intersect provider-declared observation requirements with exact environment capabilities before admission and return a safe unavailable diagnostic when a required operation is absent, verified by the capability intersection tests
- [x] 13.9 Surface safe agent-admission diagnostics to the activity path without publishing a false agent root or leaking provider paths or errors, verified by the admission diagnostic content assertions
- [x] 13.10 Expose SDK 1.2 terminal-scoped directory list and watch operations, including cancellation and replacement handling, through the public broker only, verified by the directory broker tests

## 14. Provider behaviour and public-package verification

- [x] 14.1 Verify Codex's exact terminal-scoped `session_index.jsonl` title stream for initial title, live rename, replacement, truncation, and resume, verified by the Codex compound suite
- [x] 14.2 Verify Codex discovers children that appear after the root binding through public bounded directory watching, exact native parent identity, and one root binding, verified by the Codex child-rollout tests
- [x] 14.3 Run public SDK validation, conformance, fixture, cancellation, fuzz, and security-boundary suites, verified by the Extension API suite passing
- [x] 14.4 Run each extension's unit, packed-package, compatibility, and opt-in real-provider test command, reporting unavailable authenticated smoke as skipped rather than passed, verified by `npm run test:agent-extension-compat` and `npm run test:agent-extension-packages`
- [x] 14.5 Migrate stale agent test IPC fixtures and callers to the public terminal-incarnation protocol with no legacy private driver bridge, verified by the absence of the legacy bridge in the test tree
- [x] 14.6 Enforce the renderer's generic-provider boundary so provider CLI, journal, mapping, and root details cannot enter client or renderer code, verified by the agent boundary suite

## 15. Packaged artifacts and release runtime

- [x] 15.1 Produce independently packed, verified built-in artifacts and expose one Settings card per built-in in an isolated packaged startup smoke, verified by the packaged startup smoke test
- [x] 15.2 Verify first-run bundled-floor materialization, default enablement, persisted disablement, external override removal, and rollback at installer scope, verified by the installer and operations suites
- [x] 15.3 Run the SSH and Puzed packed composition and Docker project-environment end-to-end suites, verified by the SSH Docker E2E and the packed Puzed-to-SSH-to-vault integration
- [x] 15.4 Admit a real Codex root, children, and live title update in the exact `npm run dev` Electron process and selected project terminal and assert the Agents sidebar updates, verified by the Docker-isolated Electron development test passing
- [x] 15.5 Verify Docker's clean dependency manifests install and stage all built-in package closures without relying on local `node_modules` or developer state, verified by a clean container running `npm ci` and emitting exactly the expected closures
- [x] 15.6 Run the complete `npm run test:e2e` through the required Docker-isolated Electron path, verified by the sharded end-to-end matrix passing on the release commit
- [ ] 15.7 Verify that the packaged Electron and standalone runtime activates the staged agent extensions, admits their lifecycle, and survives restart, disable, override, and rollback on the supported architectures, verified by the packaged built-in runtime matrix on every supported architecture
- [x] 15.8 Regenerate stale staged built-in artifacts before packaging rather than accepting a stale development staging directory, verified by the packaging regeneration check
- [x] 15.9 Verify the packaged Electron resource inventory and extension host activate every built-in from the packaged resource root, verified by `npm run test:packaged-built-in-extension-runtime`
- [x] 15.10 Verify the standalone Server resource inventory and extension host activate every built-in from its packaged resource root, verified by the standalone payload lifecycle matrix
- [x] 15.11 Exercise the packaged lifecycle matrix for offline first run, restart, persisted disablement, compatible override, rollback and removal to the floor, and corrupted-artifact failure isolation, verified by the packaged runtime matrix
- [x] 15.12 Admit a Codex terminal in a packaged runtime and observe its canonical provider lifecycle through the packaged extension host, verified by the packaged runtime admission test
- [x] 15.13 Exercise the real macOS arm64 Electron resource tree and matching standalone payload, verified by the native macOS arm64 package matrix
- [x] 15.14 Exercise a clean Linux arm64 standalone archive payload, verified by the clean arm64 container asserting `aarch64` before the standalone-only lifecycle matrix
- [x] 15.15 Exercise real Linux x64 Electron and standalone payloads on a native Linux x64 runner, verified by the native `packaged-linux-built-in-lifecycle` job asserting the machine architecture after a clean `npm ci`

## 16. Aggregate gates and cutover

- [x] 16.1 Run agent store, runtime, UI, resume and rebind, remote-client, disable and crash, and privacy tests as one final aggregate command set, verified by `npm run test:agents` together with the Extension API, Server Core, Client Core, and Desktop suites
- [ ] 16.2 Run offline Electron and standalone first-run, restart, override, and rollback artifact tests on the supported architectures, verified by those artifact tests passing natively per architecture
- [ ] 16.3 Delete the hard-coded agent drivers, sources, and special SSH and Puzed composition only after every parity gate passes, verified by a production-source boundary search finding none of them
- [x] 16.4 Remove the legacy PTY agent bridge so no hard-coded provider path can publish alongside an extension provider, verified by the absence of the bridge in production source
- [x] 16.5 Declare generic profile auto-creation through extension contributions with no provider-specific profile bootstrap in production code, verified by the public profile-save environment creation tests
- [x] 16.6 Register agent extensions through the generic Electron composition only, verified by the production-source search finding no provider-specific Electron registration path
- [x] 16.7 Register agent extensions through the generic standalone Server composition only, verified by the production-source search finding no provider-specific standalone registration path
- [x] 16.8 Run the final production-source boundary search proving no legacy agent drivers, PTY bridges, provider executable names, journals, mappings, or special SSH and Puzed composition symbols remain, verified by that search returning no matches
- [x] 16.9 Consolidate the accepted implementation into one branch and merge it, verified by the merge commit being an ancestor of the release tag and no implementation worktree remaining active

## 17. Acceptance

- [x] 17.1 Prove instance-authority isolation with two isolated Desktop profiles and two concurrent Server Core compositions sharing project names and terminal, session, and provider ids, verified by a lifecycle event admitted by one authority never appearing in the other's snapshot or subscription
- [x] 17.2 Prove immutable scope fencing so publication, acknowledgement, replay, and observation resolution each require the exact server, project, terminal session, and terminal incarnation, verified by the two-registry host suite with intentionally identical ids and a shared journal
- [x] 17.3 Prove public-runtime isolation so an extension host accepts only a context minted by its own selected Server runtime, verified by a matching context string from another server or profile failing to publish, observe, cancel, or subscribe
- [x] 17.4 Give every implicit embedded or standalone server a stable data-root-scoped identity and reject an explicit `--server-id` whose endpoint or data-root ownership is inconsistent, verified by the standalone identity suite and the Desktop durable-identity suite including atomic legacy-record migration and fail-closed foreign records
- [x] 17.5 Run the required Docker Electron end-to-end proof with two simultaneous isolated application profiles opening identically named projects and terminal ids, verified by each profile's Agents panel rendering only its own root and subagent state
- [ ] 17.6 Run two concurrent real Terminay app instances with separate profiles and intentionally identical project and session labels, verified by confirming a Codex agent appears only in the instance that owns its terminal and by recording the release, reproduction, and result
- [ ] 17.7 Complete the release-artifact evidence and public documentation before this change is closed, verified by every gate above being complete rather than inferred from a merged branch or a released tag
