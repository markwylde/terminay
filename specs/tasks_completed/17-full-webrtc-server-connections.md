# Full WebRTC server connections

Status: project-code implementation complete. Hosted deployment and
environment-dependent validation remain documented below as non-checkbox
operational follow-ups.

## Goal

Extend the existing secure WebRTC pairing/reconnect and asset delivery system
from terminal-only remote control to the complete Terminay application protocol
hosted by standalone or Embedded Terminay Server.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Remote access](../features/remote-access.md)

## Why this is active

The current remote service lives in Electron, delegates peer connections to a
hidden BrowserWindow, and exposes only list/attach/write/resize terminal
messages. The hosted `terminay.com` service already provides origin isolation,
signed signaling, reconnect, and verified server-supplied assets that should be
preserved rather than replaced.

## Dependencies

- [Server architecture decision spikes](../tasks_completed/3-server-architecture-decision-spikes.md)
- [Standalone and embedded server runtime](../tasks_completed/6-standalone-and-embedded-server-runtime.md)
- [Shared responsive server UI](./16-shared-responsive-server-ui.md)

## Work slices

### Node WebRTC host

- [x] Provide a privileged standalone-server loader/factory for the optional
  `node-datachannel` runtime and map its established binary channels into the
  server-core transport contract.
- [x] Complete Terminay-repository peer creation/signaling and production
  runtime integration for the selected headless WebRTC implementation. The
  deterministic secure-Werift artifact passes the isolated native-Chromium
  legacy bootstrap/terminal compatibility proof
  end to end: fragment-only enrollment, PIN/device authentication, signed
  offer/answer/ICE, terminal I/O, persisted nonextractable device key and
  reconnect grant, fresh-tab PIN-free reconnect, signed reconnect signaling,
  and revocation all pass in
  `scripts/production-headless-webrtc-secure-werift.test.mjs`. Secure-Werift is
  the formally selected runtime and release packaging stages its governed
  artifact. Production Desktop activation fails closed until its authenticated
  hosted signaling registrar is available; that deployment dependency is the
  explicit operational follow-up below rather than incomplete Terminay runtime
  code.
  - [x] Verify the configured selected secure-Werift artifact before Desktop
    exposure starts or allocates a hosted room. A missing, malformed, or
    integrity-invalid packaged selection now fails closed with no pairing
    handoff, pairing URL, room registration, or authenticated signaling
    allocation; lazy peer creation cannot defer this release-integrity failure
    until after publication. Coverage:
    `electron/remote/serverOwnedExposure.ts` and
    `scripts/task17-desktop-server-exposure.test.mjs`.
  - [x] Carry the injected headless host's immutable selected-runtime identity
    through server-owned admission instead of hardcoding
    `node-datachannel`. A verified Werift host can now establish an
    authenticated session through `ServerRemoteExposure`, and the resulting
    session identifies `werift` while the aggregate host counters record the
    successful connection; a mismatched runtime label remains rejected before
    signaling/native allocation. Coverage:
    `apps/terminay-server/src/remote/nodeDataChannelHost.ts`,
    `apps/terminay-server/src/remote/serverExposure.ts`, and
    `apps/terminay-server/test/server-remote-exposure.test.mjs`.
- [x] Keep initial pairing, room rotation, and reconnect challenge/proof
  material server-owned, origin-bound, single-use, expiring, and revocable.
- [x] Port signed offer/answer/ICE, STUN/TURN configuration, cleanup, and
  production observability through the selected runtime adapter. The formally
  selected secure-Werift artifact passes native Chromium signed
  offer/answer/ICE, disconnect/reconnect cleanup, and revocation; the isolated
  production route proof selects both a nominated direct pair and authenticated
  TURN-only relay/relay pairs. Server-owned provider cancellation, peer
  teardown, runtime-tagged cleanup, and credential-free aggregate metrics pass
  the focused host/exposure/audit suite. Evidence:
  `scripts/production-headless-webrtc-secure-werift.test.mjs`,
  `scripts/production-webrtc-turn-routes.test.mjs`, and the checked bounded
  children below.
  - [x] Tag aggregate headless host snapshots and cleanup reports with the
    closed selected-runtime identity, and expose transport-neutral
    `headlessRateLimitWindows`/`headlessRuntime` cleanup fields. Werift is no
    longer misreported through the legacy node-datachannel-only cleanup name;
    the old counter remains an exact compatibility alias. The metadata
    allowlist proves these surfaces retain no device, ticket, signaling,
    credential, SDP, or application data. This does not prove a production
    TURN-required route. Coverage:
    `apps/terminay-server/src/remote/nodeDataChannelHost.ts`,
    `apps/terminay-server/src/remote/serverExposure.ts`,
    `apps/terminay-server/test/server-remote-exposure.test.mjs`, and
    `apps/terminay-server/test/remote-audit-security.test.mjs`.
  - [x] Measure TURN-provider lifecycle through security-safe aggregate
    selected-host counters: total ICE configurations, relay-capable
    configurations, credential requests/failures, and current/peak in-flight
    requests. Provider completion, validation failure, revocation, and shutdown
    all release the in-flight count; a stalled provider abort is recorded
    before signaling or native peer allocation. These counters report only that
    ephemeral relay configuration was available, not that a TURN candidate
    route was selected. Coverage:
    `apps/terminay-server/src/remote/nodeDataChannelHost.ts`,
    `apps/terminay-server/test/node-datachannel-host.test.mjs`, and
    `apps/terminay-server/test/remote-audit-security.test.mjs`.
