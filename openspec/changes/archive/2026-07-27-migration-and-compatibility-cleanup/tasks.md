## 1. Data inventory and import

- [x] 1.1 Inventory and version settings, macros, safe-storage secrets, remote
  devices, reconnect grants, audit records, TLS paths, recordings, and connection
  metadata from every supported Desktop release via a bounded alias-aware preflight
  (`inspectLegacyMigration.storeVersions`), verified by values remaining excluded
- [x] 1.2 Implement idempotent embedded import with a completion marker, backup,
  resumable failure, and no plaintext secret files, verified by
  `packages/server-core/test/migration.test.mjs` and
  `packages/server-core/test/migration-recovery.test.mjs`
- [x] 1.3 Preserve project files and recordings in place and represent missing
  paths explicitly in the bounded migration inventory, verified by
  `packages/server-core/test/migration-inventory.test.mjs`
- [x] 1.4 Explain that renderer-only historic layouts cannot be recovered and
  persist the new canonical workspace immediately: `WorkspaceRepository.load()`
  commits the empty canonical snapshot on first server load
- [x] 1.5 Report renderer-only historic layouts as unrecoverable during migration
  preflight, verified by `packages/server-core/test/migration-inventory.test.mjs`
- [x] 1.6 Detect cloned or colliding server identities and require explicit
  resolution, verified by `packages/server-core/test/migration.test.mjs`

## 2. Manager and connection migration

- [x] 2.1 Move or redirect sanitized `app.terminay.com` manager metadata to
  `web.terminay.com` without copying cross-origin credentials, verified by
  `sanitizeManagerProfiles` and
  `packages/server-core/test/migration-compatibility.test.mjs`
- [x] 2.2 Preserve existing `<session>.terminay.com` origins and valid reconnect
  grants, verified by `scripts/task19-migration-reconnect.test.mjs` running the
  real migration runner beside the persisted Electron reconnect store, reloading
  the unchanged origin-bound grant, and completing a fresh challenge and proof
- [x] 2.3 Migrate Desktop connection profiles separately from server trust state,
  verified by `separateConnectionProfilesFromTrust`
- [x] 2.4 Verify pairing fragments and credentials never enter either manager
  origin, verified by non-canonical profile URLs being rejected and trust and
  profile outputs omitting credential-bearing fields

## 3. Compatibility and rollback

- [x] 3.1 Retire the temporary compatibility runtime modes after migrating their
  callers, verified by the old runtime and compatibility barrel being absent, the
  normal Desktop renderer staying outside privileged compatibility layers, and the
  remaining named adapters requiring explicit narrow host capabilities
  (`scripts/task19-preload-compatibility-boundary.test.mjs`,
  `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`)
- [x] 3.2 Define minimum versions and precise incompatibility errors across
  Desktop, server, bundled UI, bootstrap, and signaling, verified by
  compatibility-matrix tests asserting deterministic minimum-version errors before
  migration or backup
- [x] 3.3 Define and enforce backward-compatible hosted deployment ordering before
  dependent clients, verified by `scripts/hosted-deployment-order.test.mjs` proving
  a hosted compatibility window covers currently deployed and dependent client
  versions and rejecting client publication or hosted retirement before hosted
  publication and verification; actual external hosted deployment remains an
  operational boundary
- [x] 3.4 Keep direct server-bundled UI as the recovery client via explicit
  credential-free fallback metadata, verified by `createRecoveryClientFallback` and
  `packages/server-core/test/migration-recovery.test.mjs`
- [x] 3.5 Restore pre-migration Electron state on rollback only before server-only
  mutations commit and provide explicit backup recovery after that boundary,
  verified by `packages/server-core/src/migration/runner.ts` and
  `packages/server-core/test/migration-electron-rollback.test.mjs`

## 4. Parity evidence matrix

- [x] 4.1 Record every required surface and canonical feature as an explicit
  evidence cell in `scripts/task19-compatibility-matrix.mjs`, keeping partial and
  open cells visible and not claiming rendered parity; validation resolves task
  contracts from either the active or completed task directory
  (`scripts/task19-compatibility-matrix.test.mjs`)
- [x] 4.2 Re-audit the matrix after the shared-responsive UI move and the fresh
  full serial application run, so Local Desktop contract cells cite their real
  feature E2E suites and the shared shell cites Desktop-wide plus wide and
  touch-mobile Chromium route coverage
