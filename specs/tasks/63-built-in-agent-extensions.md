# Built-in agent extensions and public Agent API

## Goal

Make SSH, Puzed, Codex, Claude Code, Cursor Agent, and omp exemplary public
extensions stored under `extensions/`, and bundle their packed artifacts into
every Electron and standalone Terminay Server distribution. Remove provider-
specific agent discovery and parsing from Server Core after parity is proven.

## Governing specifications

- [Built-in extensions](../features/built-in-extensions.md)
- [Server extension platform](../features/extension-platform.md)
- [Agent status and sidebar](../features/agent-status-and-sidebar.md)
- [Project environments](../features/project-environments.md)
- [SSH project environments](../features/ssh-project-environments.md)
- [Puzed project environments](../features/puzed-project-environments.md)
- [Proposed Agent Extension API author example](./63-agent-extension-api-author-example.md)

## Confirmed product decisions

- All six built-in extensions are included offline and enabled by default on a
  fresh server.
- A user's enabled/disabled choice persists across Terminay upgrades.
- Bundled slots are immutable rollback floors and cannot be physically
  uninstalled from the release.
- A compatible npm-installed version may override a bundled slot; removing the
  override returns to the bundled slot without changing enablement.
- Third-party agent providers use the same installation UI and public API.
- The Agent API is an additive Extension API v1 release.
- SSH and Puzed retain their npm names and immutable extension/provider ids.
- SSH and Puzed source content moves into the monorepo without importing their
  separate Git histories.
- `extensions/*` uses the repository workspace and root lockfile.
- Extensions may use public Node.js APIs and declared npm dependencies.
- Extensions may not import private Terminay modules or internal host bridges.
- Active terminals/observers drain before an extension version is activated.
- Disabling a required extension is blocked while an enabled dependant needs
  it.

## Implementation checklist

### Public package and manifest surface

- [x] Add `extensions/*` to the npm workspace graph and boundary tooling.
- [x] Add `agent-observation` to public permission types and runtime validation.
- [x] Add optional `contributes.agentProviders`; require at least one supported
  contribution across project environments and agent providers.
- [x] Define and validate namespaced agent provider ids, display metadata,
  platforms, process matchers, mapping declarations, and capability needs.
- [x] Export the canonical agent lifecycle, model, tool, wait, completion,
  subagent, binding, diagnostic, and cancellation types from the public SDK.
- [x] Add runtime schemas and size/count/depth limits for every new public DTO.
- [x] Update manifest reference, API reference, permissions guide, author guide,
  fixtures, conformance CLI, and generated declarations.

Evidence (2026-08-24): `npm run typecheck --workspace @terminay/extension-api`
and `npm test --workspace @terminay/extension-api` built the public SDK and
passed 37/37 tests. The suite covers the additive permission,
combined/optional contributions, namespaced and bounded declarations, runtime
provider DTOs, bounded binding/metadata/diagnostic/lifecycle DTOs, terminal
TTY/environment-root constraints, root/child journal sources, public
conformance, and an independent packed third-party fixture. It additionally
proves public dependency-target requests/handlers and cancellation, a
target-owned opaque vault with bounded/closed validators, idempotent atomic
write semantics, transient callback-copy zeroization, and pending removal that
blocks new uses until the active callback completes. The API/security guides and
author material document its one-target scope and explicitly reserve
cross-installation ownership enforcement for production hosts.

Follow-up evidence (2026-08-24): the root workspace includes `extensions/*`;
`npm ci --ignore-scripts --dry-run` resolved it successfully and `npm run
check:boundaries` accepted all 16 workspace packages. The companion agent
boundary gate passed 2/2.

### Extension host protocol

- [x] Add child/parent messages for provider registration and disposal.
- [x] Add terminal-incarnation admission and cancellation messages.
- [x] Add bounded request/response operations for environment observation.
- [x] Add flow-controlled lifecycle publication with deadlines and backpressure.
- [x] Reject undeclared providers, duplicate ids, stale contexts, invalid event
  transitions, oversized messages, and cross-terminal handles.
- [x] Ensure disable, update, terminal exit, project removal, environment change,
  child crash, and server shutdown cancel observers exactly once.
- [x] Preserve per-extension process isolation and restart/backoff behavior.

Evidence (2026-08-24): `npm run build --workspace @terminay/server-core`
succeeded, then `node --test packages/server-core/test/extension-host.test.mjs`
passed 19/19 tests. The suite covers descriptor threading, declared-provider
admission, exact-once terminal cancellation, scoped observation requests,
undeclared and duplicate registration rejection, malformed/oversized IPC, and
crash isolation/backoff. Lifecycle-flow-control and exhaustive teardown cases
remain unchecked until their dedicated coverage lands.

### Observation adapters and SDK toolkit

- [x] Define the public observation-adapter interface used by driver utilities.
- [x] Implement This server adapters using Node process, TTY, open-file, and
  filesystem APIs.
- [x] Route remote adapters through project-environment capabilities without
  substituting local PIDs, cwd, home directories, or paths.
- [x] Implement bounded JSONL replay/follow, partial-line buffering, truncation,
  inode/device replacement, and cancellation helpers.
- [x] Implement versioned mapping selection and safe event-builder helpers.
- [x] Add typed unavailable/fallback diagnostics without raw provider errors.
- [x] Add the public in-memory agent-extension test harness used by the author
  example.

