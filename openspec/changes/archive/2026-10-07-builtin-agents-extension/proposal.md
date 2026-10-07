## Why

The Agents sidebar gets agent status wrong often enough that users cannot trust it. Sessions show as working after they finish, never bind, or bind to the wrong conversation. It also misses agents the user started outside a Terminay terminal in the same project. The cause is structural. Five separate built-in extensions (Claude Code, Codex, Grok, omp, OpenCode) each carry their own journal parser and process-binding rules. A large host-side observation runtime sits beneath them: foreground matching, `ps`/`lsof` evidence, discovery watches, a ramp schedule, and a JSONL follow driver. Every fix has had to be made in both layers.

`@markwylde/all-your-agents` is a separately maintained, well-tested library. It watches every coding-agent session on a machine without polling and reports status, title, model, activity, and subagents for Claude Code, Codex, Grok, and oh-my-pi. Terminay should delegate detection to it entirely and keep only what is Terminay's: project scoping, terminal binding, acknowledgement, and presentation.

The **Install Terminay MCP** dialog writes configuration files that belong to the same agent CLIs. Its per-CLI writers live in Terminay core. They belong beside the agent integration, in the same extension.

## What Changes

- **BREAKING** Replace the five built-in agent extensions with one built-in extension, `terminay-builtin-agents` (`com.terminay.builtin-agents`). It observes sessions exclusively through `@markwylde/all-your-agents`.
- **BREAKING** Extension API 3.0 removes these, with no deprecation window:
  - the terminal-scoped agent provider contract: `agentProviders`, process matchers, `observe`, `jsonlSession`, `notBound`, the mapping/driver toolkit, the lifecycle publisher, `bindSession`, and the observation broker
  - the `agent-observation` permission semantics tied to them
- Add an `agentSessionSources` contribution. An extension registers a source and pushes machine-wide live session snapshots (and removals). Server Core maps them to canonical agent entries.
- Add an `mcpInstallTargets` contribution. An extension owns detection, installation, and removal of the Terminay MCP registration for its clients. The host keeps the **Install Terminay MCP** surface and routes it to the contributing extension, with the host-supplied MCP server command.
- The Agents pane shows every live session on the server's machine whose working directory is inside the project root, recursively, or inside any Git worktree of the project's repository. This includes sessions started outside Terminay.
- Sessions whose process runs inside a Terminay terminal bind to that terminal: tab status, click-to-focus, and acknowledgement on interaction. Other sessions appear marked **External** and are not activatable.
- Add a per-harness on/off switch within the built-in agents extension (Claude Code, Codex, Grok, oh-my-pi).
- **BREAKING** OpenCode agent status is dropped until the library supports OpenCode. OpenCode remains an MCP install target.
- Extensions may ship native `.node` dependencies, including optional dependencies. Install lifecycle scripts stay disabled.
- Remove the host-side agent observation runtime:
  - local process and open-file observation
  - foreground matching and admission
  - discovery watches and ramp schedule
  - the JSONL session driver
  - binding validation
  - the real-CLI conformance harness and its CI workflow
- Remove the MCP configuration writers from `electron/mcpInstall/` in favour of the extension.

## Capabilities

### New Capabilities

- `builtin-agents-extension`: the single built-in agents extension. Covers delegating detection to `@markwylde/all-your-agents`, the supported harnesses, the per-harness switches, how library session state maps to snapshots, and ownership of the MCP install targets.

### Modified Capabilities

- `agent-status-and-sidebar`: sessions come from machine-wide session sources rather than terminal-scoped observation. The Agents pane is scoped by project directory and repository worktrees. Terminal binding is by process ancestry. External sessions are shown but not activatable. All per-provider journal mapping requirements are removed.
- `agent-provider-conformance`: the real-CLI conformance matrix and harness are removed. Conformance is the library's, and Terminay proves the Agents pane end to end with library fixtures.
- `built-in-extensions`: one agents package replaces five. Built-ins may carry native dependencies. Per-extension agent disablement becomes per-harness.
- `extension-platform`: Extension API 3.0 contribution set (`agentSessionSources`, `mcpInstallTargets`, `languageServers`). The terminal-observation broker, provider runtime, and driver toolkit are removed. Native dependencies are accepted.
- `mcp-server`: the registration management surface is served by an extension-contributed install target. The independence statements are restated against session sources.

## Impact

- **Extensions**:
  - delete `extensions/agent-{claude-code,codex,grok,omp,opencode}`
  - add `extensions/builtin-agents`
  - update `extensions/builtins.json`
- **SDK**: `packages/extension-api` goes to major version 3.0. It gains the session-source and MCP-target types and loses the observation, driver, and publisher surfaces.
- **Server Core**:
  - delete `extensions/localAgentObservation.ts`, `activity/extensionAgentRuntime.ts`, the ramp schedule, the `child.ts` JSONL driver, and binding validation in `agentService.ts`
  - add a session-source bridge, project/worktree scoping, pid→terminal binding, and MCP target routing
  - installer validation stops rejecting native trees
  - the catalogue lists one agents package
- **Desktop**:
  - `electron/mcpInstall/` provider writers move to the extension
  - `electron/main.ts` / `serverTerminalAuthority.ts` pass the MCP server command to the extension host and route `mcp-install.*`
- **Renderer**:
  - `AgentsSidebar`, `agentPresentation`, `App.tsx` project filtering, an External row treatment, per-harness switches in `ExtensionManager`, and the MCP modal's disabled-extension state
- **Build and CI**:
  - `scripts/stage-built-in-extensions.mjs` expected ids and optional-dependency staging
  - `turbo.json` and root `package.json` scripts
  - delete `.gitea/workflows/agent-conformance.yml` and `tests/agent-conformance/`
  - packaged built-in tests
  - e2e specs for the Agents pane and settings
- **Dependencies**: adds `@markwylde/all-your-agents` (AGPL-3.0-or-later) with optional `koffi` (native).
- **Open changes**: `claude-code-session-follows-cwd`, `omp-breadcrumb-cwd-identity`, and `omp-fresh-profile-wait-set` modify requirements this change removes. They become obsolete.
