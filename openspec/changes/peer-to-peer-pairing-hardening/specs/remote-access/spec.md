## ADDED Requirements

### Requirement: Host approval with a match code

First pairing SHALL require the fragment plus explicit approval on the exposing host. After transport authentication succeeds and the client submits its enrollment request, the server SHALL derive a **match code** with HKDF-SHA256 over the pairing secret using a dedicated label and an info string binding the client nonce, the server host public key, and the SHA-256 of the device public key, rendered as five characters from a 32-symbol alphabet that excludes visually ambiguous glyphs. The server SHALL present a pending approval on the exposing host showing the requested device name and the match code, and the client SHALL compute and show the same code from the same inputs. The device SHALL be enrolled only when the administrator approves that exact pending request on the host; deny, expiry of the pending request after 120 seconds, closure of the peer, or rotation of the pairing room SHALL discard it and consume nothing. A pairing room SHALL hold at most one pending approval, and a second enrollment request on the same room while one is pending SHALL be refused. The match code, approval decision, and device public key SHALL travel only on the transport-authenticated data channels.

#### Scenario: Codes match and the host approves

- **WHEN** the phone shows the same five-character code as the exposing host and the administrator chooses **Approve**
- **THEN** the device is enrolled, the pairing room is consumed, and a connection ticket is returned on the same peer

#### Scenario: Host denies

- **WHEN** the administrator chooses **Deny** or lets the pending request expire
- **THEN** no device is enrolled, the pairing room is unchanged, and the client shows that approval was not given

#### Scenario: Substituted device key changes the code

- **WHEN** a party that observed the QR submits an enrollment with its own device key while the legitimate device is also pairing
- **THEN** the code shown on the host differs from the code on the legitimate device, and the second request is refused while the first is pending

#### Scenario: Match code never crosses an unauthenticated path

- **WHEN** the match code is derived
- **THEN** it appears in no signaling message, URL, log, or HTTP request

### Requirement: Server identity reset

The exposing host SHALL offer **Reset server identity** on Desktop and as the standalone `reset-identity` command. It SHALL generate a new server host key, revoke every registered device, close every live remote connection, and require a new pairing ceremony on each device. It SHALL require an explicit confirmation naming the number of devices that will lose trust.

#### Scenario: Reset invalidates prior trust

- **WHEN** the administrator confirms **Reset server identity**
- **THEN** a new host key is in use, all devices are revoked, and every reconnect shows a server identity change requiring re-pairing

### Requirement: Protected host key storage

On Desktop the private server host key SHALL be stored through the same OS-protected storage that holds device credentials and SHALL NOT be written in plaintext. When OS-protected storage is unavailable, exposure SHALL be refused rather than falling back to a plaintext key. The standalone server SHALL store the key with owner-only permissions in the data root and SHALL document that the data root is the trust boundary.

#### Scenario: Desktop without protected storage cannot expose

- **WHEN** OS-protected storage is unavailable on Desktop
- **THEN** exposure fails with a visible reason and no plaintext host key is written

### Requirement: Ticket bound to its peer

A connection ticket SHALL be usable only on the WebRTC peer whose authenticated data channel received it. Presenting a ticket on a different peer SHALL fail and SHALL consume the ticket.

#### Scenario: Ticket replayed on another peer

- **WHEN** a ticket issued to one peer is presented on a second peer's control channel
- **THEN** application authentication fails on the second peer and the ticket is spent

### Requirement: Bounded handshakes

The host SHALL accept at most one in-progress handshake per pairing room and at most one per device session, and at most four in-progress handshakes across all rooms and sessions. Joins beyond those bounds SHALL be refused without retiring an existing handshake. A handshake that has not completed transport authentication and ticket consumption within 60 seconds SHALL be closed.

#### Scenario: Join beyond the bound

- **WHEN** a fifth concurrent join arrives
- **THEN** it is refused and the four in-progress handshakes continue