Follow-up evidence (2026-08-24): `npm run build --workspace
@terminay/server-core`, `npm run typecheck --workspace @terminay/desktop`, and
the focused host/runtime/local-observation suites passed 26/26. An independent
black-box harness verified that environment values and environment-root paths
come from the admitted terminal's exact shell PID (not the server process
environment), return only opaque handles, and reject a remote context before
touching a local adapter. A HOME-regression test likewise resolves
home-relative files from that shell's canonical HOME rather than host ambient
HOME. Its topology probe established a no-churn baseline, then performed one
cancellation/rebind after a changed process/open-file signature and cancelled
scheduled work on terminal exit. Remote capability routing, rather than
fail-closed remote rejection, remains unchecked.

SDK follow-up evidence (2026-08-24): SDK typecheck and its 44-test suite
passed. It exercises split UTF-8 and partial JSONL records, over-limit discard
through newline, truncate/replacement/reset handling, cancellation between
follow chunks with watcher disposal, greatest-compatible mapping selection, and
canonical lifecycle event building/validation.

Runtime routing evidence (2026-08-24): Server Core built successfully and the
focused agent runtime/bridge/observation/router suites passed 49/49. A remote
agent context is routed through its immutable project-environment binding and
declared remote capability; missing or stale bindings fail explicitly and never
invoke the This-server adapter. The same suite proves immutable environment
revision propagation for long-lived operations and no remote local-spawn/file/
Git fallback.

Teardown evidence (2026-08-24): Server Core rebuilt and the focused runtime,
bridge, agent-service, and host suites passed 43/43. The table-driven runtime
matrix invokes each cause twice and proves exact-once retirement for terminal
exit, provider disable, provider update, project removal, environment revision,
child crash, and server shutdown. Host-originated retirement re-enters the
runtime callback once and permits a new admission; a stalled retirement leaves
an unrelated healthy provider context usable.

### Generic Server Core composition

- [x] Replace the closed provider union with validated namespaced provider ids.
- [x] Build an extension-backed agent provider registry.
- [x] Compose providers with the exact project environment and terminal
  incarnation.
- [x] Keep authorization, binding scope, canonical sequence assignment, replay
  rejection, store reduction, acknowledgement, and snapshots in Server Core.
- [x] Preserve the existing client protocol and provider-neutral Agents UI.
- [x] Retire provider entries on disable/crash without affecting other providers.
- [x] Preserve generic terminal activity whenever authoritative observation is
  unavailable.

Evidence (2026-08-24): `npm run build --workspace @terminay/server-core`
succeeded; 39 focused runtime, host, local-adapter, and lifecycle tests passed;
and `npm run typecheck --workspace @terminay/desktop` passed. The evidence
covers exact terminal-incarnation claims before child admission, canonical
lifecycle publication ordering, cross-project rejection, debounced
re-observation, cancellation/release, local opaque-handle confinement, and
fallback to legacy/generic activity for non-matching or remote-routed terminals.
The legacy provider union and hard-coded driver/journal implementation are now
removed: provider ids are validated namespaced manifest ids and the canonical
server reducer accepts only extension lifecycle DTOs. The focused agent suites
passed 11/11, the status/client suites passed 27/27, the complete Server Core
suite passed 616/617 (one explicitly skipped), Client Core passed 157/157,
protocol conformance built, and Desktop typecheck passed. The boundary gate
passed 2/2, proving extension code imports only the public SDK and generic
core/renderer contain no provider CLI, journal, root, or mapping details.
Remote observation routing and exhaustive host lifecycle guarantees remain
unchecked.

Hardening evidence (2026-08-24): runtime publications validate their whole
batch before store mutation, so invalid transitions leave both store and
sequence unchanged. The per-context bridge serializes publications, bounds the
queue and acknowledgement deadline, coalesces idempotent retries, and rejects
cancelled queued work before it reaches the store. Provider disablement retires
only that provider's contexts exactly once; project removal and child retirement
are likewise exact/idempotent, while a crashing extension remains isolated from
other providers.

Flow-control evidence (2026-08-24): after a Server Core rebuild, the focused
runtime/bridge/service/host suite passed 47/47 and the status/client sequence
regression suite passed 27/27. It proves per-context overflow is rejected
without a store call, a queued publication and its stalled predecessor both
expire at their acknowledgement deadline, a late retry after retirement reaches
neither the store nor an unrelated provider, and a 65-event publication is
rejected atomically. Retried publication ids retain one acknowledgement, while
canonical lifecycle revisions and sequences remain monotonic.

Dependency/vault host evidence (2026-08-24): Server Core rebuilt; its focused
extension-host and provider-vault suites passed 23/23, and the complete Server
Core suite passed 630/630. Dependency routing authenticates caller and target,
requires the caller's declared external extension and target operation, and
forwards bounded deadlines, cancellation, idempotency keys, and revisions.
Target-vault references are opaque and scoped to extension installation and
provider; encrypted Server-vault writes are revisioned and atomically replace
the durable binding, while transient `withSecret` bytes remain local and are
zeroized. Pending removal blocks new leases and cleanup completes after active
work or host interruption. The focused suites also cover undeclared/duplicate
providers, stale retired contexts, invalid transitions, oversized messages, and
cross-terminal opaque handles.

### SSH and Puzed relocation

- [x] Copy the canonical SSH package content into `extensions/ssh`, excluding
  `.git`, `node_modules`, caches, and generated build output.