- [x] Remove the hidden Electron WebRTC host dependency after parity.
  Desktop main no longer imports or dynamically loads `RemoteAccessService`,
  creates a hidden BrowserWindow, accepts the legacy activation flag, registers
  a host sender, or exposes `remote-webrtc-host:*` IPC. Preload no longer
  publishes `terminayWebRtcHost`, and the renderer has no `webrtc-host` route or
  React host component. The browser-host protocol harness used by isolated
  direct/TURN interoperability tests lives under `scripts/support` and is not a
  production renderer entry. Production Remote Access remains server-owned and
  fails closed before exposure when authenticated hosted signaling is
  unavailable. Coverage:
  `scripts/task17-legacy-electron-webrtc-lazy-load.test.mjs`,
  `scripts/task17-desktop-host-sender-boundary.test.mjs`,
  `scripts/task19-webrtc-host-isolation.test.mjs`, and
  `scripts/trusted-ipc-sender.test.mjs`.
- [x] Bound peers, channels, queued signaling, transfer sizes, and timeouts.
  - [x] Reject an invalid injected native-peer role before peer construction or
    authenticated relay subscription. An unchecked JavaScript caller cannot
    silently fall through to answerer behavior and create a role-confused
    session. Coverage: `apps/terminay-server/test/node-datachannel-peer.test.mjs`.

### Full application transport

- [x] Carry connection/control, application commands/events, terminal streams,
  and assets/binary content on isolated channels with backpressure.
  - [x] Discard queued application frames and reset inbound-byte accounting
    when a channel closes or fails, so a stalled consumer cannot retain its
    bounded queue or replay stale frames after teardown. Terminal transport
    states also report zero outbound queued bytes instead of retaining a stale
    native buffered counter in diagnostics. Coverage:
    `packages/server-core/src/remote/channelTransport.ts` and
    `scripts/task17-desktop-webrtc-transport.test.mjs`.
- [x] Complete application handshake/auth only after device key and PIN/approval
  verification.
- [x] Resume workspace revision and terminal positions on reconnect.
- [x] Reject commands received before auth, after revoke, with stale connection
  identity, or from another server/session origin.
- [x] Preserve the transport-neutral four-channel, limit, cleanup, and
  admission contract across every injected headless runtime label through the
  shared server-core conformance suite.
- [x] Compare remote handshake/resume responses with canonical server-owned
  workspace revisions, stale-window snapshots, and project-scoped terminal
  positions in the server-core conformance suite.
