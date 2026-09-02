## 1. Client architecture

- [x] 1.1 Add a bounded query/command feature facade and migrate the file-diff query through a host-local compatibility adapter, verified by `packages/client-core/test/query-command.test.mjs`
- [x] 1.2 Extract connection-independent `TerminayClient` queries, commands, subscriptions, caches, conflict handling, and reconnect state from React, verified by canonical renderer feature code containing zero raw `TerminayClient.query`/`command`/`subscribe` calls and by `packages/client-core/test/health.test.mjs`
- [x] 1.3 Migrate recordings, AI tab metadata, settings, file viewer, folder, Git, dictation, and macro-secret paths onto their transport-neutral clients, verified by the focused client-path tests for each area
- [x] 1.4 Move remote-access status, edit-window launch, directory watch, file explorer, Git worktree presentation, and dictation native calls behind narrow validated host capabilities, verified by the per-capability host-bridge tests
- [x] 1.5 Add static boundary coverage that migrated components keep preload and host transport calls inside compatibility adapters, verified by `scripts/terminal-authority-boundary.test.mjs`
- [x] 1.6 Add the transport-neutral `TerminayTerminalPanelClient` stream boundary with byte-preserving output and attachment-scoped panel commands, verified by `packages/client-core/test/terminal-client.test.mjs`
- [x] 1.7 Replace direct `window.terminay` and remote socket calls with that client and delete the obsolete `DesktopTerminalAuthorityAdapter` and terminal IPC surface, verified by `scripts/remote-terminal-client.test.mjs` and `scripts/terminal-authority-boundary.test.mjs`
- [x] 1.8 Make the production Electron and web hosts render the same extracted workspace component tree from the selected server's verified bundle, verified by `scripts/web-shared-workspace.test.mjs` and `scripts/task16-production-ui-parity-gate.test.mjs`
- [x] 1.9 Split `src/App.tsx` into feature-owned components and stores without recreating separate desktop and mobile trees, verified by 33 ownership and behaviour assertions in `scripts/task16-app-feature-ownership.test.mjs`
- [x] 1.10 Delete the duplicate remote terminal workspace once parity is proven, verified by the parity gate and the absence of the legacy renderer

## 2. Responsive workspace