- [x] 4.3 Re-audit mobile-web evidence after the touch-enabled Chromium settings,
  file-open, and terminal-lifecycle workflows; correct the invalid 52/52 claim and
  mark all 26 wide and mobile web cells partial until the shared responsive UI work
  closes (`e2e/shared-production-routes.spec.ts`,
  `scripts/task19-compatibility-matrix.test.mjs`, and the mobile Chromium evidence
  notes for settings, files, and terminal)
- [x] 4.4 Prove Git pull, rename, Quick Push approval and removal, and recordings
  select, replay, delete, and list-empty behaviour with bounded overflow, plus
  project and panel create, move, and close through the bounded `WorkspaceClient`,
  in dedicated touch Chromium workflows
- [x] 4.5 Promote AI and dictation mobile-web parity at project-rendered scope,
  verified by touch-mobile Chromium driving idle, recording, error, cancel, and
  ready states, bounded submit, immutable target identity, and provider-error
  recovery through `DictationCaptureClient` and `MobileDictationUploadClient` with
  accessible 44-pixel actions and no horizontal overflow
  (`src/shared/MobileDictationWorkflow.tsx`, `e2e/mobile-dictation.spec.ts`)

## 5. Application-protocol and end-to-end evidence

- [x] 5.1 Run the checked-in deterministic application-protocol suites through
  `scripts/task19-application-protocol.mjs`, without claiming external browser or
  hosted pairing and reconnect execution
- [x] 5.2 Keep the deterministic application-protocol inventory explicit across
  canonical workspace, terminal, Git, macro, AI, file, remote, pairing, reconnect,
  and browser reconnect-vault domains, verified by the runner failing if a required
  domain is no longer backed by an included checked-in suite
  (`scripts/task19-application-protocol.test.mjs`)
- [x] 5.3 Include the browser host's exact-origin reconnect-vault and stale-attempt
  invalidation contracts in that inventory, verified by
  `apps/terminay-web/test/connection-host.test.mjs` and
  `scripts/web-reconnect-attempt-lifecycle.test.mjs`
- [x] 5.4 Run the local real Electron-to-standalone pairing authority-switch E2E
  (`npx playwright test -c scripts/task7-playwright.config.ts`), proving the Desktop
  compatibility host returns from pairing and binds the selected server authority
- [x] 5.5 Exercise the complete Desktop renderer MessagePort connector against a
  server composition owning activity, agent-status, workspace, and terminal
  authority, covering handshake and setup deadlines, binary output, input, resize,
  detach, and clean disposal (`scripts/server-port-transport.test.mjs`)
- [x] 5.6 Run the complete checked-in Playwright application suite serially after
  the shared-UI move and activity-acknowledgement closure: `npx playwright test
  --workers=1` completed with 172 passed, 5 explicitly environment-gated skips, and
  0 failures

## 6. Removing second renderer authorities

- [x] 6.1 Re-audit the hidden compatibility graph after the shared-UI move and the
  provider redesigns; the now-empty `rendererCompatibility` bootstrap and its
  dynamic-import edge were removed and the two native workspace presentation
  adapters were folded into `DesktopConnectionHost` and deleted
- [x] 6.2 Lock the connected renderer one-server-model authority baseline at exact
  zero, cited separately from rendered parity
  (`scripts/one-server-model-boundary-baseline.json`,
  `scripts/one-server-model-boundary.test.mjs`)
- [x] 6.3 Inventory the remaining hidden compatibility imports as exact directed
  edges so normal web entries stay compatibility-free and any new edge fails until
  removed or explicitly classified
  (`scripts/task19-hidden-compatibility-imports.test.mjs`)
- [x] 6.4 Reclassify the final exact compatibility graph after parity, quarantining
  the retired Electron terminal service and its protocol with no normal main or
  bootstrap importer (`scripts/task19-webrtc-host-isolation.test.mjs`)
- [x] 6.5 Replace the live browser enrollment dependency on the terminal-only
  session socket with a framed `ByteTransport` over the isolated
  control/application/terminal/assets channel set, removing the duplicate terminal
  buffer UI, session-message protocol, and renderer socket sources
  (`src/web/browserWebRtcTransport.ts`,
  `scripts/task19-browser-webrtc-application-transport.test.mjs`)