- [x] Compare Local and remote clients through one end-to-end protocol suite.
- [x] Complete Terminay-repository Desktop Remote Access connection parity with
  browser clients. The selected runtime is packaged; the Desktop menu uses the
  shared device-pairing transaction,
  main-process secure credential store, protected reconnect exchange, strict
  signaling-bootstrap parser, authenticated four-channel WebRTC coordinator,
  shared workspace client, and no-downgrade failure policy. Builds without a
  verified runtime or authenticated registrar fail before exposure or
  hosted-room allocation and publish no pairing URL. Browser Chromium and
  selected-runtime direct/TURN proofs cover the local end-to-end transport.
  Deployed hosted bootstrap emission and production Desktop activation are the
  explicit external follow-up below.
  - [x] Extract the browser device-registration transaction from the
    terminal-only React route into a transport-neutral pairing flow with
    injected device-key and credential-store adapters. It executes the
    canonical `/api/pairing/start` then `/api/pairing/complete` exchange and
    rejects a reconnect grant for another origin before persisting any pairing
    material, then persists the device and optional reconnect grant in one
    IndexedDB transaction. The browser supplies its existing WebCrypto/IndexedDB adapters;
    Desktop can now supply its privileged secure-store adapter without
    duplicating protocol semantics. Evidence:
    `src/remote/services/devicePairingFlow.ts` and
    `scripts/device-pairing-flow.test.mjs`.
  - [x] Make Remote Access bootstrap parsing transport-neutral and
    fragment-only. The parser no longer reads browser location state or accepts
    pairing credentials in query parameters; the browser host consumes and
    scrubs the fragment before normal navigation, and Electron's legacy
    pairing generator/parser now uses the identical fragment-only contract.
    Evidence: `src/remote/services/pairing.ts`, `src/remote/main.tsx`,
    `electron/remote/pairing.ts`, `electron/remote/connectionUrl.ts`,
    `scripts/pairing-bootstrap.test.mjs`, and
    `scripts/remote-connection-url.test.mjs`.
  - [x] Extract the device-registration transaction from the browser's legacy
    terminal UI. `establishDevicePairing` accepts only injected API, key, and
    credential-store adapters, validates the exact origin on returned reconnect
    grants, and persists nothing on a mismatched origin. Evidence:
    `src/remote/services/devicePairingFlow.ts` and
    `scripts/device-pairing-flow.test.mjs`. This is an extraction seam for the
    future Desktop secure-store adapter, not the completed Desktop pairing UI.
  - [x] Provide the Desktop main-process secure-store adapter for that same
    transaction. `DesktopDeviceCredentialStore.saveEstablishedPairing` now
    commits the opaque private-key handle, device record, and optional
    origin-matched reconnect grant as one encrypted replacement, without a
    renderer/preload credential surface. Coverage:
    `scripts/desktop-device-credential-store.test.mjs`.
  - [x] Route a fragment-only Remote Access URL from the Desktop connection
    menu through the canonical `/api/pairing/start` then
    `/api/pairing/complete` transaction. The six-digit PIN crosses a narrow
    versioned host bridge only for that invocation; the main process creates
    the key and persists the paired device/reconnect grant in
    `DesktopDeviceCredentialStore`, without exposing either secret to the
    renderer. This establishes device credentials while deliberately leaving
    the full Desktop WebRTC workspace-transport gate open. Coverage:
    `electron/remote/desktopPairing.ts` and
    `scripts/desktop-device-pairing.test.mjs`.
  - [x] Bound each Desktop `/api/pairing/start` and `/api/pairing/complete`
    request to a 15-second timeout. A stalled or non-responsive server now
    aborts the request and returns a concrete error to the connection dialog;
    no credential record is persisted after timeout. Coverage:
    `scripts/desktop-device-pairing.test.mjs`.
  - [x] Reject non-origin, credentialed, and non-loopback HTTP Desktop pairing
    URLs before creating a device key or making a request. Desktop accepts only
    an exact HTTPS or loopback-HTTP server origin with fragment-only pairing
    material, preventing the clipboard input from becoming an arbitrary
    privileged POST target. Coverage: `scripts/desktop-device-pairing.test.mjs`.
  - [x] Reject an expired or malformed Desktop pairing expiry before issuing a
    privileged request, so a stale clipboard URL cannot consume its one-time
    token or create an orphaned device key. Coverage:
    `scripts/desktop-device-pairing.test.mjs`.
  - [x] Add a main-process-only reconnect transport slice for an already
    paired Desktop device. It exchanges the protected grant through the
    canonical `/protocol/reconnect/challenge` then
    `/protocol/reconnect/complete` flow, keeps the durable grant and private
    key in `DesktopDeviceCredentialStore`, and supplies only the resulting
    short-lived ticket to the shared HTTP protocol transport. Coverage:
    `electron/remote/desktopReconnect.ts`,
    `scripts/desktop-reconnect-transport.test.mjs`, and
    `scripts/desktop-device-credential-store.test.mjs`.
  - [x] Bound the complete Desktop reconnect HTTP exchange, including response
    body consumption after headers arrive. A server that stalls either JSON
    body is aborted at the configured deadline rather than pinning a Desktop
    reconnect attempt indefinitely. Coverage:
    `scripts/desktop-reconnect-transport.test.mjs`.
  - [x] Chain successful Desktop device pairing directly into the protected
    reconnect exchange and framed full-application transport. The connection
    menu no longer stops in a false paired-without-workspace state, and the
    renderer receives neither the reconnect grant nor the short-lived ticket.
    This completes the server-owned HTTP application path while the production
    Desktop WebRTC client/runtime parity gate remains open. Coverage:
    `electron/main.ts`, `scripts/desktop-reconnect-transport.test.mjs`, and
    `scripts/task17-desktop-paired-workspace.test.mjs`.
  - [x] Provide a privileged Desktop native WebRTC offerer that loads the same
    optional `node-datachannel` runtime, requires all four isolated traffic
    lanes, and exposes the application lane through the canonical bounded
    `ByteTransport`. Native/runtime and signaling authority remain outside the
    renderer. Hosted reconnect bootstrap wiring remains open. Coverage:
    `electron/remote/desktopWebRtcTransport.ts` and
    `scripts/task17-desktop-webrtc-transport.test.mjs`.
  - [x] Define and fail-closed parse the versioned authenticated signaling
    bootstrap needed to wire that offerer to hosted reconnect. The contract
    binds server/device/peer identity, exact session origin, WSS signaling
    route, short-lived auth token, role, expiry, and bounded STUN/TURN
    configuration; incompatible versions, cross-origin routes, URL credentials,
    query secrets, unknown fields, and overlong TURN credentials are rejected
    before native allocation. Reconnect completion may carry this parsed
    optional contract without claiming the sibling service emits it. Coverage:
    `electron/remote/desktopSignalingBootstrap.ts` and
    `scripts/task17-desktop-signaling-bootstrap.test.mjs`.
  - [x] Consume a supplied Desktop reconnect signaling bootstrap through the
    privileged four-lane WebRTC offerer without silently downgrading to HTTP.
    The coordinator revalidates the exact origin, version, role, expiry, and
    identities before socket/runtime allocation; bounds socket opening before
    native allocation; authenticates exact per-signal envelope shapes with
    bounded replay rejection; closes signaling with the application transport;
    and closes the unused HTTP ticket transport on both WebRTC success and
    failure. Coverage: `electron/remote/desktopWebRtcBootstrap.ts`,
    `electron/main.ts`, `scripts/task17-desktop-webrtc-bootstrap.test.mjs`, and
    `scripts/task17-desktop-paired-workspace.test.mjs`.
  - [x] Align Desktop's fail-closed signaling bootstrap and the server upgrade
    boundary with the sibling hosted relay's canonical same-origin `/signal`
    endpoint. The obsolete `/signaling` spelling is rejected before socket or
    runtime allocation, preventing a locally valid bootstrap from failing
    against the deployed relay contract. Coverage:
    `electron/remote/desktopSignalingBootstrap.ts`,
    `apps/terminay-server/src/remote/signalingHostBoundary.ts`,
    `scripts/task17-desktop-signaling-bootstrap.test.mjs`, and
    `apps/terminay-server/test/signaling-host-boundary.test.mjs`.
  - [x] Define the server-side hosted registration boundary required before
    reconnect completion may expose a Desktop WebRTC bootstrap. The registrar,
    rather than Terminay, must mint the credential; the shared protocol parser
    then binds the returned origin, server/device/peer identities, expiry,
    canonical `/signal` route, and ICE credentials to the admitted reconnect.
    Cancellation and every mismatch fail before a bootstrap is returned.
    Coverage: `packages/protocol/src/signalingBootstrap.ts`,
    `apps/terminay-server/src/remote/hostedSignalingRegistrar.ts`, and
    `apps/terminay-server/test/hosted-signaling-registrar.test.mjs`.
  - [x] Route Desktop connection-menu exposure status, start/stop, rotation,
    device revocation, and peer close through the same server-owned
    `ServerRemoteExposure` lifecycle used by standalone. The Desktop adapter
    projects presentation fields only and never reconstructs pairing secrets
    from status metadata. Coverage:
    `electron/remote/serverOwnedExposure.ts` and
    `scripts/task17-desktop-server-exposure.test.mjs`.
  - [x] Select Desktop device pairing by explicit PIN-field presence and reject
    blank or malformed PINs instead of silently downgrading the request to the
    direct application-token handoff. Coverage:
    `electron/remote/desktopConnectionIntent.ts` and
    `scripts/task17-desktop-connection-intent.test.mjs`.

### Exposure lifecycle