- [x] 2.1 Hydrate the shared project collection, including each project root, from the authenticated workspace snapshot and create projects through `WorkspaceClient`, verified by `scripts/workspace-project-collection-authority.test.mjs`
- [x] 2.2 Prove the browser Explorer lists the project root, opens and edits a file through `FileViewerClient`, and renders Git and worktree state through `TerminayGitClient`, verified by `scripts/connected-browser-explorer-file-git.test.mjs`
- [x] 2.3 Make browser restart recovery persistent and truthful with bounded backoff, verified by `scripts/web-reconnect-attempt-lifecycle.test.mjs` and the final `npm run smoke:docker-compose-web-server` run
- [x] 2.4 Stop the Explorer and sidebar `activity.snapshot` render and effect feedback loop, verified by `scripts/sidebar-activity-snapshot-loop.test.mjs`, `scripts/production-browser-stability-budget.test.mjs`, and a 30-second live sidebar stability run
- [x] 2.5 Restore Cmd+L command-menu scrolling and Cmd+R set-root-to-working-directory in connected browser mode, verified by `scripts/web-shared-workspace.test.mjs` and `scripts/standalone-project-root-git-binding.test.mjs`
- [x] 2.6 Stabilise Explorer expansion, Git status projection, and idle refresh on `workspace.changed` subscription rather than polling, verified by `scripts/connected-browser-explorer-expansion.test.mjs`, `scripts/file-explorer-git-status-stability.test.mjs`, and `scripts/workspace-change-subscription.test.mjs`
- [x] 2.7 Rebuild the sidebar resize boundary as one overlaid separator with clamped, persisted width and no ghost gutter, verified by `scripts/workspace-split-layout-computed.test.mjs` in Chromium at 280px, 352px, 400px, and 640px
- [x] 2.8 Add a fail-fast browser stability budget for console errors, page and resource failures, protocol request count, pending requests, and long tasks, verified by `scripts/production-browser-stability-budget.test.mjs` and retained `web-runtime-diagnostics.json` on breach
- [x] 2.9 Make saved reconnect credentials survive a server-container restart, make connection status atomic and mutually exclusive, and stop retry and reload storms after permanent authorization failures, verified by `scripts/task16-web-auth-retry-suppression.test.mjs` and the Compose smoke
- [x] 2.10 Accept both `localhost` and `127.0.0.1` loopback origins on one bounded protocol authorization path and deduplicate loopback profiles and credentials, verified by `apps/terminay-server/test/cli-options.test.mjs` and `apps/terminay-server/test/local-ui-server.test.mjs`
- [x] 2.11 Advertise and handle every `files.*` operation the shared Explorer starts, verified by `scripts/task16-file-explorer-bounded-load.test.mjs` and `apps/terminay-server/test/standalone-http-transport.test.mjs`
- [x] 2.12 Restore connected browser terminal typing, output, and identity-checked stream delivery, verified by `packages/client-core/test/terminal-client.test.mjs`, `scripts/terminal-panel-input-queue.test.mjs`, and typing before and after server restart in `scripts/docker-compose-web-server-smoke.mjs`
- [x] 2.13 Make project creation, project close, and panel close server-owned and cascading, verified by `packages/server-core/test/workspace.test.mjs`, `packages/server-core/test/server-composition.test.mjs`, and `scripts/connected-browser-create-lifecycle.test.mjs`
- [x] 2.14 Mount the intended project workspace into the local Compose container with the Git runtime and canonical project root, verified by `scripts/docker-compose-web-server-smoke.test.mjs` and the recorded smoke evidence
- [x] 2.15 Add a production-browser regression covering connect, refresh, Explorer interaction, file open, Git ready state, terminal command and output, server restart, reconnect, and a second refresh, verified by the final `npm run smoke:docker-compose-web-server`
- [x] 2.16 Define renderer-neutral navigator, tab strip, workspace state, folder browser, and command-surface panels, verified by their direct component tests in `packages/shared-ui`
- [x] 2.17 Define wide, medium, and narrow layouts from container and media queries and host capability inputs, verified by `packages/responsive-ui/test/ui.test.mjs`
- [x] 2.18 Add the touch terminal accessory, visual-viewport keyboard geometry, ARIA drawer and selector contracts, and 44px touch targets without reducing desktop keyboard function, verified by `packages/responsive-ui/test/ui.test.mjs`
- [x] 2.19 Resolve reduced-motion, colour-scheme, forced-colours, and screen-reader hints into one immutable policy with focus restoration and `aria-live="off"` terminal output, verified by `packages/responsive-ui/test/ui.test.mjs`

## 3. Shared routes and host capabilities