- [x] Copy the canonical Puzed package content into `extensions/puzed` with the
  same exclusions.
- [x] Preserve npm names, extension ids, provider ids, profile ids, and persisted
  environment compatibility.
- [x] Replace repository-relative SDK dependencies with workspace/public package
  declarations that also pack correctly.
- [x] Move tests, fixtures, generated-contract workflows, licences, READMEs, and
  publication metadata.

Evidence (2026-08-24): SSH relocation passed its 28-test workspace suite,
including self-contained packed activation, public manifest conformance,
SDK-only boundaries, and managed-binding tests that permit only the declared
Puzed caller and return neither private-key bytes nor vault references. Puzed
passed typecheck and its 16-test workspace suite including packed activation;
its runtime forwards exact revision-bound terminal/filesystem requests only via
the public SSH dependency and does not expose its API key in dependency calls.
Both package manifests pass public conformance and their READMEs document the
managed-binding/vault ownership boundary. `npm ci --ignore-scripts --dry-run`
also resolved the unified workspace successfully, and `git diff --check`
passed. The retained hard-coded production composition is deliberately not
marked complete until packed-extension parity replaces it.

- [x] Remove the private Puzed/SSH production composition after packed-extension
  parity passes.

Cutover evidence (2026-08-24): SSH passed 28/28 package tests and its Docker
E2E passed 3/3, proving packed-host agent scope plus strict trust, password and
vault-key authentication, PTY, SFTP, transport loss, and restart. Puzed passed
16/16 plus packed activation. The packed Puzed-to-generic-host-to-SSH-to-vault
Docker integration passed: it proves trust approval, generated-key storage in
the target vault, SFTP write/read, Puzed restart recovery, target disable
fail-closed behavior, and recovery after SSH restarts. Server Core passed
631/631, Desktop typecheck passed, workspace and reverse agent boundary gates
passed, and `git diff --check` passed. Commit `0a3652a` deletes the private
SSH/Puzed composition/runtime/adapter and their tests; production Desktop and
standalone wiring now call generic `createProductionExtensionManagement`, with
no SSH/Puzed-specific composition symbols remaining in production source.

### Codex extension

- [x] Create the independently packable `extensions/agent-codex` project.
- [x] Move executable recognition, effective home resolution, process-bound
  rollout discovery, root/subagent selection, and resume/rebind behavior.
- [x] Move all Codex mapping versions, compatibility selection, fixtures, and
  privacy exclusions.
- [x] Verify title/prompt, model, tool, approval, elicitation, completion, exit,
  collaboration child, and malformed-record behavior.
- [x] Document supported versions, evidence, mappings, limitations, and real-CLI
  smoke commands.

- [x] Follow the exact terminal's Codex session index so an explicit
  `thread_name` title is reflected initially and every later rename updates the
  existing sidebar root live, including a resumed session and atomic
  replacement/truncation of the index, without changing lifecycle or child
  state or leaking another terminal's title.

Title-index evidence (2026-08-24): the Codex extension resolves only the
issued terminal's `CODEX_HOME/session_index.jsonl` (or bounded
`~/.codex/session_index.jsonl`) using the public observation broker, then
normalizes only a matching bounded `id`/`thread_name` record into
`agent.metadata`. Its compound test covers initial title, two renames,
replacement, truncation, a resumed root id, unrelated-session exclusion, and
one unchanged session/turn/done lifecycle. `npm run typecheck --workspace
terminay-agent-codex`, `npm test --workspace terminay-agent-codex` (15/15),
`npm run test:compat --workspace terminay-agent-codex`, `npm run test:packed
--workspace terminay-agent-codex`, public manifest conformance,
`npm run test:agent-runtime` (26/26 plus boundary 2/2), and Client Core
agent-status tests (13/13) passed.

- [x] Discover Codex subagent rollout journals from the bounded exact-terminal
  sessions root and attach initial and later discoveries through the public
  `childSources` / `childSourceDiscovery` contract only when their native
  `source.subagent.thread_spawn.parent_thread_id` equals the current root
  session. Map their bounded nickname/role/path/model and lifecycle without
  using collaboration event guesses, timestamps, display text, or a second
  root binding.

Child-rollout evidence (2026-08-24): the Codex extension uses the public,
bounded terminal-scoped directory list and watch APIs, retains stable native
child session ids across initial and changed snapshots, and revalidates the
native nested parent id before mapping. Its compound tests prove initial child
projection, a child that appears after the root binding, exact-parent matching,
unrelated-child rejection, bounded title/model mapping, child lifecycle, and
root-binding preservation.

Approval/elicitation evidence (2026-08-24): `npm run typecheck --workspace
terminay-agent-codex`, `npm test --workspace terminay-agent-codex` (12/12),
`npm run test:compat --workspace terminay-agent-codex` (1/1), `npm run
test:packed --workspace terminay-agent-codex` (1/1), and public manifest
conformance all passed. The table-driven mapper test covers all five supported
wait variants—exec approval, patch approval, permissions, user input, and
elicitation—using bounded native ids/reasons and proving `wait.finished` before
subsequent progress. Malformed, null, unknown, overlong type, overlong id, and
oversized physical records fail closed; assertions confirm request bodies,
paths, questions, options, permissions, patches, and commands never publish.

### Claude Code extension

- [x] Create the independently packable `extensions/agent-claude-code` project.
- [x] Move executable recognition, project-root resolution, process-bound new
  session discovery, exact resume binding, and persistent rebind behavior.