- [x] Move start/stop, pairing-room rotation, device/grant stores, audit,
  connections, and status into Terminay Server.
- [x] Keep Embedded Local loopback-only until explicit **Expose this server…**.
- [x] Let standalone CLI generate/rotate pairing material and report status.
- [x] Ensure stopping exposure does not stop Local/standalone server work or
  existing local clients.
- [x] Define reconnect availability while exposed and accurate offline state
  when not advertising. Runtime and server-core exposure fixtures verify
  authenticated lease refresh, expired/offline reporting, and that stopping
  exposure preserves existing local work while rejecting new peers.
  - [x] Fence an authenticated headless negotiation when exposure stops without
    disconnecting established remote sessions. A late runtime result closes its
    complete channel allocation and cannot publish after the exposure is
    disabled. Coverage: `packages/server-core/test/remote-exposure.test.mjs`.

### Server bundle delivery

- [x] Deliver the complete responsive bundle manifest/assets with current
  hash/path/size verification and versioned cache paths.
- [x] Launch direct and embedded server UI modes on the exact isolated session
  origin.
- [x] Preserve old compatible bundles until a new install commits; never launch
  a partial update.

### Hosted-service coordination

- [x] Keep server-owned remote audit retention and sinks metadata-only: audit
  actions/reasons use closed allowlists and arbitrary payload fields are
  dropped. `RemoteAuditLog` and `remote-audit-security.test.mjs` prove that
  credentials and application data do not cross this boundary.
**Operational follow-up (non-checkbox):** Update the sibling hosted service for
any new channel/control and
  `web.terminay.com` host-shell requirements without adding application-data
  visibility.
  - [x] Audit the sibling hosted relay read-only and freeze the exact local
    integration delta without claiming it is deployed. The sibling currently
    exposes isolated-origin `WSS /signal`, but its compact pairing relay uses
    room-scoped nested browser RTC frames and has no endpoint that mints the
    server/device/peer/origin-bound `DesktopSignalingBootstrap`. Production
    therefore requires an externally credentialed per-peer stream whose flat
    SDP/ICE envelopes match `NodeDataChannelSignaling`; the existing room-only
    registrar remains structurally ineligible for secure-Werift composition.
    Coverage: `apps/terminay-server/REMOTE-TRANSPORT-BLOCKER.md` and
    `scripts/task17-hosted-signaling-registration.test.mjs`.
- [x] Preserve manager/session host separation and reject signaling upgrades on
  manager-only hosts. `acceptSessionSignalingUpgrade` admits only the exact
  isolated session-origin host and `/signal` WebSocket endpoint, rejecting
  manager, mismatched, and unsafe collapsed-origin routing before a relay can
  allocate a signaling connection. Coverage:
  `apps/terminay-server/test/signaling-host-boundary.test.mjs`.