## MODIFIED Requirements

### Requirement: Ownership boundaries

Terminay Server SHALL own pairing policy, device registration, public device keys, revocation, pending pairing approvals, application authorization, workspace state, audit history, and the private host key for its session origin. The stable session origin SHALL own browser pairing, WebRTC lifecycle, server-bundle installation, reconnect, match-code display, and challenge signing. `app.terminay.com` SHALL own the browser's list of manager profiles, the framed session iframe, and the origin-keyed device-credential vault, and SHALL NOT own approval, WebRTC, or the workspace. The signaling service SHALL route authenticated WebRTC offers, answers, and ICE candidates for one server session and is untrusted for confidentiality and integrity. TURN MAY relay encrypted WebRTC packets and SHALL NOT terminate the Terminay application protocol.

#### Scenario: Manager does not run the workspace

- **WHEN** a user is on `app.terminay.com`
- **THEN** the manager stores bookmarks, frames session origins, and holds framed-session credentials
- **AND** it does not show match codes, run WebRTC, or render the workspace

#### Scenario: Signaling admits only authorized parties

- **WHEN** a client attempts to join a pairing room
- **THEN** signaling admits it only with the fragment-derived join credential
- **AND** signaling admits a reconnect host only when that host proves the registered server host key
- **AND** signaling admits a `device-join` only with a device-key proof over the session id and a fresh nonce

#### Scenario: Signaling cannot substitute an endpoint

- **WHEN** the signaling service substitutes or proxies a WebRTC endpoint
- **THEN** client verification fails and no application data is exchanged

### Requirement: No data before transport authentication

No approval response, match code, device public key, device challenge signature, connection ticket, UI bundle, host context beyond the non-secret bootstrap record, application frame, clipboard content, or terminal data SHALL cross a WebRTC data channel until transport authentication succeeds. The UI bundle and full host context SHALL additionally require a consumed connection ticket on that peer. The signaling service MAY replay, reorder, replace, or suppress signaling messages only to cause a bounded visible connection failure, and SHALL NOT obtain an authenticated plaintext position between the client and server.

#### Scenario: Nothing released to an unauthenticated transport

- **WHEN** transport authentication has not yet succeeded
- **THEN** no approval, match code, device key material, ticket, bundle, host context, application frame, clipboard content, or terminal data is sent on any data channel

#### Scenario: Archive requires a ticket

- **WHEN** a peer that has completed DTLS but has not consumed a connection ticket requests the UI archive or host context
- **THEN** the request is refused

#### Scenario: Hostile signaling causes only denial of service

- **WHEN** signaling replays, reorders, replaces, or suppresses messages
- **THEN** the result is a bounded visible connection failure, not plaintext observation or mutation

### Requirement: Host key pinning and rotation

The pinned host key SHALL be part of the device credential, not a profile label or signaling record, on browser, framed-PWA, and Desktop clients alike. Host-key rotation SHALL be an explicit trust reset performed through **Reset server identity** and requiring a new pairing ceremony. Restoring or cloning server state SHALL preserve the host key or deliberately rotate server identity and invalidate prior device trust.

#### Scenario: Pinned host-key mismatch requires re-pairing

- **WHEN** the host key presented on reconnect does not match the key pinned for this device
- **THEN** the client shows a server identity change and requires explicit re-pairing
- **AND** it does not silently trust the replacement key

#### Scenario: Desktop pins at pairing

- **WHEN** Desktop completes a hosted pairing
- **THEN** the verified host key is stored in the same protected record as the device key before the pairing is reported complete

#### Scenario: Restored server state keeps or resets identity

- **WHEN** server state is restored or cloned
- **THEN** the host key is preserved, or server identity is deliberately rotated and prior device trust is invalidated

### Requirement: Exposure is explicit and administrator-controlled