- [x] Move title, model, tool, permission, completion, and Agent child mappings.
- [x] Verify unrelated-history rejection, subagent-root exclusion, privacy, and
  malformed-record behavior.
- [x] Document supported versions, evidence, mappings, limitations, and real-CLI
  smoke commands.

Evidence (2026-08-24): `npm run typecheck --workspace
terminay-agent-claude-code` passed; `npm run test:packed --workspace
terminay-agent-claude-code` passed 1/1; `npm test --workspace
terminay-agent-claude-code` now passes 14/14; and `node
packages/extension-api/dist/conformance.js
extensions/agent-claude-code/package.json` accepted the public manifest. The
suite proves exact `--resume`/`-r` UUID binding before a writable journal
exists, rejects a mismatching root header and ambiguous/unrelated history,
excludes sidechains, and checks the bounded privacy mapping. Re-observation is
provided by the generic host lifecycle and remains unmarked until that
integration/cutover evidence exists.

### Cursor Agent extension

- [x] Create the independently packable `extensions/agent-cursor` project.
- [x] Move `agent`/Cursor process recognition and exact writable-chat-store
  binding.
- [x] Move transcript-path validation, bounded title refresh, read-only model
  metadata extraction, user-query fallback, turn state, and completion mapping.
- [x] Verify title/model changes preserve lifecycle state and resume binds the
  correct terminal.
- [x] Keep unsupported child lifecycle absent until stable native identity and
  completion evidence exist.
- [x] Document SQLite fields read, fields excluded, supported versions,
  limitations, and real-CLI smoke commands.

Evidence (2026-08-24): `npm run typecheck --workspace terminay-agent-cursor`
passed; its packed-package suite passed 1/1; `npm test --workspace
terminay-agent-cursor` now passes 8 tests with the authenticated real-CLI smoke
correctly skipped; and `node packages/extension-api/dist/conformance.js
extensions/agent-cursor/package.json` accepted the public manifest. The README
documents its read-only `meta.lastUsedModel` query, excluded data, supported
mapping, privacy, no-inferred-subagent policy, and opt-in smoke command.

Remote Cursor observation deliberately fails closed: the package requires
remote sibling-file and SQLite observation operations before it can bind a
remote chat, and returns no binding rather than reading local/newest-session
state. The generic remote adapter requirement remains unchecked.

### omp extension

- [x] Create the independently packable `extensions/agent-omp` project.
- [x] Move omp/Bun recognition, profile/data-root resolution, PTY breadcrumb
  identity, root/child journal discovery, and atomic replacement behavior.
- [x] Move title-slot handling, mapping versions, model/tool/message/exit records,
  child lifecycle, fixtures, and privacy exclusions.
- [x] Verify memory-only pre-file fallback, resume/rebind, malformed breadcrumb,
  unrelated writer, and unsupported wait behavior.
- [x] Document supported versions, evidence, mappings, limitations, and real-CLI
  smoke commands.

Provider-compound evidence (2026-08-24): `npm run test:agent-extension-compat`
passed all four compatibility suites (Codex 1, Claude 1, Cursor 2, OMP 1),
and `npm run test:agent-extension-packages` passed the provider suites (Codex
10, Claude 14, Cursor 8; one opt-in authenticated Cursor CLI smoke skipped;
OMP 13). The four provider typechecks, four packed-package tests (1/1 each),
and public-manifest conformance commands all passed. The focused compound tests
cover Codex newest exact writable rollout rebind and privacy; Claude exact
new/resume/re-observation; Cursor two-terminal resume isolation and title/model
refresh without UUID/lifecycle replacement; and OMP PTY-breadcrumb resume,
pre-file title fallback, malformed/non-writer rejection, unsupported waits,
and atomic title replacement. No authenticated live-provider smoke was claimed.

Evidence (2026-08-24): `npm run typecheck --workspace @terminay/extension-api`
passed and its suite passed 30/30, including terminal-tty facts, constrained
home/environment-root resolvers, stable child sources, the public harness, and
an independently packed third-party fixture. OMP passed direct TypeScript
checking (`npx tsc -p extensions/agent-omp/tsconfig.json --noEmit`), its main
suite 8/8, compatibility suite 1/1, packed suite 1/1, and public manifest
conformance. Its tests prove specific Bun recognition, OMP/profile/XDG/root
precedence from exact terminal environment facts, exact PTY breadcrumb binding,
writer-proven stable child identity, replacement title metadata, and privacy
filtering. Host environment-adapter and runtime-cutover requirements remain
unchecked.

### Built-in artifact production

- [x] Build and test each `extensions/*` workspace before staging.
- [x] Pack each extension with `npm pack` and validate the packed package rather
  than repository source.
- [x] Materialize and inventory every production dependency with scripts
  disabled and the existing native/lifecycle restrictions enforced.
- [x] Produce deterministic package, file, dependency, permission, contribution,
  and compatibility digests.
- [x] Stage identical artifacts and inventory into Electron and standalone
  server release inputs.
- [x] Add release-boundary tests that detect absent, stale, divergent, or
  non-conformant built-ins.

Evidence (2026-08-24): `npm run build:app` built and tested all six extension
workspaces, packed them with scripts disabled, staged their production closures,
and wrote verified inventory digests. `npm run verify:built-in-extensions`
rehashes and materializes all six successfully. Nine focused artifact/release
tests passed, covering byte-identical copies, tampering, absent inventory, and
stale dependency trees. A native macOS `electron-builder --dir` package was
also verified: its resource inventory and the standalone server inventory are
byte-identical to the staged inventory, and both rehash to the six expected
packages.

