## 1. Node WebRTC host

- [x] 1.1 Provide a privileged standalone-server loader/factory for the optional headless WebRTC runtime and map its established binary channels into the server-core transport contract, verified by the shared headless transport suite.
- [x] 1.2 Complete Terminay-repository peer creation, signaling, and production runtime integration for the selected headless implementation, verified end to end by `scripts/production-headless-webrtc-secure-werift.test.mjs` covering fragment-only enrollment, PIN/device authentication, signed offer/answer/ICE, terminal I/O, persisted non-extractable device key and reconnect grant, fresh-tab PIN-free reconnect, signed reconnect signaling, and revocation.
- [x] 1.3 Verify the configured selected secure-Werift artifact before Desktop exposure starts or allocates a hosted room, so a missing, malformed, or integrity-invalid selection fails closed with no pairing handoff, URL, room registration, or signaling allocation, verified by `scripts/task17-desktop-server-exposure.test.mjs`.
- [x] 1.4 Carry the injected headless host's immutable selected-runtime identity through server-owned admission instead of hardcoding `node-datachannel`, and reject a mismatched runtime label before signaling or native allocation, verified by `apps/terminay-server/test/server-remote-exposure.test.mjs`.
- [x] 1.5 Keep initial pairing, room rotation, and reconnect challenge/proof material server-owned, origin-bound, single-use, expiring, and revocable, verified by the pairing and reconnect suites.
- [x] 1.6 Port signed offer/answer/ICE, STUN/TURN configuration, cleanup, and production observability through the selected runtime adapter, verified by `scripts/production-headless-webrtc-secure-werift.test.mjs` and `scripts/production-webrtc-turn-routes.test.mjs` selecting both a nominated direct pair and authenticated TURN-only relay pairs.
- [x] 1.7 Tag aggregate headless host snapshots and cleanup reports with the closed selected-runtime identity and expose transport-neutral `headlessRateLimitWindows`/`headlessRuntime` fields while keeping the old counter as an exact alias, verified by `apps/terminay-server/test/remote-audit-security.test.mjs` proving the metadata allowlist retains no device, ticket, signaling, credential, SDP, or application data.
- [x] 1.8 Measure TURN-provider lifecycle through security-safe aggregate counters — configurations, relay-capable configurations, credential requests and failures, current and peak in-flight requests — releasing the in-flight count on completion, validation failure, revocation, and shutdown, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 1.9 Remove the hidden Electron WebRTC host dependency after parity, so Desktop main no longer loads the legacy service, creates a hidden `BrowserWindow`, accepts the legacy activation flag, registers a host sender, or exposes `remote-webrtc-host:*` IPC, verified by `scripts/task17-legacy-electron-webrtc-lazy-load.test.mjs`, `scripts/task17-desktop-host-sender-boundary.test.mjs`, `scripts/task19-webrtc-host-isolation.test.mjs`, and `scripts/trusted-ipc-sender.test.mjs`.
- [x] 1.10 Bound peers, channels, queued signaling, transfer sizes, and timeouts, and reject an invalid injected native-peer role before peer construction or authenticated relay subscription, verified by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.

## 2. Full application transport

- [x] 2.1 Carry connection control, application commands and events, terminal streams, and assets/binary content on isolated channels with backpressure, verified by the channel transport suite.
- [x] 2.2 Discard queued application frames and reset inbound-byte accounting when a channel closes or fails, and report zero outbound queued bytes rather than a stale native buffered counter, verified by `packages/server-core/src/remote/channelTransport.ts` coverage and `scripts/task17-desktop-webrtc-transport.test.mjs`.
- [x] 2.3 Complete the application handshake and authentication only after device key and PIN/approval verification, verified by `packages/server-core/test/remote-application.test.mjs`.
- [x] 2.4 Resume workspace revision and terminal positions on reconnect, verified by the server-core conformance suite comparing handshake/resume responses with canonical revisions, stale-window snapshots, and project-scoped terminal positions.
- [x] 2.5 Reject commands received before authentication, after revocation, with stale connection identity, or from another server or session origin, verified by the remote application suite.
- [x] 2.6 Preserve the transport-neutral four-channel, limit, cleanup, and admission contract across every injected headless runtime label, verified by the shared server-core conformance suite.
- [x] 2.7 Compare Local and remote clients through one end-to-end protocol suite, verified by that suite passing on both transports.

