## Why

A user with a laptop, a build box, and a VPS wants one window with a project
tab for each. Today a window is bound to exactly one Terminay Server, so that
user gets three windows, three tab strips, and three copies of the workspace
UI, one downloaded from each server. Once every remote is a Terminay Server
(phase 1), this is the only thing standing between the product and the
"project tabs from different hosts" it was always meant to have.

The reason a window is single-server is a compatibility rule: a window runs the
exact bundle its server ships, so it never has to speak to a server of another
version. That rule was cheap while the protocol was a single integer and the
capability list was five coarse words. It is the wrong tool for many servers.
The right tool is the one the protocol already has a slot for: a real
application-protocol version range and per-feature capability strings,
negotiated in the hello, with an honest "this server needs upgrading" state
when they do not match.

## What Changes

- **BREAKING** A window runs one workspace UI bundle and opens many server
  connections. Desktop runs the bundle packaged with it for every connection.
  A browser session runs the bundle of the server it opened. A connection's
  server no longer supplies the UI that talks to it.
- A window has one **primary connection**, whose bundle it runs, and zero or
  more **attached connections**. On Desktop the primary is always **Local**.
- The tab strip shows every project of every attached server. Its order, and
  the set of attached servers, are client-owned presentation state, persisted
  by the host like window geometry. Everything inside a tab stays owned by
  that tab's server: projects, panels, layout, terminals, settings, macros,
  recordings, agents, MCP.
- Creating a project chooses which attached server owns it, then a root on
  that server. Moving panels between servers is not offered.
- The application protocol version and capability set become the
  compatibility contract. The bundle's client declares the protocol range and
  the capabilities it requires; a server that cannot satisfy them is shown
  attached and **incompatible**, its tabs greyed with which side to upgrade,
  and receives no operations.
- Hosts stay protocol-blind. The host owns every credential and every
  transport, and hands the bundle one opaque byte endpoint per connection
  through a versioned host capability. The bundle never holds a device key.
- Desktop stops downloading remote server bundles and drops the per-server
  verified bundle cache. The browser manager keeps framing the primary
  server's session origin and installing that one bundle.
- Header server control becomes a connections control: attached servers with
  status, attach, detach, and per-server exposure.
- Settings, Macros, Recordings, Shell profiles, and Extensions surfaces gain a
  server selector that defaults to the active tab's server. The Home
  dashboard, activity badges, and the agent sidebar aggregate across attached
  servers client-side and keep every row keyed by server and project.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: connection vocabulary, one renderer per
  selected server, Desktop launches the selected server's bundle, native window
  server binding, bundle manifest compatibility, verified bundle cache,
  renderer context contents, header server control, connection menu contents,
  Desktop connection persistence, and Desktop persistence allowlist are
  restated for one bundle and many connections.
- `server-runtime-and-protocol`: versioned application protocol gains a real
  range and feature capabilities; bundle manifest declarations, bundle
  acquisition per connection kind, host transport and presentation bridge, and
  the Desktop byte endpoint are restated; contract failure reporting names the
  side to upgrade.
- `server-owned-workspace-state`: client-owned device-local state includes the
  attached-connection set and tab order; canonical model ownership is per
  server; identity-based authority names the connection.
- `workspace-and-project-tabs`: project composition, tab management, new
  project placement, project split button, root selection, workspace views as
  native windows, and one workspace view per window are restated for tabs from
  several servers.
- `remote-access`: server-bundled workspace delivery is for the primary
  connection only; Desktop remote-code containment is restated; consistent
  workspace across clients is per server.
- `agent-status-and-sidebar`, `workspace-dashboard`,
  `settings-shortcuts-and-desktop-integration`, `macros`, `recording`,
  `shell-profiles-and-terminal-launch`, `mcp-server`, `dictation`: each
  aggregates or selects across attached servers, keyed by server identity.

## Impact

- `packages/protocol`: protocol version range and feature capability
  constants become real; `client_hello` and `server_hello` carry them; the
  incompatible outcome is typed for the UI.
- `packages/ui-bundle` and `packages/protocol/src/host.ts`: the manifest
  gains a server-compatibility declaration; the per-window bundle identity
  check against a server is removed.
- `packages/client-core`: a connection registry replaces the single
  `currentId` profile selection; `TerminayClient` is already per-instance.
- `src/`: `sessionTransportHost` singleton becomes keyed by connection;
  `agentStatusStore` and `WorkspaceSnapshotStore` become per connection; the
  workspace tree gains a connection context; `ProjectTab` carries a server
  id; `App.tsx`'s single `currentServerId` becomes per tab.
- `electron/`: `serverUiHost` binds a window to a primary profile and a set of
  attached profiles; remote bundle download and cache are deleted; the host
  bridge gains a `connections` capability.
- `apps/terminay-web`: the manager opens attached connections for the framed
  primary and hands over byte endpoints; secondary bundle install is deleted.
- Deleted: Desktop remote bundle acquisition, `browserBundleHost` secondary
  install paths, the bundle-to-server identity binding, and the one-window-one-
  server binding checks.

## Sequencing

Phase 2 of four. Depends on `remove-project-environments`. Desktop
multi-connection can ship before browser attached connections; the tasks are
grouped so that the browser transport work is last.