Servers SHALL NOT be remotely reachable until an administrator enables **Expose this server…**. Exposure SHALL connect the server to Terminay's authenticated WebRTC signaling service before advertising a pairing URL, generate a short-lived pairing URL and QR code, display exposure expiry, signaling and relay health, paired devices, pending approvals, and live connections, and allow the administrator to approve or deny a pending device, generate another pairing URL, revoke a device, reset server identity, or stop exposure. Hosted pairing links SHALL take the form `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`, where the session subdomain remains the WebRTC peer and `hostName` is a non-secret default label from the exposing machine.

#### Scenario: Server is unreachable before exposure

- **WHEN** an administrator has not enabled exposure
- **THEN** the server is not remotely reachable

#### Scenario: Host registers before pairing is advertised

- **WHEN** a server is exposed
- **THEN** it registers the fragment-derived pairing room (`host-ready`) and its server host key before it is reachable for pairing or reconnect

#### Scenario: Create pairing link while exposed

- **WHEN** the administrator selects **Create pairing link** while the server is already exposed
- **THEN** a new one-time fragment is minted and that room is registered
- **AND** a pairing room a client has already joined is not re-shown

#### Scenario: Pending approval is visible where the QR was shown

- **WHEN** a device submits an enrollment request
- **THEN** the exposure surface replaces the QR with the device name, the match code, and **Approve** and **Deny**

#### Scenario: Stopping exposure preserves local work

- **WHEN** the administrator stops exposure
- **THEN** pairing and reconnect are blocked
- **AND** Local Desktop use and server-owned work continue running

### Requirement: Opening a hosted pairing link

Opening the advertised hosted pairing URL SHALL land on `app.terminay.com`. The manager SHALL consume the fragment in memory and strip query and hash from the visible URL and history, then ask whether to **Save and connect** with an optional title prefilled from `hostName` or the session id. Cancel SHALL discard the pairing material and save no profile. Confirm SHALL save or update the manager profile with that title, keep `https://app.terminay.com` as the top-level document, and load the reconstructed session pairing URL (`https://<session-id>.terminay.com/v1/#…`) in a fullscreen iframe without storing the fragment. The framed session origin SHALL perform enrollment: WebRTC, device key, enrollment request, match-code display while awaiting host approval, and workspace install, loading and saving that origin's device credential through the manager vault.

#### Scenario: Cancel saves nothing

- **WHEN** the user cancels the **Save and connect** prompt
- **THEN** the pairing material is discarded and no manager profile is written

#### Scenario: Confirm frames enrollment without leaving the manager

- **WHEN** the user confirms **Save and connect**
- **THEN** the profile is saved and the reconstructed session pairing URL is framed
- **AND** the top-level document remains `https://app.terminay.com`

#### Scenario: Fragment is stripped from the visible URL

- **WHEN** the manager consumes the pairing fragment
- **THEN** query and hash are removed from the visible URL and history and the fragment is never stored

### Requirement: Desktop pairing journey

Terminay Desktop **Add connection** SHALL accept the same pairing URL as the browser, including hosted `https://app.terminay.com/?s=…#…` links. The privileged connection host SHALL never treat `app.terminay.com` as the server: it SHALL read the session id from `s`, the one-time secret from the fragment, and the default profile label from `hostName` when present. For a hosted link it SHALL join the pairing room with the fragment-derived join credential, verify the pairing transport transcript, and run the device-enroll exchange and match-code display on the transport-authenticated `api` and `control` data channels; it SHALL NOT send the pairing token, device key, challenge signature, or ticket in any HTTP request to the session origin. It SHALL keep the device key and the verified host key in OS-protected storage, save the remote profile as the session origin plus that label, and open the selected server's verified workspace bundle in a sandboxed window. HTTP device endpoints SHALL be used only against a loopback local-UI origin.

#### Scenario: Desktop never enrols against the manager origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** it pairs against the reconstructed stable session origin and never against `app.terminay.com`

#### Scenario: Desktop enrols on the authenticated channel