- [x] 3.1 Define renderer-neutral macro editor, connection form, connection switcher, edit-tab, and recording-detail route contracts, verified by their direct component tests
- [x] 3.2 Define the host-neutral route registry and in-page versus native-auxiliary presentation policy and activate it at the production renderer entry, verified by `scripts/shared-responsive-entry.test.mjs`
- [x] 3.3 Extract the Settings, Macros, Recordings, and Edit route bodies into host-neutral shared React components, verified by `scripts/shared-auxiliary-route-bodies.test.mjs` and `e2e/shared-auxiliary-routes.spec.ts`
- [x] 3.4 Move the browser connected-workspace shell chrome and body into shared components driven by the authenticated workspace snapshot, verified by `scripts/web-shared-workspace.test.mjs` and `scripts/server-workspace-reconciliation.test.mjs`
- [x] 3.5 Wire the production browser Recordings, Settings, and Macros routes to canonical clients through the authenticated `TerminayClient`, verified by `scripts/server-recordings-route.test.mjs`, `scripts/server-settings-route.test.mjs`, and `scripts/server-macros-route.test.mjs`
- [x] 3.6 Snapshot every accepted shared route panel as bounded, deeply frozen, data-only state and reject mutable or accessor-backed models at the React boundary, verified by `SharedWorkspaceRoutePanel.test.mjs` and `e2e/shared-workspace-route-surface.spec.ts`
- [x] 3.7 Require every registered route to provide its complete canonical panel set at the ready boundary and fail closed otherwise, verified by `createCompleteSharedWorkspaceRoutePanel` and its tests
- [x] 3.8 Render the composed shared route and editor surfaces at wide, medium, and narrow widths with no horizontal page overflow, verified by `e2e/shared-workspace-route-surface.spec.ts`, `e2e/shared-route-editor-surface.spec.ts`, and `e2e/shared-responsive-shell.spec.ts`
- [x] 3.9 Verify the Desktop and browser host adapters resolve every registered route to the identical frozen component and region contract, verified by `scripts/task16-desktop-web-route-parity.test.mjs`
- [x] 3.10 Exercise the production Desktop renderer from its immutable generated artifact at 1280px, 900px, and 640px across all seven routes with 30 per-view screenshots, verified by `e2e/desktop-shared-route-visual.spec.ts` and `e2e/shared-production-routes.spec.ts`
- [x] 3.11 Add the host-neutral roving route tablist, accessibility preference policy, and keyboard skip link to the real shared shell, verified by `e2e/shared-responsive-shell.spec.ts`
- [x] 3.12 Capability-gate file selection, `openWindow`, OS reveal, external open, and updater actions with explicit capability errors, verified by `apps/terminay-desktop/test/desktop-presentation.test.mjs`
- [x] 3.13 Keep server workspace behaviour independent of host capability presence, verified by `packages/responsive-ui/test/ui.test.mjs`
- [x] 3.14 Mechanically enforce the renderer-neutral package boundary so shared components import no Electron, IPC, browser transport, Node process, or host global, verified by `packages/shared-ui/src/components/SharedUiBoundary.test.mjs`

## 4. Server bundle

- [x] 4.1 Produce one content-hashed manifest containing the complete UI inventory, assets, CSP requirement, server and protocol compatibility, and entry point, verified by `scripts/ui-bundle-manifest.test.mjs`
- [x] 4.2 Verify entry-point executable and stylesheet references resolve only to manifest-declared assets and normalise the canonical self-only CSP, verified by `packages/server-core/test/ui-bundle.test.mjs` and `apps/terminay-server/test/committed-bundle-ui.test.mjs`
- [x] 4.3 Launch Electron E2E from a per-run immutable verified copy of the generated renderer bundle, verified by `scripts/immutable-renderer-artifact.test.mjs` and `e2e/server-client-context.spec.ts`
- [x] 4.4 Load the bundle from Local, embedded, and verified remote asset installation through the same entry and asset request shape, verified by `apps/terminay-server/test/generated-ui-launch-paths.test.mjs` and `apps/terminay-server/test/local-ui-server.test.mjs`
- [x] 4.5 Prune superseded content-addressed bundles only after atomically replacing `current.json`, verified by `packages/server-core/test/ui-bundle-store.test.mjs`

## 5. Parity and visual tests

- [x] 5.1 Build a feature parity matrix from every canonical feature specification, verified by `scripts/task16-feature-parity-matrix.test.mjs` failing when a feature spec is missing
- [x] 5.2 Verify terminal, file, Git, agent, macro, recording, settings, and connection failure contracts at narrow, medium, and wide widths, verified by `e2e/shared-panel-contract-states.spec.ts` and `SharedErrorStateMatrix.test.mjs`
- [x] 5.3 Verify live portrait-to-landscape reflow of the real shared web shell with no horizontal overflow, verified by `e2e/shared-responsive-shell.spec.ts`