- [x] 6.6 Reject terminal attachment authorization naming a different server,
  project, or session than the canonical attachment identity
  (`packages/client-core/test/terminal-client.test.mjs`)
- [x] 6.7 Route shared workspace panel activation through the bounded typed
  `WorkspaceClient.activatePanel` facade rather than a raw `workspace.command`
  envelope (`scripts/task19-typed-workspace-activation.test.mjs`)
- [x] 6.8 Bind typed cross-view project-move acknowledgements to the requested
  canonical project identity (`scripts/task19-typed-project-move.test.mjs`)
- [x] 6.9 Keep shared workspace selection and panel activation on the one
  connection-owned `WorkspaceSnapshotStore`, with no fallback `WorkspaceClient` or
  polling projection (`scripts/task19-single-workspace-projection.test.mjs`)
- [x] 6.10 Keep workspace delta polling behind the typed canonical revision and
  cursor facade, rejecting legacy arbitrary cursors and malformed snapshot
  revisions (`scripts/task19-typed-workspace-delta.test.mjs`)
- [x] 6.11 Remove legacy per-recording layout and theme presentation metadata from
  the canonical client DTO while old server responses stay readable
  (`scripts/task19-recording-presentation-compatibility.test.mjs`)
- [x] 6.12 Require the canonical settings change subscription so `SettingsClient`
  no longer turns a missing subscription into a quiet no-op
  (`scripts/task19-settings-subscription-authority.test.mjs`)
- [x] 6.13 Require canonical macro definition and run subscriptions so `MacroClient`
  rejects a transport that cannot subscribe
  (`scripts/task19-macro-subscription-authority.test.mjs`)
- [x] 6.14 Make the generic `TerminayClientFacade` reject a requested event
  subscription when its transport only supports queries and commands
  (`scripts/task19-facade-subscription-authority.test.mjs`)
- [x] 6.15 Require a canonical live subscription transport before an
  `ActivityClient` can be constructed
  (`scripts/task19-activity-subscription-authority.test.mjs`)
- [x] 6.16 Require a canonical live subscription transport before an
  `AgentStatusClient` accepts a transport
  (`scripts/task19-agent-status-subscription-authority.test.mjs`)
- [x] 6.17 Import only the allowlisted host-local connection-profile DTO so legacy
  workspace, terminal, trust, capability, and presentation fields fail closed
  (`scripts/task19-connection-profile-import-boundary.test.mjs`)
- [x] 6.18 Require activity and agent status projections when creating a shared
  authenticated server context, so no partial compatibility connection is retained
  (`scripts/task19-required-server-projections.test.mjs`)
- [x] 6.19 Remove the legacy Electron WebRTC host from the normal Desktop renderer
  module graph, including its former explicit compatibility route
  (`scripts/task19-webrtc-host-isolation.test.mjs`)
- [x] 6.20 Keep the retired terminal-only remote source graph out of every normal
  Desktop workspace and static-web entry, including its protocol, services, and
  `remote.html` (`scripts/task19-webrtc-host-isolation.test.mjs`)
- [x] 6.21 Keep the legacy AI-metadata adapter as a request/response transport only,
  so it cannot manufacture placeholder server, project, panel, or terminal
  identities (`scripts/task19-ai-metadata-compatibility-authority.test.mjs`)
- [x] 6.22 Exclude the retired terminal-only `remote.html` client from the static
  web PWA build (`scripts/web-build-contract.test.mjs`, `scripts/web-image.test.mjs`)
- [x] 6.23 Remove the unused legacy renderer workspace-seed adapter and guard
  against its reintroduction
  (`apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`)

## 7. Narrow versioned host bridges

- [x] 7.1 Remove the native workspace-adoption and logical-view compatibility
  modules after folding their rollback-safe presentation behaviour into
  `DesktopConnectionHost`, so project moves, view creation, and view closure call
  the canonical typed `WorkspaceClient` directly
  (`apps/terminay-desktop/test/workspace-adoption.test.mjs`)
- [x] 7.2 Remove the now-empty Desktop compatibility barrel so the old barrel and
  deleted native adapters cannot be restored as public or renderer-facing authority
- [x] 7.3 Restrict native project-popout and logical-view-close behaviour to typed
  `WorkspaceClient.createView` and `WorkspaceClient.closeView`, without a generic
  `WorkspaceClient.command` capability
