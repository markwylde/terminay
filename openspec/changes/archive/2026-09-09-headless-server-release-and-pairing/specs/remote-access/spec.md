## MODIFIED Requirements

### Requirement: Exposure is explicit and administrator-controlled

Servers SHALL NOT be remotely reachable until an administrator enables exposure, either through **Expose this server…** on a client host or through the standalone server's explicit `--expose` configuration, which counts as the administrator's standing decision for that data root. Exposure SHALL connect the server to an authenticated WebRTC signaling endpoint before advertising a pairing URL, apply the explicit approval policy, generate a short-lived pairing URL and QR code, display exposure expiry, signaling and relay health, paired devices, and live connections, and allow the administrator to generate another pairing URL, revoke a device, or stop exposure. Hosted pairing links SHALL take the form `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`, where the session subdomain remains the WebRTC peer and `hostName` is a non-secret default label from the exposing machine. Direct pairing links SHALL take the form `https://<direct-origin>/v1/?hostName=<optional>#<secret>`, where the direct origin is the server's own signaling listener.

#### Scenario: Server is unreachable before exposure

- **WHEN** neither an administrator nor the standalone configuration has enabled exposure
- **THEN** the server is not remotely reachable

#### Scenario: Standalone exposure at startup

- **WHEN** a standalone server starts with `--expose` naming one or more modes
- **THEN** it registers each mode's pairing room and reconnect host before readiness reports a pairing URL

#### Scenario: Host registers before pairing is advertised

- **WHEN** a server is exposed
- **THEN** it registers the fragment-derived pairing room (`host-ready`) and its server host key before it is reachable for pairing or reconnect

#### Scenario: Create pairing link while exposed

- **WHEN** the administrator selects **Create pairing link** while the server is already exposed
- **THEN** a new one-time fragment is minted and that room is registered
- **AND** a pairing room a client has already joined is not re-shown

#### Scenario: Stopping exposure preserves local work

- **WHEN** the administrator stops exposure
- **THEN** pairing and reconnect are blocked
- **AND** Local Desktop use and server-owned work continue running

### Requirement: Uniform exposure for embedded and standalone servers

The same exposure model SHALL apply to an embedded Local server and to standalone `terminay-server`. Both SHALL provision a stable hosted session origin under the configured hosted domain through one shared server-owned implementation, persist it in the data root, and reuse it across restarts. Desktop and the CLI SHALL both start the server-owned hosted pairing host, registering the fragment-derived pairing room and the signed reconnect host before a pairing URL is advertised, and SHALL accept authenticated application transports on the `application` data channel. Desktop SHALL always serve the built server UI archive; the standalone server SHALL serve the UI archive that its distribution bundles.

#### Scenario: Standalone server exposes identically

- **WHEN** standalone `terminay-server` is exposed
- **THEN** it registers the pairing room and signed reconnect host in the same way Desktop does

#### Scenario: Session origin survives restart

- **WHEN** a standalone server restarts against the same data root
- **THEN** it advertises the same session origin and saved devices reconnect without pairing again

#### Scenario: CLI serves the UI archive when configured

- **WHEN** a client pairs with a standalone server whose distribution bundles the UI archive
- **THEN** the CLI serves that archive to the client

## ADDED Requirements

### Requirement: Direct self-hosted signaling exposure

A standalone server MAY expose through a direct signaling endpoint that it serves itself at `/signal` on its own HTTPS origin, in addition to or instead of the hosted relay. The direct endpoint SHALL be data-blind: it routes signaling frames by type between exactly one registered host and admitted clients and SHALL NOT parse, store, or act on transcripts, offers, or credentials. The listener SHALL present a self-signed certificate generated into the data root, and clients SHALL NOT treat that certificate as authentication of the server; the server host key signature over the transport transcript SHALL remain the only authentication of the endpoint, exactly as for the hosted relay. Every credential invariant of hosted exposure SHALL apply unchanged to direct exposure: pairing token, device key, challenge, ticket, approval, UI archive, and host context cross only transport-authenticated data channels. Direct and hosted exposure SHALL share one server host key, one device registry, and one approval queue.

#### Scenario: Direct pairing is transcript-authenticated

- **WHEN** a client joins a direct pairing room and receives an offer
- **THEN** it verifies the host-key signature and DTLS fingerprints in the transcript before any credential or data crosses
- **AND** the TLS certificate of the signaling listener plays no part in that decision

#### Scenario: Signaling endpoint is data-blind

- **WHEN** a frame reaches the direct endpoint
- **THEN** the endpoint forwards it by type to the matching peer and retains nothing beyond routing state

#### Scenario: One identity across modes

- **WHEN** a device pairs through the direct endpoint and later reconnects through the hosted relay, or the reverse
- **THEN** the same server host key and device registration are used and no second pairing is required

#### Scenario: Direct endpoint compromise is bounded

- **WHEN** an attacker controls the network path to the direct endpoint
- **THEN** they can only deny service or relay opaque DTLS packets to the authenticated host