### Installation and lifecycle

- [x] Materialize bundled artifacts transactionally into immutable server slots
  on first run without network access.
- [x] Enable built-ins by default only when no explicit user choice exists.
- [x] Preserve disablement, selected overrides, and active slots across release
  reconciliation.
- [x] Support compatible npm override, drain, activation, rollback, and override
  removal to the bundled floor.
- [x] Prevent physical removal of the release's bundled slot.
- [x] Merge catalogue, bundled, installed, override, enabled, compatibility, and
  runtime state into one Settings entry per extension id.
- [x] Isolate materialization/activation failure to the affected extension while
  failing release creation for invalid shipped artifacts.

Evidence (2026-08-24): `npm run test --workspace terminay-agent-codex` passed
6/6, including public tarball packing, exact writable-root binding, mapping,
compatibility, and privacy tests. `npm run build --workspace
@terminay/server-core` succeeded; then the built-in installer, existing
installer, and operations suites passed 13/13. They cover offline immutable
floor materialization, default enablement and disable persistence, override
removal to the floor, reference-safe removal, update drain/rollback, and
isolated malformed-artifact failure. The release-boundary evidence above now
also proves invalid shipped artifacts fail release validation; release
reconciliation and Settings merging are covered by the focused installer and
operations suites: a disabled external override remains selected after a newer
bundled release and removal selects its newer immutable floor; the Settings
DTO presents exactly one entry with bundled, override, enabled, compatibility,
and runtime fields. Runtime cutover remains unchecked.

### Documentation and enforcement

- [x] Turn the proposed author example into shipped SDK documentation.
- [x] Add one complete README and troubleshooting guide per built-in extension.
- [x] Add a minimal third-party agent package that is not derived from an
  official provider.
- [x] Add import-graph rules preventing `extensions/*` from using private
  Terminay packages or source paths.
- [x] Add reverse boundary rules preventing provider executable names, journal
  roots, record schemas, and mapping versions from returning to generic core or
  renderer code.
- [x] Document that extensions are trusted Node programs rather than OS-sandboxed
  code.

Evidence (2026-08-24): each of SSH, Puzed, Codex, Claude Code, Cursor Agent,
and omp has a package README with an installation/compatibility/troubleshooting
section; provider-specific privacy, support, and known limitations are
documented alongside their public manifests and verification commands.

### Verification and cleanup

The original release gates are deliberately decomposed below. A checked box
means there is direct test or commit evidence for that particular behaviour;
it does **not** imply that the broader, live Electron parity gate is complete.

#### Development admission and host wiring

- [x] Stage built-in packed artifacts before development Electron starts, and
  recover when the development artifact directory is absent.
- [x] Resolve a foreground CLI through Node/Bun/interpreter wrapper processes
  before applying an extension's executable matcher.
- [x] Subscribe a live terminal to registered extension providers and dispose
  those subscriptions when the terminal or provider retires.
- [x] Use the selected development resource root, rather than an installed-app
  resource root, for built-in artifact staging and discovery.
- [x] Classify only canonical persisted-workspace failures as workspace
  recovery; ordinary startup failures remain visible as startup failures.
- [x] Migrate legacy failed extension records so stale installed/failed state
  cannot mask a newly materialized bundled floor.
- [x] Hot-reconcile built-ins, activate successful replacements, notify
  contributions, and re-observe existing terminals without restarting healthy
  provider contexts.
- [x] Intersect provider-declared observation requirements with exact
  environment capabilities before admission, returning a safe unavailable
  diagnostic when a required operation is absent.
- [x] Surface safe agent-admission diagnostics to the activity path without
  publishing a false agent root or leaking provider paths/errors.
- [x] Expose SDK 1.2 terminal-scoped directory list/watch operations, including
  cancellation and replacement handling, through the public broker only.

Evidence (2026-08-24): commits `0df7158`, `7242e56`, and `8f8f6ed` cover the
development pre-stage, interpreter-chain, and startup-classification fixes.
Focused Server Core/desktop tests cover subscription teardown, capability
intersection, safe admission diagnostics, legacy-record reconciliation, hot
reconcile/re-observation, and the new directory broker. These are component
proofs; the exact development UI gate remains open below.

#### Provider behaviour and public-package verification

- [x] Verify Codex's exact terminal-scoped `session_index.jsonl` title stream:
  initial title, live rename, replacement/truncation, and resume preserve the
  existing lifecycle root.
- [x] Verify Codex discovers children which appear after the root binding via
  public bounded directory watching, exact native parent identity, and one root
  binding.
- [x] Run public SDK validation, conformance, fixture, cancellation, fuzz, and
  security-boundary suites.
- [x] Run each extension's unit, packed-package, compatibility, and opt-in
  real-provider test command (with unavailable authenticated smoke explicitly
  reported as skipped rather than passed).
- [x] Migrate stale agent test IPC fixtures/callers to the public
  terminal-incarnation protocol, with no legacy private driver bridge.
- [x] Enforce the renderer's generic-provider boundary: provider-specific CLI,
  journal, mapping, and root details cannot enter client or renderer code.