- [x] 7.4 Keep native workspace-adoption and logical-view-close behaviour inside
  `DesktopConnectionHost` in the Desktop main process, unreachable from the
  renderer, preload boundary, or public Desktop API
- [x] 7.5 Move native project-adoption notifications into the frozen
  workspace-transfer host, which validates each transfer payload before notifying
  the renderer (`scripts/workspace-transfer-host-bridge.test.mjs`)
- [x] 7.6 Move native project-tab drag-hover and torn-off notifications into the
  narrow project-tab host, which rejects malformed cross-window presentation
  messages (`scripts/project-tab-host-bridge.test.mjs`)
- [x] 7.7 Move native terminal copy-request notifications into the narrow clipboard
  host (`scripts/terminal-clipboard-host-bridge.test.mjs`)
- [x] 7.8 Move native terminal zoom notifications into the narrow
  terminal-presentation host, which accepts only a finite single-field zoom message
  (`scripts/terminal-presentation-host-bridge.test.mjs`)
- [x] 7.9 Move remote terminal viewport-override notifications into the same host,
  which validates the exact active/inactive union, bounded session identity, and
  integer dimensions
- [x] 7.10 Move native settings focus-section notifications into the narrow
  settings-window host (`scripts/settings-window-host-bridge.test.mjs`)
- [x] 7.11 Move file-explorer watch and folder-size progress notifications into the
  narrow file-explorer host, validating bounded paths, event variants, job
  identities, counts, and sizes (`scripts/file-explorer-host-bridge.test.mjs`)
- [x] 7.12 Remove the stale broad `TerminayApi` recording-change subscription
  declaration so recording events come only from the dedicated frozen recording
  host
- [x] 7.13 Move legacy remote-access status notifications into a read-only versioned
  status host rejecting malformed modes, counters, and unbounded device,
  connection, audit, or address collections
  (`scripts/task19-remote-access-status-host.test.mjs`)
- [x] 7.14 Move the preload-owned server connection lifecycle and framed transport
  supplier into one frozen versioned server-connection host validating bounded
  server identities, connection labels, listeners, and 16 MiB non-empty frames, and
  make renderer handshake and required projection setup fail closed on bounded
  deadlines (`scripts/task19-server-frame-capability.test.mjs`,
  `scripts/task19-server-connection-lifecycle-capability.test.mjs`)
- [x] 7.15 Remove the unused Electron terminal-activity event supplier rather than
  creating another narrow host
  (`scripts/task19-terminal-activity-preload-removal.test.mjs`)
- [x] 7.16 Move the complete file-viewer, terminal-settings, macro-settings and
  secrets, and AI-metadata compatibility suppliers into dedicated frozen versioned
  hosts with validated, immutable, size-bounded change envelopes
  (`scripts/task19-settings-capability-snapshot.test.mjs`,
  `scripts/task19-preload-compatibility-boundary.test.mjs`)
- [x] 7.17 Move edit-window state and result, Quick Push plan and apply, and remote
  pairing-PIN operations into three frozen versioned hosts injected at their
  renderer composition boundaries, absent from public `TerminayApi`
  (`scripts/task19-edit-window-capability.test.mjs`,
  `scripts/task19-quick-push-capability.test.mjs`,
  `scripts/task19-remote-pairing-pin-capability.test.mjs`)
- [x] 7.18 Remove zero-consumer file-viewer, terminal-settings, macro/secret, and
  native operations from the publicly exposed preload object, allowing the empty
  broad `terminay` global and the `TerminayApi` marker to be removed completely
  (`scripts/task19-public-preload-residual.test.mjs`)
- [x] 7.19 Split the remaining native presentation actions into explicit versioned
  host capabilities with no durable project data authority — clipboard, reveal,
  external URL, app and menu commands, terminal presentation zoom and size, project
  tab drag and popout, workspace transfer, window lifecycle, and native dialogs —
  with a declaration gate freezing each version-one operation set
  (`scripts/task19-native-presentation-capabilities.test.mjs`)
- [x] 7.20 Remove the unused renderer `app:open-macros` preload IPC capability while
  keeping native menu ownership in the Desktop main host

## 8. Explicit capability injection in the renderer

- [x] 8.1 Require each remaining recordings and AI-metadata compatibility adapter to
  receive its narrow host capability explicitly, so none can silently capture the
  broad preload object
