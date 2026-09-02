## Why

Terminay carried two workspace applications: a large desktop-oriented renderer in
`src/App.tsx` coupled to `window.terminay`, and a second terminal-only remote UI in
`src/remote/App.tsx` with its own state, settings, navigation, and protocol. Every new
feature had to be built twice and the two behaved differently.

## What Changes

- **BREAKING** Delete the terminal-only remote workspace. There is one production
  workspace UI implementation and one client state library.
- Every server bundles the complete responsive workspace UI; Desktop and browser hosts
  launch the selected server's exact verified bundle instead of an independently
  packaged renderer.
- Extract all connection-independent queries, commands, subscriptions, caches, conflict
  handling, and reconnect state into `TerminayClient` facades. Canonical renderer
  feature code contains no raw `TerminayClient.query`/`command`/`subscribe` calls and no
  broad `window.terminay` calls; remaining native operations go through narrow,
  versioned, validated host capabilities.
- Split `src/App.tsx` into feature-owned components and stores without recreating
  separate desktop and mobile application trees.
- Add renderer-neutral shared UI panel and route contracts (workspace, connections,
  settings, macros, recordings, file, folder, Git, agents, terminal, activity, AI
  metadata, dictation, MCP, command surface) with wide, medium, and narrow layouts,
  44px touch targets, and accessible loading/empty/unavailable/forbidden/failed states.
- Add responsive behaviour for touch hosts: terminal accessory, visual-viewport keyboard
  geometry, drawers and selectors, reduced motion, forced colours, screen-reader
  semantics, and a keyboard skip link — without reducing desktop keyboard function.
- Make the connected browser workspace server-owned end to end: project and terminal
  creation, cascading project and panel close, project-root updates from the active
  terminal working directory, Explorer expansion and watch-driven refresh, Git and
  worktree projection stability, and terminal input, resize, and output.
- Make browser reconnect persistent and truthful: bounded backoff on transport loss,
  no retry storms after permanent authorization failures, deduplicated loopback
  profiles, and mutually exclusive connection status messages.
- Produce a content-hashed UI bundle manifest and serve the same verified bundle
  through Local, embedded, and remotely installed launch paths, pruning superseded
  bundles only after a successful atomic replacement.
- Capability-gate OS reveal, native dialogs, updater, and native-window actions, with a
  clear in-page alternative when a capability is absent.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: one server-bundled responsive workspace UI shared by
  Desktop and browser hosts, its route registry, responsive and accessibility
  contracts, renderer-neutral package boundary, bundle manifest, and browser reconnect
  behaviour.
- `server-owned-workspace-state`: one project and panel model rendered responsively,
  server-owned project, panel, and terminal lifecycle from the browser, and bounded
  snapshot, delta, and file-watch refresh.

## Impact

- Renderer: `src/App.tsx` and its feature-owned `src/workspace/*` controllers,
  `src/shared/*` route and surface components, `src/web/main.tsx`,
  `src/rendererRuntime.tsx`; `src/remote/App.tsx` removed.
- Packages: `packages/client-core` (health, query/command, workspace, terminal,
  file-viewer, recordings, settings, macros, Git, agent clients),
  `packages/shared-ui`, `packages/responsive-ui`, `packages/server-core`
  (workspace protocol, UI bundle, UI bundle store).
- Server: `apps/terminay-server` CLI options, local UI server, committed bundle UI,
  standalone HTTP transport, process CWD observation.
- Desktop: `electron/preload.ts`, `electron/main.ts`, `apps/terminay-desktop` host
  bridge and presentation.
- Build and verification: `scripts/build-ui-bundle-manifest.mjs`, the Docker Compose
  web-server smoke, and the Playwright E2E suites for shared routes and surfaces.
