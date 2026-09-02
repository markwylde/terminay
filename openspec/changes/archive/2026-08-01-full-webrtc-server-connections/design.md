## Context

See proposal.md for the motivation. Two constraints shaped everything here.

First, the hosted `terminay.com` service already provided origin isolation, signed
signaling, reconnect, and verified server-supplied assets. Those properties were to be
preserved rather than replaced.

Second, the headless WebRTC runtime was a supply-chain decision, not just a library choice.
The audited published `node-datachannel` prebuild was blocked by a candidate-specific native
supply-chain finding, so a Terminay-owned deterministic secure-Werift ESM artifact became the
selected runtime (ADR-0006). Release packaging stages that governed artifact and binds it to
a detached Ed25519 release-signing hook whose verifier checks exact basename, SHA-256, and
key signature without contaminating reproducible SBOM, provenance, or source-correspondence
payloads.

This change closed as **project-code complete**. Hosted deployment and
environment-dependent validation remained documented operational follow-ups rather than
unfinished Terminay code.

## Goals / Non-Goals

Goals:
- A displayless standalone server pairs, reconnects, and runs the full server-bundled UI.
- Remote and Local clients pass the same application protocol behaviour suite.
- Reconnect restores workspace revision and terminal output positions.
- Revocation immediately closes all device channels and rejects future proof.
- Hosted infrastructure can inspect neither terminal, project, or file data, nor device,
  PIN, or reconnect secrets.

Non-Goals:
- Deploying the sibling hosted service changes required for production Desktop activation.
- Claiming real mobile-background, physical-network, or TURN-required-network evidence from
  deterministic local suites.

## Decisions

- **Transport neutrality is the contract, not the runtime.** The four-channel, limit,
  cleanup, and admission contract is enforced through a shared server-core conformance suite
  that every injected headless runtime label must satisfy. Admission carries the injected
  host's immutable selected-runtime identity rather than hardcoding `node-datachannel`; a
  mismatched runtime label is rejected before signaling or native allocation.
- **Release integrity is verified before exposure, not lazily.** Desktop verifies the
  configured secure-Werift artifact before exposure starts or a hosted room is allocated. A
  missing, malformed, or integrity-invalid selection fails closed with no pairing handoff,
  pairing URL, room registration, or authenticated signaling allocation, so lazy peer
  creation cannot defer a release-integrity failure until after publication.
- **Fail closed at every native boundary.** The node-datachannel peer and runtime adapters
  treat the native binding as hostile input: malformed or oversized SDP and ICE, blank
  descriptions and candidates, role-conflicting local SDP, unknown lifecycle states, throwing
  label lookups, throwing buffered-byte counters, non-finite or negative counters, late or
  duplicate channel allocations, and channel sets that differ from the authenticated
  requested contract all close the peer and release its signaling subscription rather than
  admitting a half-observed session.
- **Every asynchronous step is bounded.** Signing, relay delivery, signaling verification,
  relay-subscription cleanup, TURN credential requests, asset reads, backpressure waits, and
  Desktop pairing and reconnect HTTP exchanges each have a deadline. A stalled dependency
  fails the peer closed instead of pinning capacity.
- **Rate limiting is derived from server-owned identity.** Pairing admission buckets derive
  only from server-owned room identity, so a clipboard-supplied field cannot select a
  different limiter key per wrong secret. Per-device WebRTC setup limits are separate from
  global pending-capacity rejection, are not consumed by an already-aborted caller, are
  pruned during cleanup and status inspection, and are cleared immediately on revocation.
- **Signaling is same-origin and canonical.** Only the exact isolated session origin and the
  `/signal` WebSocket endpoint may be upgraded; manager-only hosts, mismatched hosts,
  collapsed origins, and non-canonical or control-bearing `Host` framing are rejected before
  a relay is allocated. The obsolete `/signaling` spelling is rejected to match the deployed
  relay contract.
- **The registrar mints the credential, not Terminay.** The hosted registration boundary
  requires the registrar to mint the signaling credential; the shared protocol parser then
  binds the returned origin, server/device/peer identities, expiry, canonical `/signal`
  route, and ICE credentials to the admitted reconnect. Every mismatch and cancellation
  fails before a bootstrap is returned.
- **Pairing material is fragment-only and single-use.** The bootstrap parser reads no browser
  location state and accepts no pairing credentials in query parameters. It requires exactly
  one bounded session id, token, and expiry field, so first-versus-last-field parsing
  ambiguity cannot redirect a privileged pairing POST. Desktop accepts only an exact HTTPS or
  loopback-HTTP origin, and rejects credentialed URLs and expired or malformed expiries
  before creating a device key.