- [x] Add TURN credential integration only with short-lived unrelated secrets.
  `NodeDataChannelHeadlessHost` accepts static STUN discovery endpoints only;
  per-admitted-peer TURN credentials come from an injected provider that receives
  connection identity only and must expire within ten minutes. Coverage:
  `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Abort a stalled TURN credential request on server shutdown or device
    revocation before it can allocate signaling or a native peer. Coverage:
    `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Abort a stalled authenticated signaling-factory request on device
    revocation before it can allocate a native peer. Coverage:
    `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Close a connected device's authenticated signaling subscription during
    revocation even when a faulty native data-channel binding omits every close
    callback. Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] Update redaction, rate limits, metrics, cleanup, and deployment tests.
  - [x] Rate-limit repeated authenticated WebRTC setup attempts per device before
    server-core admission, signaling subscription, optional native-module load,
    or peer allocation. This complements the pairing/reconnect HTTP limits and
    prevents an otherwise-valid proof from creating an unbounded native setup
    storm. Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Keep global pending-capacity rejection separate from per-device WebRTC
    retry accounting. A setup denied because another connection occupies the
    bounded host slot does not consume that device's limiter window before any
    manager admission, signaling subscription, or native allocation. Coverage:
    `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Reject an already-aborted caller setup before it consumes a device
    WebRTC retry window, reserves pending capacity, subscribes to signaling, or
    loads a native peer. A subsequent live request for that device remains
    admissible. Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Prune expired per-device WebRTC setup-rate-limit metadata during host
    cleanup and status inspection, so an idle standalone or Embedded host does
    not retain stale admission windows until another connection arrives.
    Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Clear a revoked device's native WebRTC setup-rate-limit metadata
    immediately. Revocation is terminal for that identity, so its opaque retry
    window does not remain resident until expiry after its relay and peer are
    torn down. Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Bound authenticated relay-subscription cleanup. A stalled external
    relay `close()` cannot delay explicit peer cleanup, module cleanup, or
    server shutdown indefinitely; its eventual completion remains observed.
    Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Include node-datachannel authenticated-setup rate-limit cleanup in the
    server-owned exposure cleanup timer/manual report. This prevents an idle
    standalone or Embedded server from retaining native admission metadata
    merely because no caller directly inspects the optional runtime host.
    Coverage: `apps/terminay-server/test/server-remote-exposure.test.mjs`.
  - [x] Reject malformed runtime device identities before they can create a
    WebRTC rate-limit key, pending-cancellation entry, signaling subscription,
    or native peer. `NodeDataChannelHeadlessHost` leaves complete proof
    authority to `RemoteConnectionManager`, but validates the one
    device-scoped field it owns before allocating host lifecycle metadata.
    Coverage: `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Reject malformed or oversized native-generated SDP/ICE before it can
    cross the signing or relay boundary. The node-datachannel peer adapter
    applies the same bounded signal validation to local native callbacks as to
    authenticated inbound signaling, failing closed and releasing the peer and
    signaling subscription. Coverage:
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Bound native-generated SDP/ICE callbacks awaiting asynchronous signing
    and relay delivery. The node-datachannel peer adapter serializes the
    outbound work and fails closed before a faulty native runtime can retain an
    unbounded signer or relay queue; coverage:
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
    - [x] Bound each individual native-generated signing and relay-delivery
      operation after setup as well. A stalled first signer or relay send now
      times out, closes the established peer, and releases its signaling
      subscription rather than retaining the serialized queue indefinitely.
      Coverage: `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Bound each asynchronous authenticated signaling verification operation.
    A stalled verifier now fails the peer closed and releases its signaling
    subscription rather than permanently occupying the bounded inbound queue;
    coverage: `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Keep aggregate WebRTC setup-duration measurements finite when an
    injected runtime clock produces an extreme finite delta, so metadata-only
    status output cannot be poisoned with `Infinity`. Coverage:
    `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Reject an unknown reconnect handle before reserving the bounded
    server-side reconnect retry ledger. Arbitrary guessed handles therefore
    cannot exhaust admission capacity for a valid device reconnect; known
    grants remain rate-limited. Coverage:
    `apps/terminay-server/test/server-remote-exposure.test.mjs`.
  - [x] Retain a known reconnect grant's retry window until its proof verifies.
    Repeated challenge creation cannot fill the finite relay challenge capacity;
    a successful proof resets only that grant's limiter state. Coverage:
    `apps/terminay-server/test/server-remote-exposure.test.mjs`.
  - [x] Validate persisted reconnect-grant and host-registration state record by
    record at load time. Malformed, duplicated, or malformed-token entries are
    discarded without preventing a valid device reconnect grant from restoring;
    coverage: `scripts/reconnect-grant-store.test.mjs`.
  - [x] Keep retained and sinked remote-audit timestamps finite, non-negative,
    and non-decreasing when an injected runtime clock regresses or produces an
    invalid value. This prevents metadata-only relay observability from
    poisoning ordered metrics or JSON sinks. Coverage:
    `apps/terminay-server/test/remote-audit-security.test.mjs`.
  - [x] Keep pairing, reconnect-grant revocation, and cleanup reliable when a
    metadata-only remote-audit sink is unavailable. Sink failures are isolated
    after the bounded in-memory event is retained, so an observability outage
    cannot block remote lifecycle authority. Coverage:
    `apps/terminay-server/test/remote-audit-security.test.mjs`.
  - [x] Retain a revoked peer's terminal state for immediate status reporting,
    but prune terminal peer records before a later independent admission. A
    long-lived server cannot accumulate unbounded revoked-peer metadata across
    device reconnects. Coverage: `packages/server-core/test/remote-transport.test.mjs`.
  - [x] Keep hosted-facing WebRTC metrics and cleanup reports strictly
    aggregate-only after a credential-bearing native setup failure. Snapshot
    serialization excludes ticket, signaling, device, SDP, and application
    fields, while expired per-device limiter metadata is reported only as a
    reclaimed count. Coverage:
    `apps/terminay-server/test/remote-audit-security.test.mjs`.
  - [x] Bind the deterministic secure-Werift candidate archive to a detached
    Ed25519 release-signing hook whose verifier checks exact basename, SHA-256,
    and key signature without contaminating reproducible SBOM/provenance/source
    correspondence payloads. Coverage:
    `scripts/secure-werift-release-contract.test.mjs` and
    `specs/decisions/evidence/secure-werift-production-spike.md`.

### Security and reliability tests

**Operational follow-up (non-checkbox):** After the selected production WebRTC
runtime is packaged and the hosted
  service emits the compatible Desktop signaling bootstrap, extend real
  pairing/reconnect E2E through full workspace snapshot, terminal creation,
  file read/conflict save, agent events, settings, reconnect/resume, revocation,
  and exposure stop. Deterministic Local/headless application conformance and
  the runtime-unavailable pre-allocation failure path are already covered below;
  neither substitutes for this real hosted/native proof.
  The local Docker-to-client smoke harness passes the standalone CLI
  handoff/bootstrap, health, foreground-lifecycle, and client pairing-URL
  parsing checks. It does not exercise authenticated application transport or
  claim a real browser or hosted WebRTC pairing run
  (`scripts/docker-pairing-smoke.mjs`,
  `specs/decisions/evidence/docker-pairing-smoke.md`).
  The secure-Werift candidate additionally passes a real isolated Chromium
  enrollment, terminal traffic, saved-grant reconnect, and revocation run in
  `scripts/production-headless-webrtc-secure-werift.test.mjs`. That proof uses
  the legacy terminal compatibility service and a local disposable hosted
  relay; it does not cover the required selected/package runtime, production
  hosted Desktop bootstrap, or full workspace/files/agents/settings matrix.
  - [x] Make the disposable hosted-service PostgreSQL lifecycle fail-safe for
    real browser E2E attempts: label only harness-owned containers, reap only
    those labelled orphans before a new run, and clean up if startup fails
    before the hosted server is returned. This prevents timeout/setup failures
    from consuming container-runtime storage or poisoning subsequent evidence;
    it does not claim the real pairing/reconnect flow passed. Coverage:
    `e2e/support/hosted-server.ts` and
    `e2e/webrtc-pairing-reconnect.spec.ts`.
  - [x] Run the broad locally deterministic full-application framed suite over
    Local and isolated headless-channel transports, covering workspace/project
    identity, terminal create/I/O/resize/detach/reattach/reconnect ownership,
    files, Git, agents, binary bodies, cancellation, and composition cleanup.
    The native availability probe records an explicit skip because the audited
    `node-datachannel` published prebuild is intentionally blocked. The
    selected secure-Werift runtime separately passes the legacy
    bootstrap/terminal compatibility proof; it does not install the sibling
    peer owner's ticket-bound canonical four-channel application bridge. This
    local suite does not claim hosted-provider full-application E2E.
    Evidence:
    `specs/decisions/evidence/task17-full-application-local-e2e.md` and
    `scripts/task17-native-runtime-availability.test.mjs`.
  - [x] Fail Desktop WebRTC exposure before publishing a pairing URL or
    allocating a hosted signaling room when the build has no selected,
    packaged server-owned WebRTC peer runtime. Status remains stopped and
    projects one actionable runtime-unavailable error; no pairing secret,
    room, socket, device, grant, or application ticket is created. The
    integrity-pinned secure-Werift artifact is formally selected and staged by
    release packaging, but production Desktop activation remains fail-closed
    until the hosted service supplies authenticated per-peer signaling. The
    audited published `node-datachannel` prebuild remains blocked by its
    candidate-specific native supply-chain finding; therefore this does not
    complete the hosted workspace E2E follow-up. Coverage:
    `electron/remote/serverOwnedExposure.ts`,
    `scripts/task17-desktop-server-exposure.test.mjs`, and
    `e2e/webrtc-pairing-reconnect.spec.ts`.
