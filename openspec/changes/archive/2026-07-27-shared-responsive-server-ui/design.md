# Design

## Context

See `proposal.md` for the motivation. This change depended on the server-side services
landing first: the Desktop connection host and Local mode, the server terminal service,
activity and agent services, MCP control, files and file viewer, Git, worktrees and
Quick Push, recordings, settings, secrets and macros, and AI metadata and dictation.
Only once those existed could a renderer be written that owned no privileged state.

The change was scoped alongside three sibling changes that owned the stable bundle and
host contracts, the adoption of the verified server bundle by normal Desktop and web
startup, host-state reduction, cross-version evidence, and deletion of the legacy
Electron bootstrap. This change owned the one shared responsive component tree and the
visual and feature parity gates, and its completion evidence had to exercise that tree
through the production server-bundle launch paths rather than a fixture or a
compatibility renderer.

## Goals / Non-Goals

Goals:

- One production workspace UI implementation and one client state library.
- The server bundle provides current desktop feature parity in a wide browser.
- A narrow mobile browser can navigate projects, views, and panels and safely operate
  terminals without horizontal page overflow.
- Desktop native routes use the same components as web routes.
- One feature fix changes one shared implementation.

Non-Goals:

- No shared UI package imports Electron, Node, WebRTC, or a concrete local transport.
- No second workspace model for narrow hosts.
- No third responsive panel density: medium reuses the canonical wide panel contracts
  inside a compact route shell.

## Decisions

**Migrate behind bounded facades rather than rewriting in one step.** Each feature area
moved to a transport-neutral client (`RecordingsClient`, `TerminayAiClient`,
`FileViewerClient`, `SettingsClient`, `MacroClient`, `TerminayGitClient`,
`AgentStatusClient`, `TerminayTerminalClient`, `TerminayTerminalPanelClient`,
`WorkspaceClient`) with the legacy preload translation isolated in a named
compatibility adapter. Static boundary coverage then enforced that migrated components
kept preload and host transport calls inside those adapters, and finally that production
feature modules contain no broad `window.terminay` calls, that `TerminalPanel` writes
and resizes only through its exact shared-client attachment, and that the legacy remote
renderer contains neither raw socket sends nor `WebSocket` construction.

**Native operations became narrow, versioned, validated host capabilities, not a broad
preload surface.** Remote-access status and lifecycle, edit-window launch, path-based
Git status and worktree presentation, directory watch, folder size and dropped paths,
file search, microphone and keystore dictation, and macro secret lookup each moved
behind one capability. The `DesktopTerminalAuthorityAdapter` was a deliberate temporary
step: it required immutable terminal identity and rejected renderer or window ownership
fields, and it was deleted once all production call sites entered the exact panel
attachment queue.

**Renderer-neutral models first, React surfaces second.** Every panel and route contract
was defined as a deeply frozen, data-only model in `packages/shared-ui` and
`packages/responsive-ui` with its own direct component tests, then rendered through
host-neutral React surfaces (`SharedWorkspaceRouteSurface`, `SharedPanelContractSurface`,
`SharedRouteEditorSurface`). The React boundary rejects mutable or accessor-backed
models before any panel renders, so a host cannot substitute a model between
composition and render. Ready routes fail closed when their canonical panel set is
incomplete rather than silently rendering a partial host-specific surface.

**Layout: one split boundary, not overlapping resizers.** The sidebar separator became a
single overlaid hit target rather than a grid gutter, with pointer dragging that clamps
and commits the controlled width. Chromium geometry coverage asserts the content left
edge equals the navigation right edge at 280px, 352px, and 640px, with a 6px hit target
overlaying the boundary — removing the ghost gap, double gutter, and terminal overlap
seen in the live screenshots.

**A fail-fast browser stability budget gates live acceptance runs.** Before any further
live run, the parity scenario was raced against a budget for console errors, page and
resource failures, protocol request count, pending protocol requests, and long tasks;
a breach aborts immediately and retains `web-runtime-diagnostics.json`. This was added
after render and effect feedback loops in the Explorer and sidebar produced hundreds of
pending protocol requests and exhausted Chrome.