## 3. Desktop connection parity

- [x] 3.1 Extract the browser device-registration transaction into a transport-neutral pairing flow with injected device-key and credential-store adapters that runs `/api/pairing/start` then `/api/pairing/complete`, rejects a reconnect grant for another origin before persisting anything, and persists device and grant in one transaction, verified by `scripts/device-pairing-flow.test.mjs`.
- [x] 3.2 Make Remote Access bootstrap parsing transport-neutral and fragment-only, reading no browser location state and accepting no pairing credentials in query parameters, verified by `scripts/pairing-bootstrap.test.mjs` and `scripts/remote-connection-url.test.mjs`.
- [x] 3.3 Provide the Desktop main-process secure-store adapter that commits the opaque private-key handle, device record, and optional origin-matched reconnect grant as one encrypted replacement without a renderer or preload credential surface, verified by `scripts/desktop-device-credential-store.test.mjs`.
- [x] 3.4 Route a fragment-only Remote Access URL from the Desktop connection menu through the canonical pairing transaction, with the six-digit PIN crossing a narrow versioned host bridge only for that invocation, verified by `scripts/desktop-device-pairing.test.mjs`.
- [x] 3.5 Bound each Desktop pairing request to a 15-second timeout with no credential persisted after timeout, and reject non-origin, credentialed, and non-loopback HTTP pairing URLs plus expired or malformed expiries before creating a device key, verified by `scripts/desktop-device-pairing.test.mjs`.
- [x] 3.6 Add a main-process-only reconnect transport that exchanges the protected grant through `/protocol/reconnect/challenge` then `/protocol/reconnect/complete`, keeps grant and private key in the credential store, supplies only the short-lived ticket onward, and bounds the exchange including response body consumption, verified by `scripts/desktop-reconnect-transport.test.mjs`.
- [x] 3.7 Chain successful Desktop pairing directly into the protected reconnect exchange and framed application transport so there is no paired-without-workspace state and the renderer receives neither grant nor ticket, verified by `scripts/task17-desktop-paired-workspace.test.mjs`.
- [x] 3.8 Provide a privileged Desktop native WebRTC offerer that requires all four isolated traffic lanes and exposes the application lane through the canonical bounded `ByteTransport`, keeping native and signaling authority outside the renderer, verified by `scripts/task17-desktop-webrtc-transport.test.mjs`.
- [x] 3.9 Define and fail-closed parse the versioned authenticated signaling bootstrap binding server/device/peer identity, exact session origin, WSS route, short-lived token, role, expiry, and bounded STUN/TURN configuration, rejecting incompatible versions, cross-origin routes, URL credentials, query secrets, unknown fields, and overlong TURN credentials before native allocation, verified by `scripts/task17-desktop-signaling-bootstrap.test.mjs`.
- [x] 3.10 Consume that bootstrap through the four-lane offerer without silently downgrading to HTTP, revalidating origin, version, role, expiry, and identities before allocation, bounding socket opening, authenticating exact signal envelopes with bounded replay rejection, and closing the unused HTTP ticket transport on both success and failure, verified by `scripts/task17-desktop-webrtc-bootstrap.test.mjs` and `scripts/task17-desktop-paired-workspace.test.mjs`.
- [x] 3.11 Align the Desktop bootstrap and the server upgrade boundary with the sibling relay's canonical same-origin `/signal` endpoint, rejecting the obsolete `/signaling` spelling before socket or runtime allocation, verified by `apps/terminay-server/test/signaling-host-boundary.test.mjs`.
- [x] 3.12 Define the server-side hosted registration boundary requiring the registrar rather than Terminay to mint the credential, with the shared parser binding origin, identities, expiry, canonical route, and ICE credentials to the admitted reconnect, verified by `apps/terminay-server/test/hosted-signaling-registrar.test.mjs`.
- [x] 3.13 Route Desktop connection-menu exposure status, start/stop, rotation, device revocation, and peer close through the same server-owned `ServerRemoteExposure` lifecycle used by standalone, projecting presentation fields only, verified by `scripts/task17-desktop-server-exposure.test.mjs`.
- [x] 3.14 Select Desktop device pairing by explicit PIN-field presence and reject blank or malformed PINs instead of downgrading to the direct application-token handoff, verified by `scripts/task17-desktop-connection-intent.test.mjs`.

