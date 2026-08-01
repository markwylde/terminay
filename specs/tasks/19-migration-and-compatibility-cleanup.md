# Migration and compatibility cleanup

## Goal

Migrate existing Desktop data safely, prove product parity, remove transitional
implementations, and leave the server-backed architecture as the only product
authority.

## Governing specifications

- [Terminay core](../CORE.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- Every feature specification whose state or service belongs to the server.

## Why this is active

The architecture changes persistence, credentials, UI ownership, connection
profiles, and remote origins. A flag-day replacement can lose user state, and
removing old paths before full parity can make recovery impossible.

The current evidence boundary is recorded in
[`task19-20-release-migration-audit.md`](../decisions/evidence/task19-20-release-migration-audit.md).

## Dependencies

- [Workspace and protocol foundation](../tasks_completed/4-workspace-and-protocol-foundation.md)
- [Server-owned workspace model](../tasks_completed/5-server-owned-workspace-model.md)
- [Standalone and embedded server runtime](../tasks_completed/6-standalone-and-embedded-server-runtime.md)
- [Desktop connection host and Local mode](../tasks_completed/7-desktop-connection-host-and-local-mode.md)
- [Server terminal service](../tasks_completed/8-server-terminal-service.md)
- [Server activity and agent services](../tasks_completed/9-server-activity-and-agent-services.md)
- [Server MCP control](../tasks_completed/10-server-mcp-control.md)
- [Server files and file viewer](../tasks_completed/11-server-files-and-file-viewer.md)
- [Server Git, worktrees, and Quick Push](../tasks_completed/12-server-git-worktrees-and-quick-push.md)
- [Server recordings](../tasks_completed/13-server-recordings.md)
- [Server settings, secrets, and macros](../tasks_completed/14-server-settings-secrets-and-macros.md)
- [Server AI metadata and dictation](../tasks_completed/15-server-ai-and-dictation.md)
- [Shared responsive server UI](./16-shared-responsive-server-ui.md)
- [Full WebRTC server connections](../tasks_completed/17-full-webrtc-server-connections.md)
- [Connection menu and web host](../tasks_completed/18-connection-menu-and-web-host.md)

## Work slices

### Data inventory and import

- [x] Inventory/version settings, macros, safe-storage secrets, remote devices,
  reconnect grants, audit records, TLS paths, recordings, and connection
  metadata from every supported Desktop release via bounded alias-aware
  preflight (`inspectLegacyMigration.storeVersions`); values remain excluded.
- [x] Implement idempotent embedded import with completion marker, backup,
  resumable failure, and no plaintext secret files
  (`packages/server-core/test/migration.test.mjs`,
  `packages/server-core/test/migration-recovery.test.mjs`).
- [x] Preserve project files and recordings in place and represent missing
  paths explicitly in the bounded migration inventory (`inspectLegacyMigration`)
  (`packages/server-core/test/migration-inventory.test.mjs`).
- [x] Explain that renderer-only historic layouts cannot be recovered; persist
  the new canonical workspace immediately. `WorkspaceRepository.load()` now
  commits the empty canonical snapshot on first server load, while migration
  preflight reports renderer-only layouts as unrecoverable.
- [x] Report renderer-only historic layouts as unrecoverable during migration
  preflight (`inspectLegacyMigration`, `packages/server-core/test/migration-inventory.test.mjs`).
- [x] Detect cloned/colliding server identities and require explicit
  resolution (`packages/server-core/test/migration.test.mjs`).

### Manager and connection migration

- [x] Move or redirect sanitized `app.terminay.com` manager metadata to
  `web.terminay.com` without copying cross-origin credentials
  (`sanitizeManagerProfiles`, `packages/server-core/test/migration-compatibility.test.mjs`).
- [x] Preserve existing `<session>.terminay.com` origins and valid reconnect
  grants. `scripts/task19-migration-reconnect.test.mjs` runs the real migration
  runner beside the persisted Electron reconnect store, reloads the unchanged
  origin-bound grant, and completes a fresh challenge/proof.
- [x] Migrate Desktop connection profiles separately from server trust state
  (`separateConnectionProfilesFromTrust`,
  `packages/server-core/test/migration-compatibility.test.mjs`).
- [x] Verify pairing fragments and credentials never enter either manager
  origin; non-canonical profile URLs are rejected and trust/profile outputs
  omit credential-bearing fields (`sanitizeManagerProfiles`, same test).

### Compatibility and rollback

- [x] Retire the temporary compatibility runtime modes after migrating their
  callers. The old runtime and compatibility barrel are absent, the normal
  Desktop renderer stays outside privileged compatibility layers, and the
  remaining named adapters require explicit narrow host capabilities
  (`scripts/task19-preload-compatibility-boundary.test.mjs`,
  `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`).
- [x] Define minimum versions and precise incompatibility errors across Desktop,
  server, bundled UI, bootstrap, and signaling. Compatibility-matrix tests
  assert deterministic minimum-version errors before migration or backup.
- [x] Define and enforce backward-compatible hosted deployment ordering before
  dependent clients.
  `scripts/hosted-deployment-order.test.mjs` proves a hosted compatibility
  window covers currently deployed and dependent client versions, and rejects
  client publication or hosted retirement before hosted publication and
  verification. Actual external hosted deployment remains an operational
  boundary.
- [x] Keep direct server-bundled UI as the recovery client via explicit
  credential-free fallback metadata (`createRecoveryClientFallback`,
  `packages/server-core/test/migration-recovery.test.mjs`).
- [x] Restore pre-migration Electron state on rollback only before server-only
  mutations commit; provide explicit backup recovery after that boundary
  (`packages/server-core/src/migration/runner.ts`,
  `packages/server-core/test/migration-electron-rollback.test.mjs`).

### Parity and cleanup

- [ ] Complete the project-code and reproducible rendered feature matrix for
  Local Desktop, remote Desktop, wide web, and emulated mobile web. Physical
  devices and externally hosted execution are tracked only by the operational
  follow-up below.
  - [x] Record every required surface and canonical feature as an explicit
    evidence cell in `scripts/task19-compatibility-matrix.mjs`; the matrix
    keeps partial/open cells visible and does not claim rendered parity.
    Validation resolves task contracts from either the active or completed
    task directory, so moving a completed task does not silently invalidate
    its evidence (`scripts/task19-compatibility-matrix.test.mjs`).
  - [x] Re-audit the matrix after the shared-responsive UI move and the fresh
    full serial application run. Local Desktop contract cells now cite their
    real feature E2E suites, and the shared shell cites Desktop-wide plus
    wide/touch-mobile Chromium route coverage. Remote Desktop pairing and
    the completed remote-Desktop and rendered mobile workflows now have
    project-local contract evidence; no physical-device or hosted execution is
    part of this project checkbox.
  - [x] Re-audit mobile-web evidence after the touch-enabled Chromium settings,
    file-open, and terminal-lifecycle workflows. These substantive emulated
    browser workflows strengthen three existing `partial` cells but do not
    prove complete project-rendered feature parity for several shared feature
    bodies. Soft-keyboard behavior, mobile networking, backgrounding, and
    physical devices are operational follow-up only.
    Dedicated touch Chromium workflows additionally prove Git pull/rename/
    Quick Push approval/removal and recordings select/replay/delete/list-empty
    behavior with bounded overflow. The touch workspace workflow also covers
    project/panel create, move, and close through the bounded
    `WorkspaceClient`. The previous 52/52 claim is invalid: current wide and
    mobile web production use a different feature-body/component tree from
    Electron. Protocol workflows and overflow checks do not establish shared
    renderer or visual parity. The corrected matrix retains Desktop protocol
    evidence and marks all 26 wide/mobile web cells partial until Task 16
    closes (`e2e/shared-production-routes.spec.ts`,
    `scripts/task19-compatibility-matrix.test.mjs`,
    `specs/decisions/evidence/task19-mobile-chromium-settings.md`,
    `specs/decisions/evidence/task19-mobile-chromium-files.md`,
    `specs/decisions/evidence/task19-mobile-chromium-terminal.md`).
  - [x] Promote AI/dictation mobile-web parity at project-rendered scope.
    Touch-mobile Chromium now drives idle/recording/error/cancel/ready states,
    bounded submit, immutable target identity, and provider-error recovery
    through the named `DictationCaptureClient` and
    `MobileDictationUploadClient` boundaries with accessible 44-pixel actions
    and no horizontal overflow. Real microphone capture, provider execution,
    permission prompts, soft-keyboard behavior, and physical-device execution
    remain non-checkbox operational evidence. Coverage:
    `src/shared/MobileDictationWorkflow.tsx`,
    `e2e/mobile-dictation.spec.ts`, and
    `specs/decisions/evidence/task19-mobile-chromium-dictation.md`.
- [x] Run the checked-in E2E suites through the application protocol and the
  locally reproducible real pairing boundary.
  - [x] Run the checked-in deterministic application-protocol suites through
    `scripts/task19-application-protocol.mjs`; this does not claim external
    browser or hosted pairing/reconnect execution.
  - [x] Keep the deterministic application-protocol inventory explicit across
    canonical workspace, terminal, Git, macro, AI, file, remote, pairing,
    reconnect, and browser reconnect-vault domains. The runner fails if a
    required domain is no longer backed by an included checked-in suite; this
    remains local protocol evidence, not four-surface rendered parity
    (`scripts/task19-application-protocol.mjs`,
    `scripts/task19-application-protocol.test.mjs`).
  - [x] Include the browser host's exact-origin reconnect-vault and
    stale-attempt invalidation contracts in that deterministic application
    protocol inventory. They prove that a saved browser reconnect credential
    stays origin-bound and that forgetting a profile cannot revive an older
    asynchronous attempt; they do not claim a real hosted/browser pairing run
    (`apps/terminay-web/test/connection-host.test.mjs`,
    `scripts/web-reconnect-attempt-lifecycle.test.mjs`).
  - [x] Run the local real Electron-to-standalone pairing authority-switch E2E
    (`npx playwright test -c scripts/task7-playwright.config.ts`); it proves
    the Desktop compatibility host returns from pairing and binds the selected
    server authority. This is local evidence only, not hosted or reconnect
    coverage.
  - [x] Exercise the complete Desktop renderer MessagePort connector against a
    server composition that owns activity, agent-status, workspace, and
    terminal authority. The unfiltered fixture covers handshake/setup
    deadlines, binary output, input, resize, detach, and clean disposal; this
    remains local framed-transport evidence and does not claim hosted pairing
    (`scripts/server-port-transport.test.mjs`).
  - [x] Run the complete checked-in Playwright application suite serially after
    the Task 16 move and activity acknowledgement closure:
    `npx playwright test --workers=1` completed with 172 passed, 5 explicitly
    environment-gated skips, and 0 failures. This proves the local Desktop and
    checked-in Chromium application paths compose together; the skipped real
    provider/native-datachannel/TURN cases and external hosted pairing remain
    outside this evidence.

Operational follow-up (not a project checkbox): execute the environment-gated
native-datachannel/TURN/provider cases plus external hosted pairing and
reconnect on provisioned infrastructure and physical target devices. Record
that evidence in the compatibility matrix as operational assurance; it is not
part of the completed project-scoped parity or cleanup checkboxes.
- [ ] Remove broad application preload IPC, renderer workspace authority,
  hidden Electron WebRTC hosting, old terminal-only remote protocol/UI, and
  temporary adapters only after parity.
  - [x] Re-audit the hidden compatibility graph after the Task 16 move and the
    provider redesigns. The now-empty `rendererCompatibility` bootstrap and
    its dynamic-import edge were removed; every remaining allowlisted edge has
    a checked-in importer and a named Desktop/disconnected owner. The two
    native workspace presentation adapters have now been folded into
    `DesktopConnectionHost` and deleted.
  - [x] Keep migrated client paths and Desktop compatibility boundaries under
    deterministic preload/renderer checks in
    `scripts/task19-preload-compatibility-boundary.test.mjs`; after parity,
    these stable narrow Desktop/disconnected boundaries remain regression-tested
    without becoming connected-client authorities.
  - [x] Lock the connected renderer one-server-model authority baseline at
    exact zero. The feature matrix cites this architecture evidence separately
    from rendered parity, so a canonical-client boundary regression fails
    without promoting any contract/partial/open surface cell
    (`scripts/one-server-model-boundary-baseline.json`,
    `scripts/one-server-model-boundary.test.mjs`,
    `scripts/task19-compatibility-matrix.test.mjs`).
  - [x] Inventory the remaining hidden compatibility imports as exact directed
    edges. Only the renderer-entry hand-off, named transitional callers, and
    canonical transport bridge may reach legacy/disconnected modules; normal
    web entries remain compatibility-free, and any new edge fails until it is
    removed or explicitly classified
    (`scripts/task19-hidden-compatibility-imports.test.mjs`).
  - [x] Re-audit the final cleanup gate without converting live adapters into
    completion claims. Subsequent slices removed the renderer-global
    recordings/settings/macros providers, hidden Electron WebRTC host, and
    native workspace adoption/logical-view modules. Browser enrollment now
    reaches the shared application client through the canonical four-channel
    WebRTC transport. The remaining named settings, macro, recordings,
    AI-metadata, file, server-frame/lifecycle, and `legacyFallback` imports are
    stable bounded Desktop/disconnected feature-body owners, not temporary
    connected-client authorities.
  - [x] Replace the live browser enrollment dependency on the terminal-only
    session socket with a framed `ByteTransport` over the isolated
    control/application/terminal/assets channel set. The browser now creates a
    normal `TerminayClient` and shared server context; the duplicate terminal
    buffer UI, session-message protocol, and renderer socket sources are
    removed (`src/web/browserWebRtcTransport.ts`,
    `scripts/task19-browser-webrtc-application-transport.test.mjs`).
  - [x] Reclassify the final exact compatibility graph after parity reached
    52/52 contract cells. The remaining allowlisted imports are stable narrow
    Desktop host or disconnected-mode boundaries with active owners, not
    temporary migration adapters; normal connected web entries cannot acquire
    them. The retired Electron terminal service and its protocol are
    quarantined sources with no normal main/bootstrap importer, retained only
    by isolated historical test harnesses
    (`scripts/task19-hidden-compatibility-imports.test.mjs`,
    `scripts/task19-webrtc-host-isolation.test.mjs`).
  - [x] Reject terminal attachment authorization that names a different
    server/project/session than the canonical attachment identity, so the
    retired terminal-only compatibility shape cannot introduce a second client
    authority (`packages/client-core/test/terminal-client.test.mjs`).
  - [x] Route shared workspace panel activation through the bounded typed
    `WorkspaceClient.activatePanel` facade rather than constructing a raw
    `workspace.command` envelope in the renderer
    (`packages/client-core/test/workspace.test.mjs`,
    `scripts/task19-typed-workspace-activation.test.mjs`).
  - [x] Bind typed cross-view project-move acknowledgements to the requested
    canonical project identity; shared renderers cannot construct raw
    `project.move` messages or accept a compatibility drag adapter's
    mismatched project identity (`packages/client-core/test/workspace.test.mjs`,
    `scripts/task19-typed-project-move.test.mjs`).
  - [x] Keep shared workspace selection and panel activation on the one
    connection-owned `WorkspaceSnapshotStore`; the shared renderer no longer
    creates a fallback `WorkspaceClient` or polling projection
    (`scripts/task19-single-workspace-projection.test.mjs`).
  - [x] Keep workspace delta polling behind the typed canonical revision/cursor
    facade. `WorkspaceClient.delta` rejects legacy arbitrary cursors and
    malformed snapshot revisions before a renderer can treat them as workspace
    authority (`packages/client-core/test/workspace.test.mjs`,
    `scripts/task19-typed-workspace-delta.test.mjs`).
  - [x] Remove legacy per-recording layout/theme presentation metadata from the
    canonical client DTO. Old server responses remain readable, but those
    fields are discarded before they can recreate host-specific renderer
    authority (`packages/client-core/test/recordings.test.mjs`,
    `scripts/task19-recording-presentation-compatibility.test.mjs`).
  - [x] Require the canonical settings change subscription. `SettingsClient`
    no longer turns a missing subscription into a quiet no-op, so a
    compatibility transport cannot leave a stale host-side settings projection
    looking authoritative (`packages/client-core/test/query-command.test.mjs`,
    `scripts/task19-settings-subscription-authority.test.mjs`).
  - [x] Require canonical macro definition and run subscriptions. `MacroClient`
    rejects a transport that cannot subscribe instead of returning a silent
    no-op unsubscribe, so an old compatibility bridge cannot leave stale macro
    state or run progress looking authoritative
    (`packages/client-core/test/macros.test.mjs`,
    `scripts/task19-macro-subscription-authority.test.mjs`).
  - [x] Make the generic `TerminayClientFacade` reject a requested event
    subscription when its transport only supports queries and commands. It no
    longer returns a no-op unsubscribe that could let any feature facade retain
    stale renderer state as a second authority
    (`packages/client-core/test/query-command.test.mjs`,
    `scripts/task19-facade-subscription-authority.test.mjs`).
  - [x] Require a canonical live subscription transport before an
    `ActivityClient` can be constructed. Query/command-only compatibility
    bridges now fail before they can retain a stale activity projection as a
    second renderer authority (`packages/client-core/test/activity-client.test.mjs`,
    `scripts/task19-activity-subscription-authority.test.mjs`).
  - [x] Require a canonical live subscription transport before an
    `AgentStatusClient` accepts a transport. Query/command-only compatibility
    bridges now fail before a stale agent snapshot can become a second renderer
    authority (`packages/client-core/test/agent-status.test.mjs`,
    `scripts/task19-agent-status-subscription-authority.test.mjs`).
  - [x] Import only the allowlisted host-local connection-profile DTO. Legacy
    workspace, terminal, trust, capability, and presentation fields now fail
    closed rather than being silently accepted beside the server-owned
    authorities (`packages/client-core/test/connections.test.mjs`,
    `scripts/task19-connection-profile-import-boundary.test.mjs`).
  - [x] Require activity and agent status projections when creating a shared
    authenticated server context. The renderer no longer retains a partial
    compatibility connection when an old server cannot establish either
    canonical subscription (`scripts/task19-required-server-projections.test.mjs`).
  - [x] Remove the legacy Electron WebRTC host from the normal Desktop renderer
    module graph, including its former explicit compatibility route. Opening a
    renderer workspace cannot initialise that retired authority
    (`scripts/task19-webrtc-host-isolation.test.mjs`).
  - [x] Keep the retired terminal-only remote source graph out of every normal
    Desktop workspace and static-web entry. Normal workspace and browser
    entries cannot import its protocol, services, or `remote.html`
    (`scripts/task19-webrtc-host-isolation.test.mjs`).
  - [x] Keep the legacy AI-metadata adapter as a request/response transport
    only. It no longer manufactures placeholder server, project, panel, or
    terminal identities to emulate the canonical client, so the compatibility
    route cannot create a second authority
    (`scripts/task19-ai-metadata-compatibility-authority.test.mjs`).
  - [x] Exclude the retired terminal-only `remote.html` client from the static
    web PWA build. The web host ships only the shared connection/workspace
    entry; the Electron compatibility bundle remains separately scoped
    (`scripts/web-build-contract.test.mjs`, `scripts/web-image.test.mjs`).
  - [x] Remove the unused legacy renderer workspace-seed adapter. It had no
    production caller and could construct a second renderer-originated
    workspace import path; the Desktop compatibility export and source are now
    absent and guarded against reintroduction
    (`apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`).
  - [x] Remove the native workspace-adoption and logical-view compatibility
    modules after folding their rollback-safe presentation behavior into
    `DesktopConnectionHost`. Project moves, view creation, and view closure now
    call the canonical typed `WorkspaceClient` directly
    (`apps/terminay-desktop/test/workspace-adoption.test.mjs`,
    `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`).
  - [x] Remove the now-empty Desktop compatibility barrel. The old barrel and
    deleted native adapters cannot be restored as public or renderer-facing
    authority
    (`apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Restrict native project-popout and logical-view-close behavior to
    typed `WorkspaceClient.createView` and `WorkspaceClient.closeView` calls.
    The Desktop host does not require a generic `WorkspaceClient.command`
    capability, so it cannot recreate arbitrary renderer workspace commands
    (`packages/client-core/test/workspace.test.mjs`,
    `apps/terminay-desktop/test/workspace-adoption.test.mjs`).
  - [x] Keep native workspace-adoption and logical-view-close behavior inside
    `DesktopConnectionHost` in the Desktop main process. The renderer, preload
    boundary, and public Desktop API cannot import a compatibility adapter,
    preventing native presentation from becoming a second renderer authority
    (`apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`).
  - [x] Move native project-adoption notifications off the broad application
    preload and into the existing frozen workspace-transfer host. The narrow
    host validates each transfer payload before notifying the renderer, and
    the broad `TerminayApi` no longer exposes `onAdoptProject`
    (`scripts/workspace-transfer-host-bridge.test.mjs`).
  - [x] Move native project-tab drag-hover and torn-off notifications off the
    broad application preload and into the existing narrow project-tab host.
    The host rejects malformed cross-window presentation messages before they
    reach the renderer, and `TerminayApi` no longer exposes either subscription
    (`scripts/project-tab-host-bridge.test.mjs`).
  - [x] Move native terminal copy-request notifications off the broad
    application preload and into the existing narrow clipboard host. The
    renderer can subscribe only through that frozen OS-presentation capability,
    and `TerminayApi` no longer exposes `onTerminalCopyRequested`
    (`scripts/terminal-clipboard-host-bridge.test.mjs`).
  - [x] Move native terminal zoom notifications off the broad application
    preload and into the existing narrow terminal-presentation host. The host
    accepts only a finite single-field zoom message, and `TerminayApi` no
    longer exposes `onTerminalZoomChanged`
    (`scripts/terminal-presentation-host-bridge.test.mjs`).
  - [x] Move remote terminal viewport-override notifications off the broad
    application preload and into the existing narrow terminal-presentation
    host. The host validates the exact active/inactive union, bounded session
    identity, and integer dimensions before renderer delivery; `TerminayApi`
    no longer exposes the subscription
    (`scripts/terminal-presentation-host-bridge.test.mjs`).
  - [x] Move native settings focus-section notifications off the broad
    application preload and into the existing narrow settings-window host. The
    host validates the exact bounded section message before renderer delivery,
    and `TerminayApi` no longer exposes `onSettingsFocusSection`
    (`scripts/settings-window-host-bridge.test.mjs`).
  - [x] Move file-explorer watch and folder-size progress notifications off the
    broad application preload and into the existing narrow file-explorer host.
    The host validates bounded paths, event variants, job identities, counts,
    and sizes before renderer delivery
    (`scripts/file-explorer-host-bridge.test.mjs`).
  - [x] Remove the stale broad `TerminayApi` recording-change subscription
    declaration. Production recording events are exposed only by the dedicated
    frozen recording-service host used by the explicit compatibility hand-off
    (`scripts/file-explorer-host-bridge.test.mjs`).
  - [x] Move legacy remote-access status notifications off the broad
    application preload and into a read-only versioned status host. The host
    rejects malformed modes, counters, and unbounded device, connection, audit,
    or address collections before renderer delivery; legacy remote mutations
    remain explicitly separate until their server-backed UI replacement is
    complete (`scripts/task19-remote-access-status-host.test.mjs`).
  - [x] Move the preload-owned server connection lifecycle and framed transport
    supplier off the broad application API and into one frozen versioned
    server-connection host. It validates bounded server identities, connection
    labels, listeners, and 16 MiB non-empty frames before the explicit
    renderer-entry compatibility hand-off. Renderer handshake and required
    activity, agent-status, and workspace projection setup now fail closed on
    bounded deadlines and close the partial client instead of leaving the
    workspace indefinitely connecting
    (`scripts/task19-server-frame-capability.test.mjs`,
    `scripts/task19-server-connection-lifecycle-capability.test.mjs`,
    `scripts/server-port-transport.test.mjs`).
  - [x] Remove the unused Electron terminal-activity event supplier rather than
    creating another narrow compatibility host. Renderer activity and agent
    status now arrive through the canonical connection-owned server clients,
    and neither the broad preload nor `TerminayApi` exposes
    `onTerminalActivity`
    (`scripts/task19-terminal-activity-preload-removal.test.mjs`).
  - [x] Move the complete file-viewer compatibility supplier off the broad
    application preload and into a dedicated frozen host. The renderer-entry
    one-shot hand-off now receives only its enumerated file operations, and the
    host rejects malformed or unbounded watch events before delivery
    (`scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Move the complete terminal-settings compatibility supplier off the
    broad application preload and into a frozen versioned host. Its one-shot
    renderer-entry capture receives only settings read/update/reset and a
    validated, immutable, size-bounded change envelope
    (`scripts/task19-settings-capability-snapshot.test.mjs`).
  - [x] Move the complete macro-settings and secrets compatibility supplier off
    the broad application preload and into a frozen versioned host. Its
    one-shot renderer-entry capture receives only the enumerated operations and
    a validated immutable macro-change collection bounded by count and encoded
    size (`scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Move the legacy AI-metadata compatibility supplier off the broad
    application preload and into a frozen versioned host. The host accepts only
    the exact provider/target/model/context request and bounds serialized
    context before the existing one-shot adapter hand-off
    (`scripts/task19-ai-metadata-compatibility-authority.test.mjs`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Move edit-window state/result, Quick Push plan/apply, and remote
    pairing-PIN operations off the broad application preload and into three
    frozen versioned hosts. All three now use explicitly injected named hosts
    at their renderer composition boundaries. Their seven operations are
    absent from public `TerminayApi`
    (`scripts/task19-edit-window-capability.test.mjs`,
    `scripts/task19-quick-push-capability.test.mjs`,
    `scripts/task19-remote-pairing-pin-capability.test.mjs`).
  - [x] Remove zero-consumer file-viewer, terminal-settings, and macro/secret
    compatibility operations from the publicly exposed preload object. Their
    internal functions remain reachable only through the dedicated frozen
    hosts; public file-viewer, settings, and macro interface declarations are
    removed. After the final folder-panel migration, directory listing,
    folder-size cancellation, and directory watch operations also leave the
    broad runtime and interface while remaining on their dedicated hosts.
    The final zero-consumer native operations are likewise retained only by
    named hosts, allowing the empty broad `terminay` global and `TerminayApi`
    marker to be removed completely
    (`scripts/task19-public-preload-residual.test.mjs`).
  - [x] Require each remaining recordings and AI metadata compatibility adapter
    to receive its narrow host capability explicitly.
    None can silently capture the broad preload object merely because a new
    renderer imports it; the named legacy callers remain visible until final
    parity permits their removal
    (`scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Require the remaining settings and file-viewer compatibility adapters
    to receive their narrow host capability explicitly. Neither adapter can
    silently capture `window.terminay`; only their named Desktop compatibility
    callers supply it (`scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Snapshot the named settings host operations into an immutable
    compatibility capability before constructing `SettingsClient`. The adapter
    no longer retains the broad preload object or observes later replacement
    of a host method (`src/services/settings/legacySettingsCapability.ts`,
    `scripts/task19-settings-capability-snapshot.test.mjs`).
  - [x] Move the legacy file-viewer gateway's broad-preload acquisition to the
    named renderer-entry compatibility boundary. `RendererEntry` captures the
    enumerated file-viewer capability and injects isolated file/folder
    compatibility instances through `DisconnectedFileCompatibilityProvider`,
    so importing a file-viewer component cannot silently acquire
    `window.terminay` (`src/services/fileViewer/terminayFileGateway.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Snapshot the named file-viewer host operations into an immutable
    compatibility capability before constructing each provider-owned gateway.
    The gateway no longer retains the broad preload object or observes later
    replacement of a host method (`src/services/fileViewer/terminayFileGateway.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Remove the file-viewer renderer-global registry. Each renderer tree
    owns an explicitly injected frozen compatibility provider, so a later
    renderer path cannot overwrite another tree's gateway or mutation-revision
    authority (`src/services/fileViewer/DisconnectedFileCompatibilityProvider.tsx`,
    `scripts/task19-file-viewer-capability.test.mjs`).
  - [x] Remove the unused renderer `app:open-macros` preload IPC capability.
    Native menu ownership remains in the Desktop main host, but no renderer can
    retain that obsolete privileged window-opening path
    (`scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Snapshot the named recordings and AI-metadata host operations before
    constructing their legacy compatibility clients. Those adapters retain only
    frozen operation wrappers, not the broad preload object supplied at the
    explicit Desktop hand-off (`src/services/recordings/legacyRecordingsClient.ts`,
    `src/services/ai/legacyAiTabMetadataClient.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Snapshot the named macro-settings read and change-notification
    operations before the legacy macro hook subscribes. The hook retains only
    frozen wrappers rather than the broad preload object, so later host-method
    replacement cannot create a second renderer authority
    (`src/services/macros/legacyMacroSettingsCapability.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Require the legacy macro hook's narrow host capability at each named
    renderer hand-off. `useMacroSettings` no longer defaults to
    `window.terminay`, so importing the hook cannot silently acquire ambient
    preload authority (`src/hooks/useMacroSettings.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Move macro-settings compatibility acquisition to the renderer
    composition root. All macro consumers read the frozen named capability
    through `LegacyMacroSettingsProvider`, so none can pass or retain
    `window.terminay` directly
    (`src/services/macros/legacyMacroSettingsCapability.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Move the legacy macro editor's secrets and macro-mutation operations to
    the same frozen named macro capability. `MacrosWindow` no longer acquires
    the broad preload object for those compatibility operations, so importing
    the editor cannot retain a second ambient renderer authority
    (`src/components/MacrosWindow.tsx`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Move legacy terminal-settings acquisition to the renderer composition
    root. `useTerminalSettings` now obtains only an injected client from
    `TerminalSettingsClientProvider` and fails closed outside that provider,
    so importing the hook cannot silently acquire `window.terminay`
    (`src/services/settings/legacySettingsCapability.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Inject the recordings and AI-metadata named hosts directly at their
    composition callers. Both
    adapters receive frozen, enumerated capabilities, so importing either
    adapter cannot silently acquire `window.terminay`
    (`src/services/recordings/legacyRecordingsClient.ts`,
    `src/services/ai/legacyAiTabMetadataClient.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`).
  - [x] Remove the macro-settings renderer-global registry and compatibility
    hand-off. `RendererEntry` constructs one frozen eight-operation capability,
    injects it through `LegacyMacroSettingsProvider`, and passes the same
    capability into the server-mirroring client. Provider consumers preserve
    explicit override semantics without ambient acquisition
    (`src/hooks/useMacroSettings.ts`, `src/rendererRuntime.tsx`,
    `src/services/macros/legacyMacroSettingsCapability.ts`,
    `scripts/task19-renderer-capability-one-shot.test.mjs`).
  - [x] Remove the terminal-settings renderer-global registry and compatibility
    hand-off. `RendererEntry` constructs one frozen legacy settings client and
    injects it through `TerminalSettingsClientProvider`; shared routes and
    standalone windows consume that client explicitly, while server-backed
    clients receive the same device client for coordinated dual-authority
    mutations (`src/hooks/useTerminalSettings.ts`, `src/rendererRuntime.tsx`,
    `src/services/settings/legacySettingsCapability.ts`,
    `scripts/task19-settings-capability-snapshot.test.mjs`).
  - [x] Route remote-access pairing-mode changes through the injected terminal
    settings client. `useRemoteAccessController` no longer acquires the named
    Desktop settings host directly; the frozen provider client remains the one
    renderer settings authority for this mutation
    (`src/workspace/useRemoteAccessController.ts`,
    `scripts/task14-settings-client-path.test.mjs`).
  - [x] Inject the named remote-access status client into the workspace
    controller. `useRemoteAccessController` no longer acquires that Desktop
    host ambiently; `App` owns the explicit composition hand-off and the
    controller retains only the four status operations it uses
    (`src/workspace/useRemoteAccessController.ts`,
    `scripts/task19-remote-access-status-host.test.mjs`).
  - [x] Inject the same bounded remote-access status client into the standalone
    Settings window through `ServerSettingsRoute`. The settings feature no
    longer acquires that Desktop host ambiently, while JSON-only browser
    settings routes remain host-free
    (`src/components/SettingsWindow.tsx`,
    `src/shared/ServerWorkspaceSurface.tsx`,
    `scripts/task19-remote-access-status-host.test.mjs`).
  - [x] Remove the recordings renderer-global registry and compatibility
    hand-off. `App` and the standalone Recordings window pass the exact named
    `terminayRecordingServiceHost` directly to the validating adapter, which
    retains only a frozen snapshot of its eight operations
    (`src/services/recordings/legacyRecordingsClient.ts`,
    `src/App.tsx`, `src/components/RecordingsWindow.tsx`,
    `scripts/task19-renderer-capability-one-shot.test.mjs`).
  - [x] Remove the AI-metadata renderer-global registry and compatibility
    hand-off. `App` and the standalone Settings window pass the exact named
    `terminayAiMetadataHost` directly to the validating request/response
    adapter; the old compatibility global name and rendererCompatibility edge
    are absent (`src/services/ai/legacyAiTabMetadataClient.ts`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`,
    `scripts/task19-hidden-compatibility-imports.test.mjs`).
  - [x] Remove the auxiliary Desktop edit-tab registry and renderer-global
    compatibility hand-off. `ServerEditWindowRoute` receives the exact
    two-operation `terminayEditWindowHost` at the renderer route boundary and
    injects it into `EditTabWindow`; the wrapper has no ambient preload access.
    The legacy module, compatibility global name, and both hidden import edges
    are absent (`scripts/task19-edit-window-capability.test.mjs`,
    `scripts/task19-hidden-compatibility-imports.test.mjs`).
  - [x] Remove the transitional Desktop Quick Push wrapper and renderer-global
    compatibility hand-off. The composition root injects the frozen two-method
    `terminayQuickPushHost` directly through `App` and `ProjectWorkspace` into
    the modal; the modal has no ambient preload access, and the legacy module
    and both hidden compatibility import edges are absent
    (`scripts/task19-quick-push-capability.test.mjs`,
    `scripts/task19-hidden-compatibility-imports.test.mjs`).
  - [x] Remove the server-frame renderer-global registry and compatibility
    hand-off. The renderer composition root injects a frozen two-operation
    snapshot of `terminayServerConnectionHost` through the connection factory
    into its fixed-server transport; the transport has no ambient host access
    (`src/shared/legacyServerFrameCapability.ts`,
    `src/shared/rendererServerClient.ts`, `src/rendererRuntime.tsx`,
    `scripts/task19-server-frame-capability.test.mjs`).
  - [x] Remove the server-connection lifecycle renderer-global registry and
    compatibility hand-off. The renderer composition root injects the exact
    `terminayServerConnectionHost` directly into a frozen two-operation
    adapter, retaining only connection subscription and requested rehydration
    (`src/shared/legacyServerConnectionLifecycleCapability.ts`,
    `src/rendererRuntime.tsx`,
    `scripts/task19-server-connection-lifecycle-capability.test.mjs`).
  - [x] Remove the transitional remote pairing-PIN registry and renderer-global
    compatibility hand-off. The helper now requires the exact two-operation
    `RemotePairingPinClient`; the main remote controller and standalone
    Settings window inject the frozen `terminayRemotePairingPinHost` directly.
    The legacy module, compatibility global name, and both hidden import edges
    are absent (`scripts/task19-remote-pairing-pin-capability.test.mjs`,
    `scripts/task19-hidden-compatibility-imports.test.mjs`).
  - [x] Re-audit every remaining production `window.terminay*Host` call in
    `src/App.tsx`, `src/rendererRuntime.tsx`, `src/workspace/**`, and
    `src/components/**`. Classify each one as server data/query/command
    authority to move to the `TerminayClient` protocol, native presentation
    capability to keep as a narrow host bridge, or disconnected/local
    compatibility fallback to delete after parity. Current audit:
    `terminayConnectionHost`, `terminayHost`,
    `terminayServerConnectionHost`, `terminayFileViewerCompatibilityHost`,
    `terminayFileExplorerHost`, `terminayTerminalSettingsCompatibilityHost`,
    `terminayMacroSettingsCompatibilityHost`, `terminayRecordingServiceHost`,
    `terminayAiMetadataHost`, and `terminayDictationHost` still include
    connected/Desktop data, query, command, or compatibility authority and are
    covered by the migration checkboxes below. `terminayClipboardHost`,
    `terminayRevealHost`, `terminayExternalHost`, `terminayAppCommandHost`,
    `terminayUpdateHost`, `terminayWindowLifecycleHost`,
    `terminayProjectTabHost`, `terminayWorkspaceTransferHost`,
    `terminayTerminalPresentationHost`, `terminaySettingsWindowHost`,
    `terminayRemotePairingPinHost`, `terminayRemoteAccessStatusHost`,
    `terminayEditWindowHost`, `terminayQuickPushHost`, and
    `terminayMcpInstallHost` are native presentation or explicitly versioned
    Desktop capability bridges to keep narrow unless a later data-authority
    audit proves otherwise. Evidence: an `rg` audit of
    `window\\.terminay[A-Za-z0-9]*Host` across `src/App.tsx`,
    `src/rendererRuntime.tsx`, `src/workspace`, and `src/components`, plus
    `src/rendererRuntime.tsx`, `src/App.tsx`, and the boundary tests named in
    the following cleanup items.
  - [x] Move Electron file explorer and Git fallback data reads/mutations off
    `terminayFileExplorerHost` and `terminayGitWorktreeHost` and onto
    server-owned `FileViewerClient`/`TerminayGitClient` operations. Native
    reveal/copy actions may remain narrow host capabilities, but path-based
    file, status, worktree, pull, move, and remove authority must not come
    from renderer preload hosts in connected Desktop. Evidence:
    `src/workspace/useFileExplorerController.ts` performs folder list/create,
    rename, delete, and search through `FileViewerClient` and status,
    worktree, pull, move, and remove through `TerminayGitClient`;
    `src/App.tsx` injects the server file/Git clients from
    `terminalClientContext`; `scripts/git-worktree-host-bridge.test.mjs`
    proves `terminayGitWorktreeHost` is absent from app, preload, and
    declarations; `scripts/file-explorer-git-status-stability.test.mjs` proves
    connected Git loading uses the server Git client.
  - [x] Remove the disconnected file-viewer compatibility gateway and legacy
    file-viewer transport from the normal connected Desktop path. Sparse save,
    metadata, diff, preview, directory task, and watcher state should be
    server-client protocol operations or explicit disconnected-only surfaces.
    Evidence: `src/App.tsx` now creates the disconnected file client only when
    no server connection context exists; `src/components/file-viewer/FilePanel.tsx`
    gates the disconnected panel compatibility on `terminalClientContext === null`,
    omits `compatibilityGateway` from connected `createServerFileGateway`, and
    fails sparse-save revision lookup closed in connected mode; and
    `src/components/folder-viewer/FolderPanel.tsx` gates its disconnected file
    client the same way. Covered by `scripts/file-viewer-shared-client.test.mjs`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`,
    `scripts/task19-file-viewer-capability.test.mjs`,
    `scripts/folder-tasks-server-client.test.mjs`, and
    `scripts/task16-connected-folder-panel-capability.test.mjs`.
  - [ ] Move legacy settings, macro, recordings, AI metadata, and dictation
    data paths out of Electron preload compatibility clients and into
    server-owned protocol clients for connected Desktop. Settings-window
    launch/focus and microphone permission may remain native host actions, but
    model metadata, secrets, transcription, recordings state, macro
    persistence, and terminal setting persistence should be server-owned.
  - [ ] Replace `legacyFallback` in `src/rendererRuntime.tsx` and
    `ResponsiveWorkspaceEntry` with the extracted shared route tree. Web and
    Electron now both enter `ConnectedRendererWorkspace -> App`; the remaining
    cleanup is the route-marker/fallback wrapper itself, so production Electron
    should no longer wrap connected workspace features as a legacy body.
  - [ ] Split the remaining native presentation actions into explicit
    versioned host capabilities with no durable project data authority:
    clipboard, reveal, external URL, app/menu commands, terminal presentation
    zoom/size, project tab drag/popout, workspace transfer, window lifecycle,
    and native dialogs. Add boundary tests proving these bridges cannot list,
    read, write, or mutate project/server data except by dispatching typed
    server-client commands.
  - [ ] Remove terminal/server-frame compatibility bootstrap from normal
    Electron startup after the shared framed client is the only connection
    path. Keep any recovery or historical harnesses outside the production
    module graph with exact allowlist coverage.
  - [x] Tighten boundary tests for the one-server-model baseline, hidden
    compatibility imports, preload compatibility boundary, and renderer
    preload boundary so any new connected-renderer import or call of a
    legacy/preload data host fails. Allow only named native presentation
    capabilities and explicit disconnected-mode compatibility. Evidence:
    `scripts/one-server-model-boundary.test.mjs`,
    `scripts/task19-hidden-compatibility-imports.test.mjs`,
    `scripts/task19-preload-compatibility-boundary.test.mjs`, and
    `scripts/task19-public-preload-residual.test.mjs`.
  - [ ] Add acceptance coverage proving both web and Electron production
    clients load project, file, Git, settings, recordings, macro, and
    dictation data through the same server-owned clients. In Electron test
    mode, remove or poison preload compatibility data hosts and verify the
    connected UI still works.
- [x] Verify feature specifications remain present-tense product contracts;
  migration-progress qualifiers were removed from the recording and
  server-runtime compatibility contracts; progress remains in this task
  (`scripts/task19-20-audit.test.mjs`).

External integration follow-up (not a project checkbox): update the
authenticated browser peer owner in the sibling `terminay.com` project to
install a ticket-bound `getChannel` bridge for four distinct
control/application/terminal/assets lanes, then run the isolated secure-Werift
hosted proof. This repository rejects swapped or aliased lanes and contains no
terminal-protocol fallback; the sibling peer's private channel ownership is
outside this worktree, so no external proof is claimed here.

## Acceptance checks

- A supported Desktop profile migrates settings, macros, secrets, remote trust,
  profiles, and recordings without plaintext leakage or data loss.
- Interrupted import resumes or rolls back from a tested backup.
- Existing session origins reconnect or receive one explicit repair path.
- Local Desktop, three remote Desktop windows, wide web, and mobile web pass
  the feature parity matrix.
- Old duplicate application/remote authorities are absent from production.

## Definition of done

Existing users have a tested recoverable migration, the full product passes
through the server architecture, and no transitional implementation remains as
a second authority.
