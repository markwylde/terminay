## Why

Terminay has two ways to reach another machine, and they contradict each
other. A client can connect to a remote Terminay Server, or a Terminay Server
can reach outward into a "project environment" over SSH or a Puzed VM. Every
feature has to know which one it is standing in: terminals, files, Git, shell
discovery, agent observation, macros, dictation, MCP, diagnostics, and the
sidebar all carry an environment id, a revision, a capability subset, and a
"limited on this environment" branch. The user sees this as a project that
sometimes has Git and sometimes does not, a file browser that sometimes cannot
watch, and an Agents pane that sometimes cannot see the process.

The server-side split is also what makes language intelligence impossible to do
well: a language server has to run where the project's files, `tsconfig`, and
`node_modules` live, and a project environment is by definition not where the
Terminay Server runs.

There is one remote model that the product already has and that already works
across Desktop and browser: a Terminay Server. This change makes it the only
one. Every project executes on the server that owns it. Reaching another
machine means running a Terminay Server on it and connecting to it.

## What Changes

- **BREAKING** The project environment concept is removed. A project has a root
  on its server's filesystem and nothing else decides where it executes. There
  is no environment id, environment revision, environment registry, environment
  status, environment chooser, or environment management window.
- **BREAKING** The SSH and Puzed extensions, their specs, their catalogue and
  built-in entries, managed SSH key bindings, dependency operations between
  providers, and the Puzed VM lifecycle surface are deleted.
- **BREAKING** The extension platform no longer has a project-environment
  provider contribution kind or an environment capability model. Agent
  providers remain and keep the observation broker they use today; every
  observation capability is always present because the server always executes
  its own projects.
- The server no longer routes operations through an environment router. File,
  Git, terminal, shell-discovery, observation, and MCP operations execute
  directly against the server host, so an unmapped operation can no longer fall
  through to the wrong machine.
- Persisted workspace state drops the environment fields from projects and
  terminal sessions. The state format version is bumped and older state is not
  read.
- Every spec that says "This server" or "the project's environment" now says
  "the server". Every "limited on a remote environment" branch is removed.
- The product overview, ADR-0009's decision, and the extension platform's
  purpose statement are restated around one server type.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-environments`: every requirement removed; the capability is deleted.
- `ssh-project-environments`: every requirement removed; the capability is
  deleted.
- `puzed-project-environments`: every requirement removed; the capability is
  deleted.
- `extension-platform`: the provider contribution kind, environment capability
  model, dependency operations, environment routing, and environment-specific
  status and form contributions are removed; the purpose statement, bounded API
  scope, and host-owned surfaces are restated for agent providers only.
- `built-in-extensions`: SSH and Puzed leave the official package set,
  release inventory, and packaging contracts; agent extension composition with
  environments is replaced by composition with the server host.
- `connections-and-client-hosts`: "server connections are distinct from project
  environments" and every environment mention in menus, routes, and
  non-goals are removed.
- `server-runtime-and-protocol`: environment routing authority and
  environment protocol operations are removed; extension hosting is restated.
- `server-owned-workspace-state`: canonical objects, the persisted inventory,
  path resolution, provider capability honesty, remote project restoration, and
  identity-based authority no longer carry environment identity or revision.
- `workspace-and-project-tabs`: environment chooser, immutable environment
  display, environment boundaries on moves, and mixed environments in one view
  are removed; project creation chooses a root on the server.
- `shell-profiles-and-terminal-launch`: environment-scoped catalogues and
  environment-routed discovery become server-scoped; "This server" targets and
  platform policy become the server's.
- `terminal-workspace`: sessions are created by the server's native PTY only.
- `agent-status-and-sidebar`: composition with environments, capability-missing
  outcomes, and environment identity in terminal identity are removed.
- `terminal-activity-signals`: PTY-byte signals and native signals apply to
  every session because every session is native.
- `macros`, `dictation`, `ai-tab-metadata`, `mcp-server`,
  `git-worktrees-and-quick-push`, `file-explorer-and-folder-tabs`,
  `project-sidebar-layout`, `local-desktop-diagnostics`,
  `settings-shortcuts-and-desktop-integration`, `remote-access`: each loses its
  "remote environment" branch or its Project Environments management entry.

## Impact

- Deleted: `packages/server-core/src/projectEnvironment/`,
  `packages/server-core/src/extensions/projectEnvironmentRuntime.ts`,
  `packages/server-core/src/extensions/remoteFileProtocol.ts`,
  `packages/server-core/src/activity/extensionAgentObservationRouter.ts`,
  `packages/client-core/src/projectEnvironments.ts`,
  `src/projectEnvironments/`, `electron/projectEnvironmentPersistence.ts`,
  `extensions/ssh/`, `extensions/puzed/`, and their tests. Roughly ten
  thousand lines and three specs.
- Simplified: `packages/server-core/src/composition.ts` (router injection at
  eight sites), `dispatcher.ts` (two environment error classes),
  `workspace.ts` and `workspaceStartup.ts` (environment fields and validation),
  `terminalService/launchResolver.ts` (remote launch fork),
  `packages/extension-api` (types, validation, testing fixtures),
  `src/workspace/*` and `src/shared/featureQueryAuthority.ts` (environment
  revision keys), `App.tsx` and `ProjectTabList.tsx` (environment chooser).
- Agent extensions (`extensions/agent-*`) are unchanged in source; their
  observation broker keeps its interface with every capability present.
- `extensions/builtins.json`, the extension catalogue, `turbo.json`,
  `Dockerfile.e2e`, root scripts, and packaging tests drop SSH and Puzed.
- `docs/product-overview.md` core model and pillars are rewritten around one
  server type. ADR-0009 is superseded by a new ADR.
- No hosted-service change. No pairing or transport change.
- Out of scope, and required before a Mac can be a remote target: a macOS
  standalone server artifact and an easier headless install. Also out of scope:
  a future "install a Terminay Server over SSH" bootstrap and a Puzed VM image
  that ships a Terminay Server. Both are natural follow-ups once every remote
  is a server.

## Sequencing

This is phase 1 of four changes planned together:

1. `remove-project-environments` (this change)
2. `multi-server-workspace`
3. `drop-in-browser-language-services`
4. `language-server-extensions`

Phase 2 depends on this change's spec deltas. Phases 3 and 4 are independent
of phase 2 and of each other, though phase 4 assumes phase 3 has landed.