## 4. Exposure lifecycle

- [x] 4.1 Move start/stop, pairing-room rotation, device and grant stores, audit, connections, and status into Terminay Server, verified by the server-core and Terminay Server exposure suites.
- [x] 4.2 Keep Embedded Local loopback-only until an explicit **Expose this server…**, verified by exposure fixtures.
- [x] 4.3 Let the standalone CLI generate and rotate pairing material and report status, verified by the CLI exposure tests.
- [x] 4.4 Ensure stopping exposure does not stop Local or standalone server work or disconnect existing local clients, verified by exposure fixtures.
- [x] 4.5 Define reconnect availability while exposed and accurate offline state when not advertising, verified by authenticated lease refresh and expired/offline reporting fixtures.
- [x] 4.6 Fence an authenticated headless negotiation when exposure stops without disconnecting established remote sessions, so a late runtime result closes its channel allocation and cannot publish, verified by `packages/server-core/test/remote-exposure.test.mjs`.

## 5. Server bundle delivery

- [x] 5.1 Deliver the complete responsive bundle manifest and assets with current hash, path, and size verification and versioned cache paths, verified by `packages/server-core/test/ui-bundle.test.mjs`.
- [x] 5.2 Launch direct and embedded server UI modes on the exact isolated session origin, verified by the bundle launch tests.
- [x] 5.3 Preserve old compatible bundles until a new install commits and never launch a partial update, verified by `packages/server-core/test/ui-bundle-store.test.mjs`.
- [x] 5.4 Bound each remote bundle asset read, preserve the previously committed bundle when a transfer stalls, and reject symlink-replaced manifests or assets, cross-origin executable references in the verified HTML entry, non-HTML or malformed-UTF-8 entries, and substituted hashes beneath another bundle identity, verified by `packages/server-core/test/ui-bundle-store.test.mjs` and `packages/server-core/test/ui-bundle.test.mjs`.

## 6. Hosted-service coordination

- [x] 6.1 Keep server-owned remote audit retention and sinks metadata-only with closed action and reason allowlists and arbitrary payload fields dropped, verified by `apps/terminay-server/test/remote-audit-security.test.mjs`.
- [x] 6.2 Audit the sibling hosted relay read-only and freeze the exact local integration delta without claiming deployment, verified by `apps/terminay-server/REMOTE-TRANSPORT-BLOCKER.md` and `scripts/task17-hosted-signaling-registration.test.mjs`.
- [x] 6.3 Preserve manager and session host separation and reject signaling upgrades on manager-only, mismatched, and unsafe collapsed-origin routes, admitting only the exact isolated session origin and `/signal` endpoint, verified by `apps/terminay-server/test/signaling-host-boundary.test.mjs`.
- [x] 6.4 Accept static STUN discovery endpoints only and take per-admitted-peer TURN credentials from an injected provider that receives connection identity only and must expire within ten minutes, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 6.5 Abort a stalled TURN credential request and a stalled authenticated signaling-factory request on shutdown or device revocation before signaling or native peer allocation, and close a connected device's signaling subscription during revocation even when a faulty binding omits every close callback, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 6.6 Keep Desktop's hosted registration payload derived-only and reject a non-canonical compact secret before opening a signaling socket, emitting exactly one `room-complete` on admitted join or expiry, verified by `scripts/task17-hosted-signaling-registration.test.mjs`.
- [x] 6.7 Verify hosted storage and logs never contain application data or auth secrets, verified by `apps/terminay-server/test/remote-audit-security.test.mjs` and the Task 17 hosted redaction evidence.

## 7. Rate limits, cleanup, and metrics

