# Shared responsive server UI

## Goal

Replace the separate desktop and terminal-only remote applications with one
complete responsive workspace UI bundled by every server and driven entirely
through `TerminayClient`.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- All existing workspace feature specifications.

## Why this is active

`src/App.tsx` is a large desktop-oriented renderer coupled to
`window.terminay`, while `src/remote/App.tsx` is a second terminal-only UI with
separate state, settings, navigation, and protocol. Continuing both would
duplicate every new feature and produce incompatible behaviour.

## Dependencies

- [Desktop connection host and Local mode](./7-desktop-connection-host-and-local-mode.md)
- [Server terminal service](./8-server-terminal-service.md)
- [Server activity and agent services](./9-server-activity-and-agent-services.md)
- [Server MCP control](./10-server-mcp-control.md)
- [Server files and file viewer](./11-server-files-and-file-viewer.md)
- [Server Git, worktrees, and Quick Push](./12-server-git-worktrees-and-quick-push.md)
- [Server recordings](./13-server-recordings.md)
- [Server settings, secrets, and macros](./14-server-settings-secrets-and-macros.md)
- [Server AI metadata and dictation](./15-server-ai-and-dictation.md)

## Work slices

### Client architecture

- [x] Add a bounded query/command feature facade and migrate the file-diff
  query through a host-local compatibility adapter; keep the broader renderer
  migration and full feature parity work explicit below.
- [ ] Extract connection-independent `TerminayClient` queries, commands,
  subscriptions, caches, conflict handling, and reconnect state from React.
  - [x] Add a transport-neutral `RecordingsClient` facade for canonical list,
    bounded replay, lifecycle commands, list caching, and mutation invalidation.
  - [x] Migrate the Recordings timeline window to `RecordingsClient` through a
    compatibility-only preload adapter; replay, delete, reveal, and list calls
    no longer access `window.terminay` from the shared component.
  - [x] Migrate Performant text metadata and ranged line loading to the bounded
    `FileViewerClient` facade; legacy preload access remains isolated in the
    file-viewer compatibility transport.
  - [x] Migrate the terminal-settings hook's read/change subscription to
    `SettingsClient`; preload settings methods and event payloads remain only
    in its compatibility transport.
  - [x] Migrate FilePanel's ranged text probing, sparse saves, and diff-layout
    setting update through the shared file/settings clients; direct preload
    access is absent from the component.
  - [x] Static boundary coverage verifies these migrated components keep
    preload/host transport calls inside compatibility adapters.
- [x] Add the transport-neutral `TerminayTerminalPanelClient` stream boundary;
  raw output remains bytes and panel commands remain attachment-scoped.
- [ ] Replace direct `window.terminay` and remote socket calls with that client.
  - [x] Add a compatibility-only `DesktopTerminalAuthorityAdapter` for
    non-panel terminal input/resize/kill calls; it requires immutable terminal
    identity and rejects renderer/window ownership fields. Direct `App.tsx`
    call-site migration remains open.
- [ ] Split `src/App.tsx` into feature-owned components/stores without
  recreating separate desktop/mobile application trees.
- [ ] Delete the duplicate remote terminal workspace once parity is proven.

### Responsive workspace

- [ ] Render projects, logical workspace views, Dockview panels, sidebars,
  terminal/file/folder tabs, agents, Git, settings, recordings, macros, and
  command surfaces from one server model.
- [x] Define wide, medium, and narrow layouts using container/media queries and
  host capability inputs.
- [x] Replace native-window-only actions with logical view navigation on web.
- [ ] Add touch terminal accessory, virtual keyboard/viewport, accessible
  drawers/selectors, and large touch targets without reducing desktop keyboard
  functionality.
- [ ] Preserve focus, reduced motion, screen reader, theme, and terminal safety.

### Shared routes and host capabilities

- [ ] Turn settings, macros, recordings, and edit surfaces into shared
  route/component entries.
  - [x] Define the host-neutral route registry and in-page/native-auxiliary
    presentation policy.
  - [ ] Render the complete shared route components.
- [ ] Let Desktop present eligible routes in native auxiliary windows while web
  presents them in-page.
- [ ] Capability-gate OS reveal, native dialogs, updater, and window actions
  with clear alternatives.
- [ ] Keep server workspace behaviour independent of whether a capability is
  present.

### Server bundle

- [ ] Produce one content-hashed manifest containing the complete UI, assets,
  CSP requirements, server/protocol compatibility, and entry point.
- [ ] Load it from Local and through verified remote asset installation.
- [ ] Support direct standalone session-origin launch and host-shell embedded
  mode.
- [ ] Ensure old bundle caches are pruned only after successful replacement.

### Parity and visual tests

- [ ] Build a feature parity matrix from every canonical feature specification.
- [ ] Add shared component tests and Desktop-wide/mobile-browser visual/E2E
  coverage.
- [ ] Verify terminal, file, Git, agent, macro, recording, settings, and
  connection error states at narrow and wide widths.
- [ ] Ensure one feature fix changes one shared implementation.

## Acceptance checks

- There is one production workspace UI implementation and one client state
  library.
- The server bundle provides current desktop feature parity in a wide browser.
- A narrow mobile browser can navigate projects/views/panels and safely operate
  terminals without horizontal page overflow.
- Desktop native routes use the same components as web routes.
- No shared UI package imports Electron, Node, WebRTC, or a concrete local
  transport.

## Definition of done

Desktop and browser are hosts for the same complete responsive server-bundled
workspace, and the old terminal-only remote UI is removed after verified parity.