Evidence (2026-08-24): the Codex compound suite covers live title renames and
late children; `npm run test:agent-extension-compat` passed all four provider
compatibility suites; `npm run test:agent-extension-packages` passed SSH/Puzed
and the four agent packages (Cursor's authenticated smoke is opt-in/skipped);
the SDK suite passed 44 tests; and the agent boundary suite passed 2/2.

#### Packaged artifacts and release runtime

- [x] Produce six independently packed, verified built-in artifacts and expose
  one Settings card per built-in in an isolated packaged startup smoke.
- [x] Verify first-run bundled-floor materialization, default enablement,
  persisted disablement, external override removal, and rollback at installer
  scope.
- [x] Run SSH/Puzed packed composition and Docker project-environment E2E.
- [x] Admit a real Codex root, children, and live title update in the **exact
  `npm run dev` Electron process and selected project/terminal**, then assert
  the Agents sidebar updates.

  Exact development admission ladder (2026-08-24, live test in progress):

  - [x] Docker supplies a valid Codex process topology and exact writable
    rollout journal fixture to the selected terminal.
  - [x] Development pre-stage makes the six packed built-ins available before
    Electron starts, and interpreter-chain matching can unwrap the foreground
    Codex command.
  - [x] The actual default-project terminal reports `foregroundBusy: true` and
    observation availability while the wrapper-launched Codex process is live.
  - [x] The selected terminal's foreground-change event carries a `codex`
    executable through the real terminal authority.
  - [x] The installed Codex provider contribution
    (`com.terminay.agent.codex/cli`) is matched for that terminal and
    environment.
  - [x] Server Core admits the exact terminal-incarnation claim and sends the
    extension a terminal-scoped observation context.
  - [x] The Codex extension observes that context and binds the supplied
    rollout journal to the matching native root session.
  - [x] The extension's root lifecycle event is accepted by the canonical agent
    store with a provider-neutral sequence.
  - [x] The renderer receives that canonical root and displays it in the
    Agents sidebar.
  - [x] A later native Codex child journal is discovered, accepted, and shown
    beneath the same root in the sidebar.
  - [x] A later exact-session title rename updates the displayed root title
    without replacing its lifecycle or child state.

  Status (2026-08-24, exact telemetry): fixture topology/journal, development
  staging/matcher prerequisites, and `foregroundBusy: true` with observation
  availability on the actual default-project terminal are independently proven.
  The live ledger now also records `codex` in the foreground callback and the
  exact `com.terminay.agent.codex/cli` contribution match. The exact probe
  additionally reports resolver-to-contribution claim PASS, with foreground
  available; therefore terminal claim/admission is proven. A diagnostic exact
  array failure was test-only: the harmless `MainThread` entry appeared before
  `codex`, rather than contradicting the Codex result. Extension observation,
  canonical publication, and UI handoffs were subsequently proven by the exact
  Docker-isolated Electron test: `1/1` passed in 8.4 seconds. The test supplies
  a valid process topology and native rollout/index/child updates to the actual
  development composition, then observes root, child, and in-place title UI
  projection. The bridge bytes fix and declared `CODEX_HOME` observation input
  are covered by focused tests alongside that E2E artifact. This closes the
  exact-dev gate only; broader Docker/release gates remain below.
- [x] Verify the packaged Electron/standalone runtime activates the staged
  agent extensions, admits their lifecycle, and survives restart/disable/
  override/rollback on supported architectures.

  - [x] Regenerate stale staged built-in artifacts before packaging, rather than
    accepting a stale development staging directory.
  - [x] Verify the packaged Electron resource inventory and extension host
    activate all six built-ins from its packaged resource root.
  - [x] Verify the standalone Server resource inventory and extension host
    activate all six built-ins from its packaged resource root.
  - [x] Exercise the packaged lifecycle matrix: offline first run, restart,
    persisted disablement, compatible override, rollback/removal to floor, and
    corrupted-artifact failure isolation.
  - [x] Admit a Codex terminal in a packaged runtime and observe its canonical
    provider lifecycle through the packaged extension host.
- [ ] Verify Docker's clean dependency manifests install and stage all six
  package closures without relying on local `node_modules` or developer state.
- [ ] Run the complete `npm run test:e2e` through the required Docker-isolated
  Electron path.

Evidence (2026-08-24): the artifact verifier, packaged-startup smoke, and
installer/operations suites prove release inputs and installer semantics;
SSH/Puzed Docker E2E passed. The isolated
`npm run test:packaged-built-in-extension-runtime` matrix then passed 2/2 in
13.1 seconds against the real macOS arm64 Electron resource tree and the
standalone server payload. It materializes each immutable floor into a fresh
temporary profile, starts all six packed child hosts, admits a Codex terminal
through the public observation bridge, reduces its binding and root event in
the canonical agent store, and proves restart disablement, npm override
activation, bundled-floor rollback, corrupt-artifact isolation, and byte-equal
Electron/standalone inventories. The remaining unchecked tests are broader
clean-install and aggregate gates, not this release-runtime proof.

#### Original aggregate gates and final hygiene

- [ ] Run agent store, runtime, UI, resume/rebind, remote-client, disable/crash,
  and privacy tests as one final aggregate command set.
- [ ] Run offline Electron and standalone first-run/restart/override/rollback
  artifact tests on supported architectures.
- [ ] Delete the hard-coded agent drivers/sources and special SSH/Puzed
  composition only after every parity gate passes.

  - [x] Remove the legacy PTY agent bridge so no hard-coded provider path can
    publish alongside an extension provider (commit `7b9b1ca`).
  - [x] Declare generic profile auto-creation through extension contributions,
    with no provider-specific profile bootstrap remaining in production code.
  - [x] Register agent extensions through the generic Electron composition only,
    with no provider-specific Electron registration path.
  - [x] Register agent extensions through the generic standalone Server
    composition only, with no provider-specific standalone registration path.
  - [x] Run the final production-source boundary search proving no legacy agent
    drivers, PTY bridges, provider executable names, journals, mappings, or
    special SSH/Puzed composition symbols remain.

  Generic-environment cutover evidence (2026-08-24): commit `9de4a61` adds
  public profile-save environment creation and declares SSH opt-in through its
  public contribution. The current shared production tree uses generic profile,
  Electron, and standalone extension composition. The API suite passed 46/46,
  Server Core passed 647/647, Desktop and standalone typechecks passed, and
  SSH plus the extension boundary gate passed. The production-boundary search
  found no `createSshEnvironment` or SSH-specific registration in Electron,
  standalone, or generic composition sources; the immutable
  `com.terminay.ssh` declaration remains only in the generic built-in catalog.
- [ ] Consolidate every accepted Task 63 change into the single
  `feat/agent-extensions` branch, remove temporary Task 63 worktrees/branches,
  and prepare one PR only.
- [ ] Move this task to `tasks_completed/` only after release artifact evidence
  and public documentation are complete.

## Fixed architecture

1. Extensions import only `@terminay/extension-api`. No compatibility shim may
   hand them Server Core services, Electron IPC, renderer stores, or raw client
   protocol handlers.
2. Terminay owns terminal/project authorization, environment selection,
   observation admission, canonical event ordering, snapshots, acknowledgement,
   UI, and fallback activity. An agent extension owns only provider-specific
   detection, binding, bounded parsing, and canonical lifecycle projection.
3. Agent observation runs against the terminal's project environment. A This
   server extension may use Node APIs with its host-issued terminal context;
   remote observation uses public environment capability brokers. Local paths
   or PIDs are never substituted for a remote environment.
4. Built-ins pass the same manifest validation, child-host protocol,
   permissions, cancellation, deadlines, and crash isolation as third-party
   packages. `built-in` is an installation origin, not privileged code access.
5. Release artifacts contain packed, verified extension packages. Runtime does
   not execute extension source from the application repository.
6. Disablement is persisted by immutable extension id and survives upgrades.
   Bundled code remains a rollback floor and cannot be physically uninstalled.
7. Move provider behavior only after fixture and real-provider parity gates
   pass. Do not retain a second hard-coded provider registry afterward.

## Public Extension API additions

Add an additive Extension API release with these concepts and closed runtime
validators:

- `AgentProviderContribution`: namespaced provider id, display name, icon,
  supported platforms, CLI executable/process matchers, provider version and
  mapping declarations, and required environment-observation capabilities.
- `agent-observation`: an explicit manifest permission required for agent
  contributions, scoped broker admission, and canonical lifecycle publication.
- `context.agents.registerProvider(definition, runtime)`: activation-time
  registration returning a disposable registration. Duplicate provider ids,
  undeclared contributions, and registrations after deactivation fail closed.
- `AgentTerminalContext`: opaque terminal, project, environment, and process-
  incarnation handles; cwd and process facts are available only when the
  environment proves the corresponding capability.
- `AgentObservationBroker`: bounded/cancellable foreground changes, descendant
  process snapshots, writable-open-file facts, PTY/TTY identity facts, and
  environment-scoped file operations (`realpath`, `stat`, bounded read, and
  append/replace observation). It cannot inspect another terminal or bypass the
  selected environment.
- `AgentObservationRuntime`: callbacks for foreground recognition, bounded
  discovery/rebinding, initial replay, incremental observation, provider exit,
  and cancellation. The host controls retry budgets, concurrency, byte limits,
  backpressure, and observer lifetime.
- `AgentSessionBinding`: stable provider session id, mapping version, bounded
  safe metadata, and a provider-defined binding fingerprint derived only from
  evidence obtained through the scoped broker. Display text is never identity.
- `AgentLifecyclePublisher`: emits validated provider-neutral events for root
  sessions, turns, tools, waits, completion, exit, metadata, and subagents.
  Events carry stable native ids where available, never raw provider payloads.
- `AgentModelMetadata`: stable id plus optional display name, effort, and context
  window. Metadata updates preserve lifecycle state.
- typed diagnostics/fallback reasons that are safe to display without paths,
  prompts, credentials, native payloads, or arbitrary provider errors.

The SDK must include a small driver toolkit for bounded JSONL tailing,
incomplete-line buffering, truncation/atomic-replacement detection, versioned
mapping selection, safe strings, canonical event builders, and fixture replay.
The toolkit accepts public observation adapters and plain data. An extension
may back those adapters with Node APIs for This server or host brokers for a
remote environment. Providers may implement another bounded format without
using the toolkit.

Document every bound, cancellation rule, ordering guarantee, rebind rule,
error class, and lifecycle example in generated API reference material. Add a
minimal third-party agent example distinct from the four official providers so
the API is proven general rather than shaped around an internal import.

## Delivery milestones

### 1. Contract and conformance

- Extend manifests, permissions, contribution schemas, public types, runtime
  validation, host IPC messages, fixtures, and conformance tooling.
- Add capability negotiation so an agent provider receives only observation
  operations supported by the exact environment.
- Define bounded stream flow control, cancellation, terminal teardown, child
  crash, restart/backoff, and stale-event rejection.
- Add compile-time examples and packed-extension conformance tests proving no
  private dependency is needed.

Gate: a fixture agent extension discovers a fake process-bound session, tails
records, emits root/child/model/wait/done events, survives replacement and
rebind, and is denied cross-terminal/cross-environment access.

### 2. Host composition and canonical projection

- Replace the internal provider registry entrypoint with an extension-backed
  registry while keeping the canonical Agent Status store and client protocol
  provider-neutral.
- Route observation brokers through project-environment capabilities for local
  and remote environments.
- Enforce provider namespace, terminal incarnation, session binding, ordering,
  replay, and lifecycle validation in the host rather than trusting child
  sequence or scope assertions.
- Ensure extension disable/crash/restart retires only its own live bindings and
  leaves terminal activity fallback available.

Gate: canonical store, sidebar, header, tab, remote-client, disable/crash, and
cross-project tests pass using only the fixture extension.

### 3. Repository-owned SSH and Puzed packages

- Import the canonical package content from
  `../terminay-plugin-ssh-agents` and `../terminay-plugin-puzed` into
  `extensions/ssh` and `extensions/puzed` without copied `.git`, build output,
  caches, or `node_modules`.
- Update workspace dependencies, package metadata, release workflows,
  conformance paths, documentation links, and packed-composition tests.
- Preserve package names and immutable extension/provider ids so profiles,
  projects, dependencies, and published consumers need no identity migration.
- Remove repository-relative development dependencies and prove each tarball
  installs and activates independently against the public SDK.

Gate: SSH/Puzed unit, packed-host, composition, and Docker project-environment
E2E pass from their `extensions/` packages.

### 4. Four agent extension packages

- Create `extensions/agent-codex`, `agent-claude-code`, `agent-cursor`, and
  `agent-omp`, each with independent package metadata, README, fixtures,
  compatibility tests, and public-API-only boundary checks.
- Move each provider's foreground detection, process/journal binding, mapping
  registry, parser, metadata refresh, and subagent behavior into its package.
- Keep canonical state reduction and all renderer code provider-neutral.
- Record honest per-provider limitations. In particular, never infer waiting,
  completion, or child identity when the native durable format does not provide
  authoritative evidence.
- Add opt-in real-CLI smoke tests and captured, redacted compatibility fixtures.

Gate: each provider independently passes new/resume/rebind/title/model/state,
exit, malformed/oversized input, privacy, disable/re-enable, and supported
subagent behavior. Existing agent UI behavior remains unchanged.

### 5. Deterministic built-in bundling

- Add `extensions/*` to the workspace/build graph and create a release staging
  command that builds, tests, `npm pack`s, inspects, and inventories every
  built-in plus its production dependency closure.
- Include the resulting immutable inventory and artifacts in Electron resources
  and every standalone server archive/container architecture.
- Materialize built-ins transactionally on first run and reconcile release
  slots without network access, re-enabling, hot swap, or override loss.
- Expose one merged Settings record with Built in/Official origin, disable,
  restart, override update, rollback, and external-override removal behavior.
- Add release checks for byte/inventory parity between Electron and standalone
  distributions and for missing/stale/unconformant packages.

Gate: clean offline installs expose six enabled built-ins; disablement persists;
an npm override can roll back to the bundled floor; corrupt/missing artifacts
fail only the affected extension and fail release validation.

### 6. Remove hard-coded implementations and finish documentation

- Delete Server Core's provider-specific agent source/driver registry and the
  special SSH/Puzed production composition after extension parity is proven.
- Keep only generic extension hosting, environment capability routing,
  canonical Agent Status projection, and generic UI in core.
- Publish the complete Agent API guide, one tutorial per official package,
  manifest reference, security/privacy guide, testing guide, and a from-scratch
  third-party example.
- Add architecture/boundary tests that prevent provider ids, journal roots, CLI
  names, or native record schemas from returning to generic core or renderer
  modules.

## Acceptance checks

- `rg`/dependency-graph gates find no provider-specific agent implementation in
  Server Core, Electron, client-core, or renderer code.
- All six built-ins are independently packable public npm projects and import
  only the public SDK plus declared third-party dependencies.
- Local, SSH, and Puzed-backed terminals use the same agent-extension contract;
  missing remote observation degrades explicitly to generic activity.
- Desktop and browser clients receive only canonical bounded snapshots and
  never extension code or native journal records.
- Provider title/model changes preserve lifecycle state; resume/rebind cannot
  cross terminal, project, environment, or process-incarnation boundaries.
- Disabling each agent package removes only that provider's live observation;
  disabling SSH/Puzed follows ordinary dependency/in-use rules.
- Electron and standalone server artifacts pass offline first-run, restart,
  disable persistence, override, rollback, corruption, and inventory-parity
  tests on every supported platform architecture.
- `npm run test:e2e` passes through the required Docker-isolated Electron path.

## Definition of done

The public SDK is sufficient to implement all four official agent integrations
and both environment providers without private imports; the repository ships
their verified package artifacts in every server distribution; default
enablement and user disablement are durable; provider-specific agent code no
longer exists in core; and the public documentation is complete enough for a
third party to build, test, package, and diagnose an agent extension without
reading Terminay source.