- [x] 7.1 Rate-limit repeated authenticated WebRTC setup attempts per device before server-core admission, signaling subscription, optional native-module load, or peer allocation, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 7.2 Keep global pending-capacity rejection separate from per-device retry accounting, and do not consume a device's limiter window for an already-aborted caller, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 7.3 Prune expired per-device setup-rate-limit metadata during host cleanup and status inspection, clear a revoked device's metadata immediately, and include that cleanup in the server-owned exposure cleanup timer and manual report, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs` and `apps/terminay-server/test/server-remote-exposure.test.mjs`.
- [x] 7.4 Bound authenticated relay-subscription cleanup so a stalled external relay `close()` cannot delay peer cleanup, module cleanup, or shutdown while its eventual completion remains observed, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 7.5 Reject unknown reconnect handles before reserving the bounded reconnect retry ledger, retain a known grant's retry window until its proof verifies, and release pending challenges immediately when a grant is revoked or superseded by rotation, verified by `apps/terminay-server/test/server-remote-exposure.test.mjs` and `packages/server-core/test/remote-reconnect.test.mjs`.
- [x] 7.6 Validate persisted reconnect-grant and host-registration state record by record at load time so malformed or duplicated entries are discarded without preventing a valid grant from restoring, verified by `scripts/reconnect-grant-store.test.mjs`.
- [x] 7.7 Keep aggregate setup-duration measurements finite under an extreme injected clock delta, keep retained and sinked audit timestamps finite, non-negative, and non-decreasing under clock regression, and keep pairing, revocation, and cleanup reliable when a metadata-only audit sink is unavailable, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs` and `apps/terminay-server/test/remote-audit-security.test.mjs`.
- [x] 7.8 Retain a revoked peer's terminal state for immediate status reporting but prune terminal peer records before a later independent admission, verified by `packages/server-core/test/remote-transport.test.mjs`.
- [x] 7.9 Keep hosted-facing metrics and cleanup reports aggregate-only after a credential-bearing native setup failure, reporting expired limiter metadata only as a reclaimed count, verified by `apps/terminay-server/test/remote-audit-security.test.mjs`.
- [x] 7.10 Bind the deterministic secure-Werift candidate archive to a detached Ed25519 release-signing hook whose verifier checks exact basename, SHA-256, and key signature without contaminating reproducible SBOM, provenance, or source-correspondence payloads, verified by `scripts/secure-werift-release-contract.test.mjs` and the secure-Werift production spike evidence.

## 8. Native and transport fail-closed hardening

- [x] 8.1 Reject malformed runtime device identities before creating a rate-limit key, pending-cancellation entry, signaling subscription, or native peer, verified by `apps/terminay-server/test/node-datachannel-host.test.mjs`.
- [x] 8.2 Reject malformed, oversized, or blank native-generated and authenticated remote SDP and ICE, and reject locally generated SDP whose type conflicts with the server-owned offerer/answerer role, before signing, relay delivery, or native peer delivery, verified by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
- [x] 8.3 Bound native-generated signing and relay delivery, including each individual operation after setup, and bound each asynchronous signaling verification, failing the peer closed and releasing its signaling subscription instead of retaining an unbounded queue, verified by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
- [x] 8.4 Defer authenticated ICE until the remote SDP is accepted, bound the pre-description candidate queue, and bound distinct remote candidates and the replay-detection set for the peer lifetime with fail-closed overflow, verified by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
- [x] 8.5 Fail closed on unknown native peer lifecycle states, throwing open-state inspection, malformed offerer-created channels, synchronous closes during listener installation, malformed unsubscribe handles, throwing lifecycle-listener registration, and any required traffic lane closing after setup, verified by `apps/terminay-server/test/node-datachannel-peer.test.mjs`.
- [x] 8.6 Reject oversized native data-channel frames, invalid or throwing buffered-byte counters, inbound frames after the channel leaves the open state, rejected or throwing writes, throwing inbound-frame handlers, already-closed or late-resolving channel allocations, duplicate traffic labels, and channel sets differing from the authenticated requested contract, verified by `apps/terminay-server/test/node-datachannel-runtime.test.mjs`.
- [x] 8.7 Isolate lifecycle-observer, close, and label-lookup failures at the native boundary so they cannot escape into the runtime or prevent terminal transitions and listener cleanup, verified by `apps/terminay-server/test/node-datachannel-runtime.test.mjs`, `apps/terminay-server/test/node-datachannel-host.test.mjs`, and `packages/server-core/test/remote-channel-transport.test.mjs`.
- [x] 8.8 Reject a headless traffic channel that closes while server-core installs its session lifecycle listeners, and abort or release admitted-but-pending headless negotiations on device revocation or external cancellation so a late result cannot publish a session, verified by `packages/server-core/test/remote-headless.test.mjs`.
- [x] 8.9 Give each authenticated remote traffic channel exactly one protocol transport owner, so a second application transport cannot duplicate an ordered command frame and replacement requires a closed prior channel and a freshly admitted reconnect session, verified by `packages/server-core/test/remote-channel-transport.test.mjs`.
- [x] 8.10 Bound slow asset-channel backpressure waits and fail closed after the writable wait budget, verified by `packages/server-core/test/remote-channel-transport.test.mjs`.