- [x] 8.2 Require the remaining settings and file-viewer compatibility adapters to
  receive their narrow host capability explicitly
- [x] 8.3 Snapshot the named settings host operations into an immutable
  compatibility capability before constructing `SettingsClient`
  (`src/services/settings/legacySettingsCapability.ts`)
- [x] 8.4 Move the legacy file-viewer gateway's broad-preload acquisition to the
  named renderer-entry compatibility boundary, injecting isolated file and folder
  compatibility instances through `DisconnectedFileCompatibilityProvider`
  (`src/services/fileViewer/terminayFileGateway.ts`)
- [x] 8.5 Snapshot the named file-viewer host operations into an immutable
  capability before constructing each provider-owned gateway
- [x] 8.6 Remove the file-viewer renderer-global registry so each renderer tree owns
  an explicitly injected frozen compatibility provider
  (`src/services/fileViewer/DisconnectedFileCompatibilityProvider.tsx`,
  `scripts/task19-file-viewer-capability.test.mjs`)
- [x] 8.7 Snapshot the named recordings and AI-metadata host operations before
  constructing their legacy compatibility clients
  (`src/services/recordings/legacyRecordingsClient.ts`,
  `src/services/ai/legacyAiTabMetadataClient.ts`)
- [x] 8.8 Snapshot the named macro-settings read and change-notification operations
  before the legacy macro hook subscribes
  (`src/services/macros/legacyMacroSettingsCapability.ts`)
- [x] 8.9 Require the legacy macro hook's narrow host capability at each named
  renderer hand-off so `useMacroSettings` no longer defaults to `window.terminay`
- [x] 8.10 Move macro-settings compatibility acquisition to the renderer composition
  root through `LegacyMacroSettingsProvider`
- [x] 8.11 Move the legacy macro editor's secrets and macro-mutation operations onto
  the same frozen named macro capability (`src/components/MacrosWindow.tsx`)
- [x] 8.12 Move legacy terminal-settings acquisition to the renderer composition
  root so `useTerminalSettings` fails closed outside
  `TerminalSettingsClientProvider`
- [x] 8.13 Inject the recordings and AI-metadata named hosts directly at their
  composition callers
- [x] 8.14 Remove the macro-settings renderer-global registry and compatibility
  hand-off, constructing one frozen eight-operation capability in `RendererEntry`
  (`scripts/task19-renderer-capability-one-shot.test.mjs`)
- [x] 8.15 Remove the terminal-settings renderer-global registry and compatibility
  hand-off, injecting one frozen legacy settings client through
  `TerminalSettingsClientProvider`
- [x] 8.16 Route remote-access pairing-mode changes through the injected terminal
  settings client (`scripts/task14-settings-client-path.test.mjs`)
- [x] 8.17 Inject the named remote-access status client into the workspace
  controller and into the standalone Settings window through `ServerSettingsRoute`,
  keeping JSON-only browser settings routes host-free
- [x] 8.18 Remove the recordings renderer-global registry and compatibility hand-off,
  passing `terminayRecordingServiceHost` directly to the validating adapter
- [x] 8.19 Remove the AI-metadata renderer-global registry and compatibility
  hand-off, passing `terminayAiMetadataHost` directly to the validating adapter
- [x] 8.20 Remove the auxiliary Desktop edit-tab registry and renderer-global
  compatibility hand-off, injecting the two-operation `terminayEditWindowHost` at
  the renderer route boundary
- [x] 8.21 Remove the transitional Desktop Quick Push wrapper and renderer-global
  hand-off, injecting the frozen two-method `terminayQuickPushHost` through `App`
  and `ProjectWorkspace`
- [x] 8.22 Remove the server-frame renderer-global registry, injecting a frozen
  two-operation snapshot of `terminayServerConnectionHost` through the connection
  factory (`src/shared/legacyServerFrameCapability.ts`)
- [x] 8.23 Remove the server-connection lifecycle renderer-global registry, injecting
  the host into a frozen two-operation adapter retaining only connection
  subscription and requested rehydration
  (`src/shared/legacyServerConnectionLifecycleCapability.ts`)
- [x] 8.24 Remove the transitional remote pairing-PIN registry and renderer-global
  hand-off, requiring the exact two-operation `RemotePairingPinClient`