- **WHEN** Desktop pairs with a hosted link
- **THEN** every enrollment message travels on a data channel whose offer transcript Desktop verified, and no request reaches the session origin over HTTPS

#### Scenario: Secrets stay in the privileged host

- **WHEN** a Desktop renderer is bound to a remote connection
- **THEN** it receives an opaque authenticated byte endpoint and non-secret profile identity
- **AND** pairing secrets, private device keys, and the pinned host key remain in the privileged connection host

### Requirement: Reconnect sequence

Reconnect SHALL proceed in order: the user opens a stable session origin directly, selects its PWA manager profile, or opens its Desktop profile; the client sends a fresh connection nonce with `device-join` and its device-key proof, receives the WebRTC offer and authenticated transport transcript, and verifies that transcript with the host key pinned for this device; only after transport authentication the server sends, on the `api` data channel, a short-lived challenge containing the server identity, session origin, device id, nonce, and expiry; the client signs the challenge with its device private key; the server verifies the signature with the registered public key and checks expiry and revocation state; the server issues a short-lived, single-use connection ticket bound to that authenticated device and to that WebRTC peer; and the client opens the application transport and resumes workspace and terminal subscriptions from confirmed revisions and sequence positions. Desktop SHALL follow this same sequence and SHALL NOT obtain a challenge or ticket over HTTPS from a hosted session origin. A terminal subscription SHALL resume from the position the display actually rendered or SHALL request a fresh presentation; no component SHALL supply a remembered cursor of its own on either side of the transport.

#### Scenario: Challenge follows transport authentication

- **WHEN** transport authentication has not completed
- **THEN** the server does not send the device challenge

#### Scenario: Desktop reconnect stays on the authenticated channel

- **WHEN** Desktop reconnects to a hosted server
- **THEN** the challenge, signature, and ticket travel only on data channels of the transcript-verified peer

#### Scenario: Revoked device fails the challenge check

- **WHEN** a revoked device signs the challenge correctly
- **THEN** the server rejects it on revocation state and issues no connection ticket

#### Scenario: Subscriptions resume from confirmed positions

- **WHEN** the application transport opens after a reconnect
- **THEN** workspace and terminal subscriptions resume from confirmed revisions and sequence positions

#### Scenario: Terminal resume states an explicit cursor

- **WHEN** a terminal subscription resumes after a reconnect
- **THEN** it names the position the display rendered or requests a fresh presentation, and no remembered cursor is substituted for it

### Requirement: Connecting-surface progress reporting

The session-origin connecting surface SHALL keep the five-dot loading indicator visible while signaling and archive transfer run. Once the archive start record names `compressedBytes`, it SHALL show a progress bar for total compressed megabytes, bytes already cached for that exact bundle, bytes received on this transfer, and percent complete. A complete cached archive for the same `bundleId` SHALL be reused, with the bar reporting the cached size instead of repeating the download. The awaiting-approval match-code view and connection errors SHALL hide the spinner and bar.

#### Scenario: Progress bar appears with byte totals

- **WHEN** the archive start record names `compressedBytes`
- **THEN** the surface shows total compressed megabytes, cached bytes, received bytes, and percent complete

#### Scenario: Cached bundle is reused

- **WHEN** a complete cached archive exists for the same `bundleId`
- **THEN** it is reused and the bar reports the cached size rather than repeating the download

#### Scenario: Errors and PIN entry hide progress chrome

- **WHEN** the match-code view is shown or a connection error occurs
- **THEN** the spinner and progress bar are hidden

### Requirement: One live connection per device

The server SHALL hold at most one live connection per device. A replacement peer for a device SHALL be accepted only after it has completed transport authentication and consumed a valid connection ticket; the host SHALL then close the previous peer and complete its server-side connection cleanup before attaching the replacement to the workspace. A `device-join`, offer, or answer that has not yet authenticated SHALL NOT close, mute, or disturb the device's existing live peer. A superseded connection SHALL never outlive, mute, or tear down the resources of the connection that replaced it. Closing a connection SHALL release only what that exact connection owns — its terminal attachments, subscriptions, leases, and checkpoints — and never state belonging to another connection from the same device. Device identity SHALL govern authentication, permissions, and revocation, and SHALL NOT govern connection lifetime.