## 9. Security and reliability tests

- [x] 9.1 Reject a replayed application ticket before device-key or approval verification via a bounded preflight assertion while retaining `admit` as the atomic consume, and reject cross-server and cross-origin application proofs before either verifier receives material, verified by `packages/server-core/test/remote-application.test.mjs`.
- [x] 9.2 Fail closed if the pairing clock becomes invalid after a room is issued, if the server-core remote runtime clock becomes invalid, or if the pairing entropy source repeats an active room id or secret, verified by `packages/server-core/test/remote-pairing.test.mjs` and `packages/server-core/test/remote-disconnect-storm.test.mjs`.
- [x] 9.3 Reject ambiguous or control-bearing fragment pairing frames and non-canonical or ambiguous signaling `Host` framing before a pairing request or session relay can be issued, verified by `scripts/pairing-bootstrap.test.mjs` and `apps/terminay-server/test/signaling-host-boundary.test.mjs`.
- [x] 9.4 Derive pairing admission rate-limit buckets only from server-owned room identity so a client-supplied field cannot evade the bounded one-time pairing window, verified by `apps/terminay-server/test/server-remote-exposure.test.mjs`.
- [x] 9.5 Consume a reconnect challenge when the injected device-proof verifier throws so a verifier outage cannot pin the bounded challenge ledger, verified by `packages/server-core/test/remote-reconnect.test.mjs`.
- [x] 9.6 Reject cross-server authenticated signaling and replayed remote descriptions in the Desktop native offerer, and fail the Desktop application lane closed with its three sibling lanes when a slow native channel exceeds its backpressure budget, verified by `scripts/task17-desktop-webrtc-transport.test.mjs`.
- [x] 9.7 Prove deterministic multi-session disconnect and revocation cleanup, channel teardown, peer removal, and post-revocation admission rejection, verified by `packages/server-core/test/remote-disconnect-storm.test.mjs`.
- [x] 9.8 Add a deterministic local browser-lifecycle simulation for visibility-hidden, pagehide, freeze, network interruption, resume, reconnect failure, and revocation-before-resume, verified by `apps/terminay-web/test/simulated-browser-lifecycle.test.mjs`.
- [x] 9.9 Run the broad locally deterministic full-application framed suite over Local and isolated headless-channel transports covering workspace and project identity, terminal create/IO/resize/detach/reattach/reconnect ownership, files, Git, agents, binary bodies, cancellation, and composition cleanup, with an explicit recorded skip for the blocked native prebuild, verified by the Task 17 local end-to-end evidence and `scripts/task17-native-runtime-availability.test.mjs`.
- [x] 9.10 Fail Desktop WebRTC exposure before publishing a pairing URL or allocating a hosted signaling room when the build has no selected, packaged server-owned WebRTC peer runtime, keeping status stopped with one actionable error and creating no pairing secret, room, socket, device, grant, or ticket, verified by `scripts/task17-desktop-server-exposure.test.mjs` and `e2e/webrtc-pairing-reconnect.spec.ts`.
- [x] 9.11 Make the disposable hosted-service PostgreSQL lifecycle fail-safe for real browser end-to-end attempts by labelling only harness-owned containers, reaping only those labelled orphans, and cleaning up when startup fails, verified by `e2e/support/hosted-server.ts`.

## Operational follow-ups (not checkboxes)

These remained open at the time this change closed and are external to Terminay's project
code.

Update the sibling hosted service for any new channel, control, and `web.terminay.com`
host-shell requirements without adding application-data visibility.

After the selected production WebRTC runtime is packaged and the hosted service emits the
compatible Desktop signaling bootstrap, extend real pairing and reconnect end-to-end coverage
through full workspace snapshot, terminal creation, file read and conflict save, agent events,
settings, reconnect and resume, revocation, and exposure stop. Deterministic Local and
headless application conformance and the runtime-unavailable pre-allocation failure path are
already covered above; neither substitutes for real hosted or native proof.

Test replay, cross-origin, and cross-server frames, invalid bundles, slow asset channels,
disconnect storms, background mobile reconnect, and TURN-required networks on real
infrastructure.