- [x] 8.25 Remove `legacyFallback` from `src/rendererRuntime.tsx` and the shared
  responsive entry so web and Electron both enter `ConnectedRendererWorkspace ->
  App` (`scripts/task16-production-ui-route.test.mjs`)

## 9. Connected Desktop reads server-owned data

- [x] 9.1 Re-audit every remaining production `window.terminay*Host` call in
  `src/App.tsx`, `src/rendererRuntime.tsx`, `src/workspace/**`, and
  `src/components/**`, classifying each as server data authority to move to the
  `TerminayClient` protocol, native presentation to keep as a narrow bridge, or
  disconnected-only compatibility to delete after parity
- [x] 9.2 Move Electron file-explorer and Git fallback reads and mutations onto
  server-owned `FileViewerClient` and `TerminayGitClient` operations, keeping
  native reveal and copy as narrow capabilities
  (`scripts/git-worktree-host-bridge.test.mjs`,
  `scripts/file-explorer-git-status-stability.test.mjs`)
- [x] 9.3 Remove the disconnected file-viewer compatibility gateway and legacy
  file-viewer transport from the normal connected Desktop path, gating the
  disconnected panel on `terminalClientContext === null` and failing sparse-save
  revision lookup closed in connected mode
  (`scripts/file-viewer-shared-client.test.mjs`,
  `scripts/task16-connected-folder-panel-capability.test.mjs`)
- [x] 9.4 Remove connected macro persistence and subscriptions from the Electron
  `macros.json` compatibility capability, so connected Desktop reads, replaces,
  resets, and observes definitions exclusively through `MacroClient`
  (`scripts/task19-connected-macro-authority.test.mjs`)
- [x] 9.5 Upload connected dictation audio through the selected server's binary
  `TerminayAiClient` with the exact server, project, panel, and session identity,
  while Electron retains microphone capture and permission as a native capability
- [x] 9.6 Persist only connection-host presentation fields and the microphone device
  override in Electron's local settings file, writing terminal behaviour,
  recording, remote, shell, AI, and dictation provider settings only through the
  selected server `SettingsClient` (`src/terminalSettings.ts`, `electron/main.ts`,
  `packages/server-core/src/settings/defaults.ts`)
- [x] 9.7 Route connected model discovery, recording state, and Parakeet runtime
  management through the selected server clients, retaining the Electron adapters
  only for explicitly disconnected UI and native microphone and device work
- [x] 9.8 Move OpenAI transcription and API-key mutation into the selected Terminay
  Server: the client uploads the key only as a bounded binary command, the server
  stores it in its vault, exposes metadata-only status, scopes plaintext to the
  provider callback, and zeroizes vault inputs
  (`packages/server-core/test/openai-dictation-provider.test.mjs`)

## 10. Final boundary gates

- [x] 10.1 Remove terminal and server-frame compatibility bootstrap from normal
  Electron startup, so packaged Local and remote windows launch the selected
  server's verified bundle with `serverUiPreload` and its identity-bound byte
  endpoint and the legacy renderer connection/frame capability remains reachable
  only from the explicit Vite development harness
  (`apps/terminay-desktop/test/server-bundle-host.test.mjs`)
- [x] 10.2 Tighten boundary tests for the one-server-model baseline, hidden
  compatibility imports, preload compatibility boundary, and renderer preload
  boundary so any new connected-renderer import or call of a legacy or preload data
  host fails (`scripts/one-server-model-boundary.test.mjs`,
  `scripts/task19-hidden-compatibility-imports.test.mjs`,
  `scripts/task19-preload-compatibility-boundary.test.mjs`,
  `scripts/task19-public-preload-residual.test.mjs`)
- [x] 10.3 Verify feature specifications remain present-tense product contracts by
  removing migration-progress qualifiers from the recording and server-runtime
  compatibility contracts and keeping progress in this change
  (`scripts/task19-20-audit.test.mjs`)
- [x] 10.4 Confirm the acceptance outcomes: a supported Desktop profile migrates
  settings, macros, secrets, remote trust, profiles, and recordings without
  plaintext leakage or data loss; an interrupted import resumes or rolls back from a
  tested backup; existing session origins reconnect or receive one explicit repair
  path; the feature parity matrix passes for Local Desktop, three remote Desktop
  windows, wide web, and mobile web; and old duplicate application and remote
  authorities are absent from production
