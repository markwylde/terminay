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

- [ ] Add `extensions/*` to the npm workspace graph and boundary tooling.
- [ ] Add `agent-observation` to public permission types and runtime validation.
- [ ] Add optional `contributes.agentProviders`; require at least one supported
  contribution across project environments and agent providers.
- [ ] Define and validate namespaced agent provider ids, display metadata,
  platforms, process matchers, mapping declarations, and capability needs.
- [ ] Export the canonical agent lifecycle, model, tool, wait, completion,
  subagent, binding, diagnostic, and cancellation types from the public SDK.
- [ ] Add runtime schemas and size/count/depth limits for every new public DTO.
- [ ] Update manifest reference, API reference, permissions guide, author guide,
  fixtures, conformance CLI, and generated declarations.

### Extension host protocol

- [ ] Add child/parent messages for provider registration and disposal.
- [ ] Add terminal-incarnation admission and cancellation messages.
- [ ] Add bounded request/response operations for environment observation.
- [ ] Add flow-controlled lifecycle publication with deadlines and backpressure.
- [ ] Reject undeclared providers, duplicate ids, stale contexts, invalid event
  transitions, oversized messages, and cross-terminal handles.
- [ ] Ensure disable, update, terminal exit, project removal, environment change,
  child crash, and server shutdown cancel observers exactly once.
- [ ] Preserve per-extension process isolation and restart/backoff behavior.

### Observation adapters and SDK toolkit

- [ ] Define the public observation-adapter interface used by driver utilities.
- [ ] Implement This server adapters using Node process, TTY, open-file, and
  filesystem APIs.
- [ ] Route remote adapters through project-environment capabilities without
  substituting local PIDs, cwd, home directories, or paths.
- [ ] Implement bounded JSONL replay/follow, partial-line buffering, truncation,
  inode/device replacement, and cancellation helpers.
- [ ] Implement versioned mapping selection and safe event-builder helpers.
- [ ] Add typed unavailable/fallback diagnostics without raw provider errors.
- [ ] Add the public in-memory agent-extension test harness used by the author
  example.

### Generic Server Core composition

- [ ] Replace the closed provider union with validated namespaced provider ids.
- [ ] Build an extension-backed agent provider registry.
- [ ] Compose providers with the exact project environment and terminal
  incarnation.
- [ ] Keep authorization, binding scope, canonical sequence assignment, replay
  rejection, store reduction, acknowledgement, and snapshots in Server Core.
- [ ] Preserve the existing client protocol and provider-neutral Agents UI.
- [ ] Retire provider entries on disable/crash without affecting other providers.
- [ ] Preserve generic terminal activity whenever authoritative observation is
  unavailable.

### SSH and Puzed relocation

- [ ] Copy the canonical SSH package content into `extensions/ssh`, excluding
  `.git`, `node_modules`, caches, and generated build output.
- [ ] Copy the canonical Puzed package content into `extensions/puzed` with the
  same exclusions.
- [ ] Preserve npm names, extension ids, provider ids, profile ids, and persisted
  environment compatibility.
- [ ] Replace repository-relative SDK dependencies with workspace/public package
  declarations that also pack correctly.
- [ ] Move tests, fixtures, generated-contract workflows, licences, READMEs, and
  publication metadata.
- [ ] Remove the private Puzed/SSH production composition after packed-extension
  parity passes.

### Codex extension

- [ ] Create the independently packable `extensions/agent-codex` project.
- [ ] Move executable recognition, effective home resolution, process-bound
  rollout discovery, root/subagent selection, and resume/rebind behavior.
- [ ] Move all Codex mapping versions, compatibility selection, fixtures, and
  privacy exclusions.
- [ ] Verify title/prompt, model, tool, approval, elicitation, completion, exit,
  collaboration child, and malformed-record behavior.
- [ ] Document supported versions, evidence, mappings, limitations, and real-CLI
  smoke commands.

### Claude Code extension

- [ ] Create the independently packable `extensions/agent-claude-code` project.
- [ ] Move executable recognition, project-root resolution, process-bound new
  session discovery, exact resume binding, and persistent rebind behavior.