- **Desktop credentials never reach the renderer.** The device private key, reconnect grant,
  and short-lived ticket live in the main-process `DesktopDeviceCredentialStore`. The
  six-digit PIN crosses a narrow versioned host bridge only for the pairing invocation, and
  successful pairing chains directly into the protected reconnect exchange and framed
  application transport so there is no false paired-without-workspace state.
- **No silent downgrade.** The Desktop coordinator revalidates origin, version, role, expiry,
  and identities before socket or runtime allocation, authenticates exact per-signal envelope
  shapes with bounded replay rejection, closes signaling with the application transport, and
  closes the unused HTTP ticket transport on both WebRTC success and failure.
- **Observability is aggregate and metadata-only.** Audit actions and reasons use closed
  allowlists and arbitrary payload fields are dropped. Host snapshots and cleanup reports are
  tagged with the selected runtime identity and carry no device, ticket, signaling,
  credential, SDP, or application data; expired limiter metadata is reported only as a
  reclaimed count. TURN counters report that ephemeral relay configuration was available, not
  that a relay route was selected. Timestamps are kept finite, non-negative, and
  non-decreasing even when an injected clock regresses, and a failing audit sink cannot block
  pairing, revocation, or cleanup.
- **Clock and entropy faults are terminal.** If the pairing clock becomes invalid after a
  room is issued, active rooms become terminal and cannot regain usability if the clock
  recovers. If the server-core remote runtime clock becomes invalid, exposure is disabled and
  new admission or traffic work is rejected. If the pairing entropy source repeats an active
  room id or secret, the server retries a bounded number of complete candidates and never
  overwrites an active room.
- **One protocol transport owner per channel.** A second application transport cannot
  duplicate an ordered command frame into another handler; replacement requires the prior
  channel to close and a freshly admitted reconnect session. Queued application frames and
  inbound-byte accounting are discarded when a channel closes or fails.
- **Bundle installation is atomic and content-addressed.** Old compatible bundles are
  preserved until a new install commits, and a partial update never launches. Verification
  covers manifest and declared assets as regular files inside the content-addressed
  namespace, rejects symlink replacement, rejects a non-HTML or malformed-UTF-8 entry
  document, rejects an entry referencing cross-origin executable code, and rejects a
  substituted hash beneath another bundle identity; a stalled transfer preserves the prior
  committed pointer.

## Risks / Trade-offs

- **Production activation is gated on a sibling service.** A read-only audit of the hosted
  relay froze the exact integration delta: the sibling exposes isolated-origin `WSS /signal`,
  but its compact pairing relay uses room-scoped nested browser RTC frames and has no
  endpoint that mints the server/device/peer/origin-bound signaling bootstrap. Production
  therefore requires an externally credentialed per-peer stream with flat SDP/ICE envelopes;
  the existing room-only registrar is structurally ineligible. Desktop activation fails
  closed until that exists. This is recorded in
  `apps/terminay-server/REMOTE-TRANSPORT-BLOCKER.md`.
- **Local proofs do not substitute for hosted proofs.** The secure-Werift artifact passes a
  real isolated Chromium enrollment, terminal traffic, saved-grant reconnect, and revocation
  run, but through the legacy terminal compatibility service and a local disposable relay. It
  does not cover the production hosted Desktop bootstrap or the full
  workspace/files/agents/settings matrix. The broad framed application suite runs over Local
  and isolated headless channels and records an explicit skip for the blocked
  `node-datachannel` prebuild. The Docker-to-client smoke harness covers standalone CLI
  handoff, health, foreground lifecycle, and pairing-URL parsing only. The browser-lifecycle
  simulation covers connection-state policy only and claims no physical mobile,
  operating-system backgrounding, or real-network evidence.
- **Compatibility alias retained.** Cleanup reports gained transport-neutral
  `headlessRateLimitWindows` and `headlessRuntime` fields while the older
  node-datachannel-only counter name remained as an exact alias, so Werift is not misreported
  without breaking existing readers.

## Migration Plan

Desktop main no longer imports or lazily loads the legacy remote access service, creates a
hidden `BrowserWindow`, accepts the legacy activation flag, registers a host sender, or
exposes `remote-webrtc-host:*` IPC; preload no longer publishes `terminayWebRtcHost`, and the
renderer has no `webrtc-host` route or host component. The browser-host protocol harness used
by isolated interoperability tests lives under `scripts/support` and is not a production
renderer entry.

## Open Questions

- The hosted service must emit a compatible Desktop signaling bootstrap and an externally
  credentialed per-peer signaling stream before production Desktop activation can succeed.
- Real pairing and reconnect end-to-end coverage across full workspace snapshot, terminal
  creation, file read and conflict save, agent events, settings, reconnect and resume,
  revocation, and exposure stop remains outstanding, as does replay, cross-origin,
  cross-server, invalid bundle, slow asset channel, disconnect storm, mobile-background
  reconnect, and TURN-required network testing on real infrastructure.