**Idle connected workspaces subscribe rather than poll.** The Explorer registers server
watches and reacts to watch events only; it no longer runs a browser-side reconciliation
loop over expanded folders, and a failed watch registration performs one bounded folder
refresh instead of surfacing a global terminal error. Git and worktree projections
preserve the last good state through transient refresh failures, skip repaint on
identical projections, and clear only on a real project or root switch. A live
Playwright run against web `8081` and server `4319` observed the Explorer and Git
sidebar for 30 seconds with zero DOM, class, text, or colour changes, zero console
errors, and zero protocol requests during the idle window.

**Command-surface responsiveness came from removing animation, not from throttling.**
The Cmd+L menu uses a single bounded list `scrollTop` adjustment instead of smooth
animated `scrollIntoView`, and the command surface dropped its backdrop blur.

**The bundle is content-addressed and verified at every launch path.** The production
`build:app` pipeline runs `scripts/build-ui-bundle-manifest.mjs` after Vite, inventories
every emitted application file with its SHA-256 hash, path, size, and content type,
derives the bundle id from the complete canonical inventory, and records the entry, CSP,
server version, and protocol version. Executable and stylesheet references from the
declared HTML entry must resolve only to assets in the same manifest; external, empty,
and undeclared references fail closed. Root-relative Vite assets resolve into the active
verified content-addressed namespace for both unpacked Local bundles and remotely
installed commits, undeclared root-relative requests stay 404, and `UiBundleStore`
removes superseded bundle directories only after atomically replacing `current.json`.

**Electron E2E launches from a per-run immutable copy of the generated renderer bundle**
rather than the shared `dist` directory, verifying every declared hash, size, path, and
the complete inventory before launch, making staged assets read-only, and rechecking the
fingerprint after shutdown, so a parallel rebuild cannot create a mixed dynamic-import
graph.

## Risks / Trade-offs

- **Long-lived compatibility adapters.** Each migrated area kept a named legacy adapter
  during the transition. The mitigation was mechanical: static boundary tests fail if a
  feature component reaches past its adapter, and adapters were deleted as call sites
  moved.
- **Parity claims outrunning reality.** Several slices explicitly recorded that they
  were an extraction seam or an initial shared surface and not a claim of full Dockview
  or route parity, so the parity gate stayed honest. The feature parity matrix maps all
  17 canonical feature specifications to shared UI surfaces, and its test fails if a
  feature spec is missing from the matrix.
- **Live browser regressions were expensive to find.** Typing into the connected browser
  terminal, folder double-click, project and terminal creation, project close, and
  reconnect after a container restart each needed a real production-browser run to
  expose. The Compose smoke was extended to cover connect, refresh, Explorer toggle,
  resize and expansion, file open, Git ready state, terminal command and output, server
  restart, automatic reconnect, and a second refresh, with bounded request counts and no
  console, resource, or CSP errors.
- **Container environment mismatches.** The local Compose path had to mount the intended
  project workspace, seed `TERMINAY_PROJECT_ROOT`, preserve the linked-worktree host
  path, admit exactly that Git safe directory, and include the Git runtime — otherwise
  the browser project root was an inaccessible host path. The non-root, read-only,
  capability-free container was verified against live `workspace.snapshot`, `files.list`,
  and `git.status` queries.

## Migration Plan

1. Land the bounded client facades and native host capabilities behind compatibility
   adapters while both renderers still run.
2. Make the production Electron and web hosts enter the same
   `ConnectedRendererWorkspace -> App` tree from the selected server's verified bundle;
   delete the route-marker and `legacyFallback` wrapper and the retired
   `ServerWorkspaceSurface` path.
3. Split `src/App.tsx` into feature-owned modules with ownership assertions.
4. Prove parity through the production browser regression and the Desktop and web route
   parity gate.
5. Delete the duplicate remote terminal workspace and the obsolete terminal IPC surface.