- [ ] Move title, model, tool, permission, completion, and Agent child mappings.
- [ ] Verify unrelated-history rejection, subagent-root exclusion, privacy, and
  malformed-record behavior.
- [ ] Document supported versions, evidence, mappings, limitations, and real-CLI
  smoke commands.

### Cursor Agent extension

- [ ] Create the independently packable `extensions/agent-cursor` project.
- [ ] Move `agent`/Cursor process recognition and exact writable-chat-store
  binding.
- [ ] Move transcript-path validation, bounded title refresh, read-only model
  metadata extraction, user-query fallback, turn state, and completion mapping.
- [ ] Verify title/model changes preserve lifecycle state and resume binds the
  correct terminal.
- [ ] Keep unsupported child lifecycle absent until stable native identity and
  completion evidence exist.
- [ ] Document SQLite fields read, fields excluded, supported versions,
  limitations, and real-CLI smoke commands.

### omp extension

- [ ] Create the independently packable `extensions/agent-omp` project.
- [ ] Move omp/Bun recognition, profile/data-root resolution, PTY breadcrumb
  identity, root/child journal discovery, and atomic replacement behavior.
- [ ] Move title-slot handling, mapping versions, model/tool/message/exit records,
  child lifecycle, fixtures, and privacy exclusions.
- [ ] Verify memory-only pre-file fallback, resume/rebind, malformed breadcrumb,
  unrelated writer, and unsupported wait behavior.
- [ ] Document supported versions, evidence, mappings, limitations, and real-CLI
  smoke commands.

### Built-in artifact production

- [ ] Build and test each `extensions/*` workspace before staging.
- [ ] Pack each extension with `npm pack` and validate the packed package rather
  than repository source.
- [ ] Materialize and inventory every production dependency with scripts
  disabled and the existing native/lifecycle restrictions enforced.
- [ ] Produce deterministic package, file, dependency, permission, contribution,
  and compatibility digests.
- [ ] Stage identical artifacts and inventory into Electron and standalone
  server release inputs.
- [ ] Add release-boundary tests that detect absent, stale, divergent, or
  non-conformant built-ins.

### Installation and lifecycle

- [ ] Materialize bundled artifacts transactionally into immutable server slots
  on first run without network access.
- [ ] Enable built-ins by default only when no explicit user choice exists.
- [ ] Preserve disablement, selected overrides, and active slots across release
  reconciliation.
- [ ] Support compatible npm override, drain, activation, rollback, and override
  removal to the bundled floor.
- [ ] Prevent physical removal of the release's bundled slot.
- [ ] Merge catalogue, bundled, installed, override, enabled, compatibility, and
  runtime state into one Settings entry per extension id.
- [ ] Isolate materialization/activation failure to the affected extension while
  failing release creation for invalid shipped artifacts.

### Documentation and enforcement

- [ ] Turn the proposed author example into shipped SDK documentation.
- [ ] Add one complete README and troubleshooting guide per built-in extension.
- [ ] Add a minimal third-party agent package that is not derived from an
  official provider.
- [ ] Add import-graph rules preventing `extensions/*` from using private
  Terminay packages or source paths.
- [ ] Add reverse boundary rules preventing provider executable names, journal
  roots, record schemas, and mapping versions from returning to generic core or
  renderer code.
- [ ] Document that extensions are trusted Node programs rather than OS-sandboxed
  code.

### Verification and cleanup

- [ ] Run SDK validation, conformance, fixture, cancellation, fuzz, and security
  boundary suites.
- [ ] Run each extension's unit, packed-package, compatibility, and opt-in
  real-provider tests.
- [ ] Run SSH/Puzed packed composition and Docker project-environment E2E.
- [ ] Run agent store, runtime, UI, resume/rebind, remote-client, disable/crash,
  and privacy tests.
- [ ] Run offline Electron and standalone first-run/restart/override/rollback
  artifact tests on supported architectures.
- [ ] Run `npm run test:e2e` through the Docker-isolated Electron path.
- [ ] Delete the hard-coded agent drivers/sources and special SSH/Puzed
  composition only after every parity gate passes.
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