**Operational follow-up (non-checkbox):** Test replay/cross-origin/cross-server
frames, invalid bundles, slow asset
  channels, disconnect storms, background mobile reconnect, and TURN-required
  networks.
	- [x] Add a deterministic local browser-lifecycle simulation for
	  visibility-hidden, pagehide, freeze, network interruption, resume,
	  reconnect failure, and revocation-before-resume. This harness exercises
	  browser connection-state policy only and does not claim physical mobile,
	  operating-system backgrounding, or real-network evidence. Coverage:
	  `apps/terminay-web/src/simulatedLifecycle.ts` and
	  `apps/terminay-web/test/simulated-browser-lifecycle.test.mjs`.
	- [x] Cover the locally deterministic negative protocol subset without
	  claiming browser, mobile-background, or TURN-network execution:
	  authenticated SDP and ICE replay closes the native peer; cross-server and
	  cross-origin application proofs fail before verifier/runtime allocation;
	  rejected cross-scope transport proofs do not poison the one-time ticket
	  ledger; and substituted bundle hashes cannot be installed beneath another
	  content-addressed bundle identity. Coverage:
	  `apps/terminay-server/test/node-datachannel-peer.test.mjs`,
	  `packages/server-core/test/remote-application.test.mjs`,
	  `packages/server-core/test/remote-transport.test.mjs`,
	  `packages/server-core/test/ui-bundle.test.mjs`, and
	  `scripts/task17-desktop-webrtc-transport.test.mjs`.
	- [x] Give each authenticated remote traffic channel exactly one protocol
	  transport owner. A second application transport cannot duplicate an ordered
	  command frame into another handler; replacement requires the prior channel
	  to close and a freshly admitted reconnect session. Coverage:
	  `packages/server-core/test/remote-channel-transport.test.mjs`.
	- [x] Fail closed if the server-owned pairing clock becomes invalid after a
	  room is issued. Active one-time rooms become terminal and cannot regain
	  usability if the clock later recovers; fresh material is required. Coverage:
	  `packages/server-core/test/remote-pairing.test.mjs`.
	- [x] Reject ambiguous or control-bearing fragment pairing frames before any
	  client can issue the one-time pairing request. The shared bootstrap parser
	  now requires exactly one bounded session ID, token, and expiry field, so
	  replay/cross-client first-versus-last-field parsing cannot redirect a
	  privileged pairing POST. Coverage: `scripts/pairing-bootstrap.test.mjs`.
	- [x] Reject non-canonical or ambiguous signaling `Host` framing before a
	  session relay is allocated. Whitespace-normalized, comma-separated, and
	  control-bearing host values cannot be coerced into the isolated session
	  origin. Coverage: `apps/terminay-server/test/signaling-host-boundary.test.mjs`.
	- [x] Fail closed if a pairing entropy source repeats an active room ID or
	  one-time secret. The server retries a bounded number of complete candidates
	  and never overwrites an active room; a persistent collision rejects the new
	  pairing while the existing secret remains usable. Coverage:
	  `packages/server-core/test/remote-pairing.test.mjs`.
	- [x] Derive pairing admission rate-limit buckets only from server-owned room
	  identity. A clipboard/client supplied field cannot select a different
	  limiter key for each wrong secret and evade the bounded one-time pairing
	  window. Coverage: `apps/terminay-server/test/server-remote-exposure.test.mjs`.
	- [x] Fail closed if the server-core remote runtime clock becomes invalid.
	  Exposure is disabled and new admission or traffic work is rejected, while
	  existing session metadata remains finite; recovery requires an explicit
	  fresh exposure. Coverage:
	  `packages/server-core/test/remote-disconnect-storm.test.mjs`.
	- [x] Consume a reconnect challenge if the injected device-proof verifier
	  throws. A verifier outage is not retryable as the same pending challenge,
	  so it cannot pin the bounded challenge ledger; a later fresh challenge can
	  proceed after recovery. Coverage:
	  `packages/server-core/test/remote-reconnect.test.mjs`.
	- [x] Fail closed when the optional native peer binding reports an unknown
	  lifecycle state. The node-datachannel peer adapter closes the native peer
	  and releases its authenticated signaling subscription instead of retaining
	  a relay for a state it cannot safely interpret; covered by
	  `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
	- [x] Reject cross-server authenticated signaling and replayed remote
	  descriptions in the privileged Desktop native offerer before exposing the
	  framed application transport. Both cases close every allocated traffic
	  lane. Coverage:
	  `scripts/task17-desktop-webrtc-transport.test.mjs`.
	- [x] Fail the Desktop application lane closed when a slow native channel
	  remains above its bounded backpressure budget, and close the three sibling
	  lanes with it. Coverage:
	  `scripts/task17-desktop-webrtc-transport.test.mjs`.
	- [x] Bound each remote UI-bundle asset read and preserve the previously
	  committed verified bundle when a transfer stalls. Coverage:
	  `packages/server-core/test/ui-bundle-store.test.mjs`.
	- [x] Reject a bundle whose verified HTML entry references cross-origin
	  executable code, preserving the prior committed bundle and pointer.
	  Coverage: `packages/server-core/test/ui-bundle-store.test.mjs`.
	- [x] Stop native callback registration as soon as a native binding
	  synchronously reports a terminal peer state during setup. The adapter does
	  not register later callbacks or allocate data channels after the peer has
	  failed closed; covered by
	  `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
	- [x] Reject an injected signaling relay that returns a malformed unsubscribe
	  handle during authenticated peer setup. The adapter closes the native peer
	  before any traffic-lane listener or channel allocation can occur, so a
	  relay that cannot be released cannot leave an authenticated session live;
	  covered by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
	- [x] Reject a committed UI bundle whose manifest or declared asset has been
	  replaced by a filesystem symlink. The server verifies only regular files
	  within the content-addressed namespace, fails closed before serving an
	  outside file, and retains the prior committed pointer. Coverage:
	  `packages/server-core/test/ui-bundle-store.test.mjs`.
	- [x] Reject an invalid server-bundled session entry before it can launch on
	  an isolated remote origin. The manifest requires its entry asset to be an
	  HTML document, and verification normalizes malformed UTF-8 entry bytes to
	  a closed integrity failure rather than leaving a host with a partial UI.
	  Coverage: `packages/server-core/test/ui-bundle.test.mjs`.
  - [x] Reject a replayed application ticket before either device-key or
    approval verification. `RemoteConnectionManager` performs a bounded
    preflight assertion while retaining `admit` as the atomic ticket consume,
    so an already-used ticket cannot consume cryptographic verifier capacity
    and concurrent handshakes still cannot both connect. Coverage:
    `packages/server-core/test/remote-application.test.mjs`.
  - [x] Reject cross-server and cross-origin application proofs before either
    verifier receives device or approval material, so a frame for another
    Terminay Server cannot consume verifier capacity or create a peer. Covered
    by `packages/server-core/test/remote-application.test.mjs`.
  - [x] Bound slow asset-channel backpressure waits: `HeadlessChannelTransport`
    fails closed after its writable wait budget; covered by
    `packages/server-core/test/remote-channel-transport.test.mjs`.
  - [x] Fail closed when a headless relay's native buffered-byte counter throws,
    is non-finite, negative, or exceeds the bounded transport range. Status
    inspection returns a safe value only after teardown, and flow control
    receives the concrete failure rather than retaining an authenticated relay.
    Coverage: `packages/server-core/test/remote-channel-transport.test.mjs`.
  - [x] Prove deterministic multi-session disconnect/revocation cleanup,
    channel teardown, peer removal, and post-revocation admission rejection in
    `packages/server-core/test/remote-disconnect-storm.test.mjs`; this does not
    claim browser, hosted, mobile-background, or TURN-network execution.
  - [x] Defer authenticated ICE until the authenticated remote SDP is accepted
    and bound the pre-description candidate queue in the node-datachannel peer
    adapter. `apps/terminay-server/test/node-datachannel-peer.test.mjs` proves
    ordered delivery and fail-closed overflow handling.
  - [x] Bound distinct authenticated remote ICE candidates for the complete
    peer lifetime, including candidates received after SDP acceptance. The
    node-datachannel peer adapter now bounds both native candidate work and
    its replay-detection set; overflow tears down the peer and signaling
    subscription. Coverage:
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Reject oversized native data-channel frames before copying them into
    the server-owned transport queue. The node-datachannel runtime checks the
    session frame limit at the native boundary and fails the channel closed;
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs` proves the
    peer and manager session are released.
  - [x] Fail closed when the native data-channel buffered-byte counter is
    negative, non-finite, unsafe, or throws. The runtime closes the channel
    before exposing an invalid counter to server-core, so the authenticated
    peer and manager session are released; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject an inbound native frame once its channel has transitioned out of
    the open state, even if the native close callback has not arrived yet. The
    node-datachannel adapter closes the channel and releases the authenticated
    peer before the frame can enter the server-owned transport queue; covered
    by `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Fail closed when a native data-channel write is rejected or throws. The
    node-datachannel runtime closes the channel and releases the authenticated
    peer immediately rather than retaining its relay subscription until a later
    native close callback; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Fail closed when the server-owned inbound-frame handler throws. The
    node-datachannel adapter contains that exception at the native callback
    boundary, closes the channel, and never lets an authenticated transport
    remain live after its frame consumer has rejected work; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject a native channel allocation that is already closed before
    authenticated session admission. The node-datachannel adapter closes every
    partially allocated native channel and publishes no peer to the manager;
    covered by `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject a native channel that closes between its initial admission probe
    and listener registration. The node-datachannel adapter closes the complete
    allocation and publishes no peer, preventing a time-of-check/time-of-use
    race from admitting a half-observed authenticated session; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Isolate server lifecycle-observer failures from native close callbacks.
    A throwing state observer cannot escape into node-datachannel or prevent
    the channel's closed transition and listener cleanup; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject native lifecycle-listener registration failures before
    authenticated admission. The node-datachannel adapter normalizes the native
    failure, closes the complete partial allocation, and publishes no peer to
    the manager; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Keep native close reporting idempotent across a lifecycle-registration
    failure. If a native binding synchronously reports a close and then throws
    from registration, the adapter records that terminal transition and closes
    every remaining partial allocation exactly once; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Isolate native close failures from explicit server-owned cleanup. A
    throwing node-datachannel `close()` call cannot escape the authenticated
    session shutdown path; the wrapped channel still publishes its terminal
    lifecycle states and clears listeners, covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject a native channel allocation reused across logical traffic labels
    before authenticated admission. Each control, application, terminal, and
    asset lane must own an isolated native channel; a duplicate allocation is
    closed exactly once and no peer is published, covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject an asynchronous native channel allocation that resolves after
    its authenticated setup has been aborted or revoked. The adapter closes
    every late native channel before admission and rethrows the cancellation;
    covered by `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Contain native data-channel callback validation failures at the peer
    boundary. A throwing native lifecycle-listener registration closes the
    callback channel, peer, and signaling subscription rather than escaping
    into node-datachannel; covered by
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Fail closed when native channel open-state inspection throws during
    authenticated setup. The peer opener contains the native failure, closes
    the peer, and releases its signaling subscription; covered by
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Fail closed when an offerer-created native channel is malformed before
    it can be tracked. The peer opener closes that untracked channel together
    with every partial allocation, peer, and signaling subscription rather than
    leaking a native channel or unhandled readiness rejection after a wrong-label
    admission failure; covered by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Stop offerer traffic-lane allocation when a native channel synchronously
    closes while its lifecycle listener is installed. The peer opener never
    creates later unowned lanes after fail-closed teardown begins; covered by
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Contain signaling-unsubscribe failures during native peer teardown. A
    throwing host cleanup callback cannot escape a node-datachannel state
    callback or prevent authenticated channels and the peer from closing;
    covered by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Fail closed when any required native traffic lane closes after setup.
    The peer opener tears down the complete authenticated channel allocation
    and signaling subscription rather than retaining a half-live
    control/application/terminal/assets contract; covered by
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Reject a native channel allocation whose traffic-lane set differs from
    the authenticated requested contract before adapting any lane. The
    node-datachannel runtime closes every allocated native channel rather than
    transiently admitting an unexpected control/application/terminal/assets
    lane; covered by `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Isolate host lifecycle-observer failures from authenticated setup and
    shutdown. A throwing metrics or audit observer cannot interrupt peer
    admission, session teardown, relay cleanup, or the terminal host state;
    covered by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
  - [x] Contain native channel-label lookup failures before authenticated
    admission. A throwing `getLabel()` is normalized at the node-datachannel
    boundary, closes the complete partial allocation exactly once, and never
    publishes a peer; covered by
    `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
  - [x] Reject a headless traffic channel that closes while server-core installs
    its authenticated session lifecycle listeners. The shared factory removes
    partial listeners, closes the complete allocation once, and never publishes
    the admitted peer; covered by
    `packages/server-core/test/remote-headless.test.mjs`.
  - [x] Isolate headless channel-transport state-observer failures from native
    close callbacks. A throwing diagnostics/UI observer cannot escape the
    authenticated transport lifecycle, hide its terminal state from later
    observers, or retain native listeners after close; covered by
    `packages/server-core/test/remote-channel-transport.test.mjs`.
	  - [x] Abort an in-flight authenticated headless negotiation when its device is
	    revoked. A late runtime result closes every traffic lane and cannot publish
	    a new session after server-core revocation; covered by
	    `packages/server-core/test/remote-headless.test.mjs`.
	  - [x] Release an admitted but still-pending headless negotiation from the
	    server manager synchronously during device revocation. A non-cooperative
	    runtime that never observes its abort signal cannot retain a revoked peer
	    in the manager snapshot or lifecycle capacity; a late result remains
	    fenced. Coverage: `packages/server-core/test/remote-headless.test.mjs`.
  - [x] Reject a native locally-generated SDP whose type conflicts with the
    server-owned offerer/answerer role before signing or relay delivery. The
    node-datachannel adapter closes the peer and releases its signaling
    subscription rather than publishing a role-confused authenticated offer or
    answer; covered by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Reject blank native-generated and authenticated remote SDP before it
    reaches the signer/relay or native peer. The node-datachannel adapter
    fails closed and releases its signaling subscription rather than letting an
    empty description cross the authenticated transport boundary; covered by
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
  - [x] Reject blank native-generated and authenticated remote ICE candidates
    before signing, relay delivery, or native peer delivery. The
    node-datachannel adapter treats whitespace-only candidate or media-id
    fields as malformed and releases the authenticated peer and signaling
    subscription; covered by
    `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
	- [x] Release pending reconnect challenges immediately when their grant is
	  revoked or superseded by rotation. Those challenges can no longer verify,
	  so they must not occupy bounded reconnect capacity until TTL expiry.
	  Coverage: `packages/server-core/test/remote-reconnect.test.mjs`.
	- [x] Abort an externally cancelled headless negotiation before a late runtime
	  result can publish its session. The server releases the admitted peer and
	  closes every late-returned traffic lane, so a client disconnect cannot leave
	  reconnect capacity or an unauthenticated native allocation behind. Coverage:
	  `packages/server-core/test/remote-headless.test.mjs`.
- [x] Verify hosted storage/logs never contain application data or auth secrets.
  - [x] `apps/terminay-server/test/remote-audit-security.test.mjs` serializes
    the `ServerRemoteExposure` audit sink and proves pairing/reconnect/device
    secrets and application payloads are absent from every persisted record.
    See [Task 17 hosted redaction evidence](../decisions/evidence/task17-hosted-redaction.md).
  - [x] Keep Desktop's hosted registration payload derived-only and reject a
    non-canonical compact secret before opening a signaling socket. Malformed
    and cross-room relay messages cannot complete a room; an admitted join or
    expiry emits one `room-complete`, closes the socket, and leaves no active
    registration. Coverage:
    `scripts/task17-hosted-signaling-registration.test.mjs`.

## Acceptance checks

- A displayless standalone server pairs and reconnects through production-like
  signaling and runs the full server-bundled UI.
- Remote and Local clients pass the same application protocol behaviour suite.
- Remote reconnect restores workspace revision and terminal output positions.
- Revocation immediately closes all device channels and rejects future proof.
- Hosted infrastructure can inspect neither terminal/project/file data nor
  device/PIN/reconnect secrets.

## Definition of done

Remote access is a full Terminay Server connection rather than a special
terminal viewer, with existing origin isolation and data-blind signaling
security preserved.