#### Scenario: Rejoin replaces the previous peer

- **WHEN** the same device joins again and its replacement peer consumes a valid ticket
- **THEN** the previous peer is closed and cleaned up before the replacement attaches to the workspace

#### Scenario: Unauthenticated join leaves the live peer alone

- **WHEN** a `device-join` for a live device arrives but the joiner never authenticates
- **THEN** the live peer stays connected and its terminal output continues

#### Scenario: Late failure of a superseded connection is inert

- **WHEN** a superseded connection fails at any later time
- **THEN** the replacement's live stream, leases, and checkpoints are unaffected

#### Scenario: Second tab takes over

- **WHEN** the workspace is opened in a second tab at the same session origin
- **THEN** that reconnect takes the connection over and the first tab shows reconnecting
- **AND** separate devices, Desktop windows, and Local connections are unaffected

### Requirement: One handshake at a time per room or session

Signaling SHALL admit one handshake at a time for a pairing room or device session. A second `client-join` or `device-join` for the same room or session SHALL retire an incomplete handshake for that room or session only, SHALL NOT retire handshakes for other rooms or sessions, SHALL NOT close an already-authenticated live peer, and SHALL NOT mix ICE across two offers.

#### Scenario: Second join retires an incomplete handshake

- **WHEN** a second `client-join` or `device-join` arrives while a handshake for that room or session is incomplete
- **THEN** that incomplete handshake is retired and ICE is not mixed across two offers

#### Scenario: Authenticated peer is not closed by a new handshake attempt

- **WHEN** a new handshake begins while an authenticated live peer exists
- **THEN** that live peer is not closed by the handshake attempt itself

### Requirement: Pairing credential security invariants

Pairing URLs SHALL be short-lived and single-use. The fragment SHALL be consumed in memory and SHALL never be sent in an HTTP request, and neither SHALL any value derived from it. Pairing SHALL require the fragment plus explicit approval of the matching code on the exposing host. A public session origin, server id, device id, or match code alone SHALL grant no access.

#### Scenario: PIN entry is masked

- **WHEN** the user pairs a device
- **THEN** no PIN field is presented; the only code shown is the match code, displayed in the clear on both devices so it can be compared

#### Scenario: Public identifiers grant nothing

- **WHEN** an attacker knows the session origin, server id, device id, or match code alone
- **THEN** no access is granted

#### Scenario: Fragment never travels over HTTP

- **WHEN** the pairing fragment or a value derived from it is processed
- **THEN** it is consumed in memory and never included in an HTTP request

#### Scenario: Captured QR without approval grants nothing

- **WHEN** a party who captured the QR submits an enrollment
- **THEN** no device is enrolled until the administrator approves that request's match code on the host

### Requirement: Hosted services stay data-blind

The signaling service, TURN service, logs, analytics, and URLs SHALL never contain private device keys, private host keys, pairing fragments, match codes, approval decisions, connection tickets, terminal output, project names, paths, filenames, command history, recordings, settings, or secrets. Host `postMessage` SHALL carry only the closed framed-host schema. The manager vault MAY hold per-origin device credentials for framed sessions and MAY clone a credential only to the matching session origin. Hosted services SHALL remain data-blind for Terminay application content.

#### Scenario: Fragment never leaves the client

- **WHEN** pairing completes
- **THEN** the pairing fragment appears in no manager storage, no session URL after consumption, no request, no log, and no analytics event

#### Scenario: Relay sees no application content

- **WHEN** TURN relays packets for a session
- **THEN** it carries only encrypted WebRTC packets and observes no Terminay application content
