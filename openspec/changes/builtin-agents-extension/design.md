## Context

Agent status today has three layers:

1. **Five extensions.** `extensions/agent-{claude-code,codex,grok,omp,opencode}` each own a journal format, process-binding rules, mapping versions, fixtures, a real-CLI conformance Dockerfile, and a README.
2. **The Server Core observation runtime.** It spans roughly 3,000 lines across several files:
   - `packages/server-core/src/extensions/localAgentObservation.ts`: ps, lsof, `/proc`, and bounded directory list/watch.
   - `activity/extensionAgentRuntime.ts`: foreground matching, incarnation admission, not-bound watches, and the ramp schedule.
   - The `jsonlSession` driver in `extensions/child.ts`.
   - Binding validation in `activity/agentService.ts`.
3. **The Extension API 2.x contract.** `agentProviders`, `observe(terminalCtx)`, the observation broker, the lifecycle publisher, and the driver toolkit sit between the first two layers.

A root entry cannot exist without a terminal (`agentTypes.ts` requires `terminalSessionId`). The Agents pane (`App.tsx` `projectAgentItems`) shows only entries whose activation terminal is one of the project's panels.

The **Install Terminay MCP** modal (`src/components/McpInstallModal.tsx`) calls the `mcp-install.status|install|uninstall` protocol operations. On Desktop these are wired in `electron/serverTerminalAuthority.ts` to `electron/mcpInstall/`, one writer per client. The MCP server command (`process.execPath` + `dist-electron/serverMcpEntry.js` + `ELECTRON_RUN_AS_NODE=1`) is computed in `electron/main.ts`.

`@markwylde/all-your-agents` (1.4.x at the time of writing) watches every session on the machine for Claude Code, Codex, Grok, and oh-my-pi. It never polls, and it emits session lifecycle events with status, title, model, activity, and subagents. It has an optional native dependency, `koffi`, which gives kqueue/pidfd process-exit watches. Koffi 2.x ships prebuilt N-API binaries for every platform inside its tarball (about 28 MB) and works with `--ignore-scripts`. The extension installer currently rejects any `.node` file, and the stage script ignores `optionalDependencies`.

The user's decisions are recorded in `questionnaires/scope.yaml`:

- **External agents:** show them, marked external, and do nothing on click.
- **OpenCode:** drop agent status until the library supports it.
- **Native modules:** allow native dependencies for all extensions.
- **Extension API:** delete the old API and bump the SDK to 3.0.
- **MCP:** use a narrow `mcpInstallTargets` contribution, with the host keeping the modal.
- **Harnesses:** keep per-harness switches.

## Goals / Non-Goals

**Goals:**

- One built-in extension, `terminay-builtin-agents`, whose only detection logic is `@markwylde/all-your-agents`.
- Delete every piece of Terminay-owned agent detection: host and extension, runtime and tests.
- Show all live agents whose cwd is inside the project, recursively, or inside any worktree of its repository, including agents not started in Terminay.
- Keep tab dots, click-to-focus, and acknowledgement for agents running in Terminay terminals.
- Move MCP registration writers into the same extension without changing the MCP modal's user-facing behaviour.
- Per-harness switches.

**Non-Goals:**

- OpenCode agent status. It returns when the library adds an OpenCode provider.
- Resuming or opening external sessions, or showing transcripts. External rows are inert.
- A generic extension UI or command surface.
- MCP install on the standalone server. It stays Desktop-only as today.
- Windows support. The library does not support Windows, and neither did the old providers.

## Decisions

### D1. One extension, detection only through the library

`extensions/builtin-agents` has extension id `com.terminay.builtin-agents` and display name "Built-in Agents". Its source has three parts:

- `src/source.ts`: the library adapter.
- `src/mcp/`: the six install targets, moved from `electron/mcpInstall/` with `atomicConfigWrite` and `tomlEntry`.
- `src/index.ts`: `defineExtension`.

It pins an exact library version, with no caret, so the published capability matrix is the one actually running.

**Alternatives considered:**

- Keep five extensions, each wrapping one library provider. This multiplies library instances and watchers five times, and the library is designed as one instance with a provider list.
- Run the library in Server Core. This breaks the rule that provider knowledge lives in extensions, and the user asked for an extension.

**Boundary:** the extension child is the only process that reads provider files. That preserves the journal privacy boundary: only bounded snapshot fields cross the host IPC.

### D2. Extension API 3.0: snapshot sources instead of terminal observers

The API changes as follows:

- **Removed:** `contributes.agentProviders`, `context.agents.registerProvider`, `observe`, `matchesForeground`, `jsonlSession`, `notBound`, `unavailable`, the terminal context, the observation broker, the lifecycle publisher, `bindSession`, the driver toolkit, and the observation adapters.
- **Added:** `contributes.agentSessionSources[]` = `{ id, displayName, platforms, harnesses: [{ id, displayName }], environmentVariables }`, registered with `context.agents.registerSessionSource(id, runtime)`.
- **Runtime:** `runtime.start({ enabledHarnesses, publisher, signal, onEnabledHarnessesChanged })`.
- **Publisher:** `reset(sessions[])`, `upsert(session)`, and `remove(sessionId)`, where `session` is the bounded snapshot shape in the spec.

The SDK version goes from 2.1.0 to 3.0.0, and the host accepts only `^3`. No shim is provided (user decision); only Terminay's own packages used the old contract.

**Why snapshots rather than lifecycle events:** the library already reduces events into a session object. Re-encoding that as turn, tool, and wait events and then re-reducing them in Server Core is exactly the double state machine that went wrong before. The host keeps one reducer from snapshot to entry.

**Alternative considered:** keep the canonical lifecycle publisher and translate library events into it. This was rejected for the reason above, and because the publisher is terminal-context-scoped.

### D3. The host maps snapshots to entries; the agent store loses the terminal requirement

A new `activity/sessionSourceBridge.ts` replaces `extensionAgentRuntime.ts` and the binding half of `agentService.ts`:

- **Entry id:** `<sourceId>/<sessionId>`. Children are `<sourceId>/<sessionId>/<subagentId>`.
- **Root fields:** `terminalSessionId` becomes optional on root entries. A new `external: boolean` and `projectIds: string[]` are computed server-side.
- **State mapping:** follows the spec table.
- **`done` rule:** an entry is `done` only when `lastTurnEndedAt` is later than both the entry's creation and its last acknowledgement. A session that was already idle when reported at startup therefore never flashes green.
- **Flow control:** publication batching, bounds, deadlines, and monotonic revisions are kept from the existing bridge (`extensionAgentBridge.ts`), re-keyed per source rather than per terminal context.
- **Unchanged:** the reducer, store, protocol, acknowledgement, and client subscription.

### D4. Project scoping: directory prefix plus Git worktrees, watched

A new `activity/projectAgentScope.ts` handles scoping. For each open project it resolves:

- the canonical project root (per ADR-0020, canonicalised per operation)
- the repository's worktree set, from `git worktree list --porcelain` run through the existing server Git client

It watches the repository's common-dir `worktrees/` directory and re-resolves the set on change, damped by the shared ramp schedule (ADR-0022). A session belongs to a project when its canonical cwd equals, or is below, the root or any worktree path.

The result is stamped as `projectIds` on each entry, and the client filters by `projectId` instead of by terminal-panel membership. The mapping is recomputed when a session's cwd changes, when a project opens or closes, and when a worktree set changes.

**Boundary:** project membership becomes a server-computed authority input. It is computed from canonical server-owned project roots only, never from client-supplied paths.

**Alternatives considered:**

- Filtering in the extension: the extension does not know projects.
- Using the library's `sessions({ cwd })` filter: exact-match only, with no recursion or worktrees.

**Deviation found in implementation:** `projectAgentScope` runs `git rev-parse --git-common-dir` and `git worktree list --porcelain` directly, reusing the server's `parseWorktreeList`. It does not go through `GitService.worktrees()`, because that call also computes status for every worktree, which is far more work than scoping needs and would run on every worktree-set change. The commands are still bounded, run only on the edges above, and only ever against canonical server-owned project roots.

### D5. Terminal binding: process ancestry, computed on edges

Binding works as follows:

- **When an upsert introduces a pid:** the bridge walks that pid's parent chain once. It reads `/proc/<pid>/stat` on Linux; on macOS it makes one `ps -o ppid= -p` call per hop, bounded to 64 hops. If the chain reaches a PTY shell pid the server spawned, the entry binds to that terminal's full identity. The chain is cached per pid.
- **When a PTY exits:** the cache entries under that PTY are dropped, and every entry bound to that terminal is re-bound or becomes external.
- **When a terminal's foreground edge fires:** the bridge re-checks only the unbound live pids, which are few.

No timer is involved.

**Alternatives considered:**

- The extension reports the ppid chain. This was rejected because terminal binding is a host security boundary, and the host must not trust an extension's claim about which PTY owns a process.
- Binding by tty. This does not work for Codex under VS Code, and is weaker than ancestry.

### D6. External sessions

Entries with no binding carry `external: true`:

- The renderer draws an "External" badge.
- Row activation is a no-op.
- The store treats them as always acknowledged, so tab dots, project activity counts, and the header aggregate never include them.

If an external session later binds, for example because its pid's ancestry is re-read after a foreground edge, the same entry flips to bound.

### D7. Per-harness switches

Harness switch state is stored as the server setting `agentIntegration.harnesses: Record<"<sourceId>/<harnessId>", boolean>`, with a missing key meaning on. `ExtensionManager.tsx` renders one switch per declared harness under the extension row. The host sends the enabled set to the running source; the extension restarts its library instance with only those providers and publishes a reset. The global `agentIntegration.enabled` switch still stops every source.

**Harness ids and library providers:**

| Harness id | Library provider |
|---|---|
| `claude-code` | `claudeCode()` |
| `codex` | `codexCli()` |
| `grok` | `grokBuild()` |
| `oh-my-pi` | `ohMyPi()` |

### D8. Native dependencies allowed for every extension

The installer and staging change as follows:

- `packageValidation.ts` stops rejecting `.node` files. It still rejects `binding.gyp`, because that means a build is required, and install scripts are still never run.
- npm keeps `--ignore-scripts`, so a package whose native module needs its install script to work simply fails its activation probe. That is the existing fail-closed path.
- `stage-built-in-extensions.mjs` stages `optionalDependencies` too, so koffi's prebuilds ship.
- Staging does not prune per-architecture binaries, because the Electron and standalone inventories must stay byte-identical.
- On macOS with a Developer ID identity (`CSC_NAME`, or auto-discovered unless `CSC_IDENTITY_AUTO_DISCOVERY=false`), staging codesigns each Mach-O `.node` before hashing, and `electron-builder.json5` sets `mac.signIgnore` for `built-in-extensions/**.node`. Re-signing inside electron-builder would change their bytes and fail the inventory check; pre-signing keeps the hash true and notarisation satisfied.

**Boundary:** ADR-0011's npm-registry → installer boundary. Extensions were already trusted Node programs with the server account's authority, so a prebuilt `.node` adds no authority an extension lacked; it adds supply-chain surface of the same class as any JS dependency. This decision is recorded as a new ADR.

### D9. MCP install targets in the extension

The API gains `contributes.mcpInstallTargets[]` = `{ id, displayName }`, registered with `context.mcp.registerInstallTarget(id, { status, install, uninstall })`. Each call receives the `McpServerCommand` and a signal.

**Host routing:**

- The `mcp-install.*` protocol operations are unchanged on the wire. They are re-routed in `serverTerminalAuthority.ts` from `electron/mcpInstall` to a Server Core `McpInstallRouter` that fans out to the registered targets.
- Desktop passes `getMcpServerCommand()` into the server composition as `mcpServerCommand`. The standalone server passes none, so every target reads `unavailable`.
- The modal renders targets in declaration order, and shows a "Built-in Agents extension is disabled" state when there are none.
- Target ids are `com.terminay.builtin-agents/<client>`. The modal keys by target id.

**Compatibility test:** `Dockerfile.mcp-cli-compat` and the three `scripts/mcp-install-*.test.mjs` suites import the target modules from the extension package directly.

**Boundary:** the extension writes to user-owned CLI configuration files. It already had that authority as a trusted Node program. The host still owns when a write happens, because writes happen only in response to the authenticated `mcp-install.*` operation.

### D10. Deletions

Deleted:

- the five `extensions/agent-*` directories
- `tests/agent-conformance/`, `.gitea/workflows/agent-conformance.yml`, and `scripts/run-agent-conformance-container.sh`
- `e2e/extension-grok-agent-runtime.spec.ts`, `e2e/real-claude-code-agent-runtime.spec.ts`, `e2e/real-codex-agent-runtime.spec.ts`, and `e2e/claude-code-multi-terminal.spec.ts`
- the server-core observation and runtime files (`localAgentObservation.ts`, `extensionAgentRuntime.ts`, the `child.ts` JSONL driver, and binding validation). `rampSchedule.ts` stays, because the worktree-metadata watch (D4) reuses it, as ADR-0022 requires.
- `electron/mcpInstall/` provider writers
- `packages/extension-api` observation, driver, publisher, and harness modules, and `packages/extension-api/test/third-party-agent-fixture.test.mjs`. The fixture is replaced by a third-party session-source fixture.

`e2e/extension-agent-runtime.spec.ts` is rewritten around library fixture drivers.

### D11. Registry migration

`retireWithdrawnBuiltIns` already forgets withdrawn built-in ids. Before retiring them, reconciliation reads the old ids' `enabled` flags and sets the matching harness switch off:

| Old extension id | Harness switch |
|---|---|
| `com.terminay.agent.claude-code` | `claude-code` |
| `com.terminay.agent.codex` | `codex` |
| `com.terminay.agent.grok` | `grok` |
| `com.terminay.agent.omp` | `oh-my-pi` |

This runs once. `com.terminay.agent.opencode` is ignored. A user npm override of an old id is left installed but can no longer activate, because its API range is `^2`, and it shows as incompatible. Old `extensions/data/<old-id>` directories are left in place, following the existing retention rule.

### D12. Superseded open changes

`claude-code-session-follows-cwd`, `omp-breadcrumb-cwd-identity` and `omp-fresh-profile-wait-set` were complete but unarchived. Each changes per-provider requirements that this change removes, and the code each describes lived in the deleted extensions. They are archived with `--skip-specs`, which keeps their history without folding requirements into the main specs that this change then deletes.

## Risks / Trade-offs

- **[Licensing]** `@markwylde/all-your-agents` is AGPL-3.0-or-later and Terminay is MIT. → Same author; relicense the library (MIT or dual) before release. Flagged as an open question and a blocking task.
- **[Behaviour ceiling]** Terminay can only show what the library knows:
  - Codex never reports `waiting`.
  - Grok's same-name tools collapse into one.
  - A new omp session reads `idle` until its first reply without `node:sqlite`. Electron 42 and Node 24 both have it.
  - Mitigation: publish the library matrix in the README, and fix gaps upstream rather than in Terminay.
- **[Machine-wide visibility]** Every project on a server now sees agents started anywhere on that machine under its directories, including other users' agents on a shared Linux server, if their files are readable. → The library reads only the server account's own provider homes (`~/.claude`, and so on), so the visible sessions are that account's. Documented in the README.
- **[Package size]** Koffi adds about 28 MB of prebuilds for 18 platforms to every distribution. → Accepted; inventories must stay byte-identical. Pruning is a future option if inventories become per-architecture.
- **[Native load failure]** Koffi may fail to load in an Electron child: N-API 8 is ABI-stable, but a platform could lack a prebuild. → The library falls back to file-change re-validation. The extension logs one degraded-mode diagnostic. A dead external agent can linger until its next file change; a bound agent is dropped when its PTY exits.
- **[Ancestry on macOS spawns `ps`]** One spawn per hop per new pid (ADR-0021 counts spawns). → Only on a new-session edge, never idle. Rarely more than 3–5 hops to a PTY shell.
- **[Environment]** The library honours `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`, `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `XDG_*`. → Declared in the source's `environmentVariables` so the host passes them into the trimmed child environment.
- **[Breaking SDK]** Third-party agent extensions on API 2.x become incompatible. → Accepted by the user. The Settings card shows the standard incompatibility state.
- **[Open changes made obsolete]** `claude-code-session-follows-cwd`, `omp-breadcrumb-cwd-identity`, and `omp-fresh-profile-wait-set` modify requirements this change removes. → Close them before archiving this change; archive order matters.
- **[Main spec defect]** `openspec/specs/agent-status-and-sidebar/spec.md` contains a stray `>>>>>>> origin/main` merge marker inside "Session identity comes only from provider evidence". That block is replaced wholesale by this change's MODIFIED delta, which removes the marker on archive.

## Migration Plan

1. Land the SDK 3.0 types and the Server Core session-source bridge, project scope, ancestry binding, and MCP router, alongside the new extension, in one change. Built-ins and host move together, so there is no mixed-version state inside one release.
2. On first start of the new release, reconciliation materialises `terminay-builtin-agents`, copies the old disabled flags into harness switches (D11), and retires the five old ids.
3. **Rollback:** reinstalling the previous release restores the five old built-ins from its own bundled artifacts. The harness setting is ignored by the old release. The previous release's registry reconciliation re-materialises its built-ins; disabled choices made only as harness switches are not carried back.

## Open Questions

- **Library licence.** Relicense `@markwylde/all-your-agents` to MIT (or dual-license) before this ships in an MIT product. This blocks release, not implementation.
- **ADRs to revisit.** Records for these are made in this change's ADR step:
  - **ADR-0014:** real-CLI conformance per provider moves to the library.
  - **ADR-0024:** there are no not-bound directory waits.
  - **ADR-0022:** its principles stand and the library complies, but its agent-specific open items are overtaken. No supersession is needed, because its decisions still hold.
  - **ADR-0011:** the installer's native rejection is a policy detail, not an ADR decision. The new ADR records the change without superseding 0011.
