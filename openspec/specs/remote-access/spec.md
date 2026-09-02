# remote-access Specification

## Purpose

Terminay Server exposes its complete workspace to authorized Desktop and browser devices over WebRTC, using one transport, one device-enrollment model, and one durable browser credential model, so that remote clients see the same server-owned workspace, terminal sessions, application protocol, and responsive UI as the Local Desktop connection.

## Requirements

### Requirement: Remote access model and vocabulary

Remote access SHALL be defined by five concepts. A **stable session origin** is the permanent HTTPS origin for one Terminay Server, such as `https://<server-id>.terminay.com`. A **pairing URL** is the advertised one-time enrollment link whose fragment carries the one-time secret and whose non-secret `s` query identifies the stable session origin. A **browser device identity** is one non-extractable private key held by the browser, with the server holding the corresponding public key, device id, name, and revocation state. A **manager profile** is a non-secret bookmark stored by `app.terminay.com` containing a label, stable session origin, and local timestamps. A **server host key** is a long-lived key pair owned by Terminay Server for its stable session origin, whose private half never leaves the server.

Each server SHALL have exactly one stable session origin. Credentials created at one origin, or for one server, SHALL NOT authorize another.

#### Scenario: Pairing secret is not a reconnect credential

- **WHEN** a browser device has completed pairing
- **THEN** the pairing secret is spent and future connections prove possession of the browser device key instead

#### Scenario: Host key answers a different question from the device key

- **WHEN** a client reconnects to a stable session origin
- **THEN** the server host key proves the reconnect host is the same server
- **AND** the browser device key proves this is the same paired device

#### Scenario: Credentials do not cross servers

- **WHEN** a credential enrolled for one server or origin is presented to another
- **THEN** it grants no access

### Requirement: Ownership boundaries

Terminay Server SHALL own pairing policy, device registration, public device keys, revocation, application authorization, workspace state, audit history, and the private host key for its session origin. The stable session origin SHALL own browser pairing, WebRTC lifecycle, server-bundle installation, reconnect, and challenge signing. `app.terminay.com` SHALL own the browser's list of manager profiles, the framed session iframe, and the origin-keyed device-credential vault, and SHALL NOT own pairing PIN entry, WebRTC, or the workspace. The signaling service SHALL route authenticated WebRTC offers, answers, and ICE candidates for one server session and is untrusted for confidentiality and integrity. TURN MAY relay encrypted WebRTC packets and SHALL NOT terminate the Terminay application protocol.

#### Scenario: Manager does not run the workspace

- **WHEN** a user is on `app.terminay.com`
- **THEN** the manager stores bookmarks, frames session origins, and holds framed-session credentials
- **AND** it does not enter PINs, run WebRTC, or render the workspace

#### Scenario: Signaling admits only authorized parties

- **WHEN** a client attempts to join a pairing room
- **THEN** signaling admits it only with the fragment-derived join credential
- **AND** signaling admits a reconnect host only when that host proves the registered server host key

#### Scenario: Signaling cannot substitute an endpoint

- **WHEN** the signaling service substitutes or proxies a WebRTC endpoint
- **THEN** client verification fails and no application data is exchanged

### Requirement: Server-authenticated transport transcript

Every pairing and reconnect generation SHALL use a server-authenticated transport transcript with one canonical, versioned byte serialization. The transcript SHALL include at least a Terminay protocol/domain separator and transcript version; pairing or reconnect scope plus the pairing room or stable session id; stable session origin and server id; server host public key and algorithm; a fresh client-generated nonce for this connection attempt; a server-generated offer/generation id, issued time, and short expiry; a diagnostic cryptographic hash of the offered SDP bytes; and every offered DTLS certificate fingerprint including algorithm and value. The server host key SHALL sign the canonical transcript, and the signature and transcript SHALL travel with the offer rather than as a separate registration claim.

#### Scenario: Fingerprints are verified before use

- **WHEN** a client receives a WebRTC offer with its signed transcript
- **THEN** the client verifies the received offer's DTLS fingerprints against the signed fingerprints before calling `setRemoteDescription`

#### Scenario: Other SDP fields are not an identity boundary

- **WHEN** an untrusted relay normalizes or replaces SDP fields other than the DTLS fingerprints
- **THEN** it can only deny service or relay opaque DTLS packets to the authenticated host
- **AND** it cannot change the authenticated DTLS endpoint

#### Scenario: DTLS alone is insufficient

- **WHEN** WebRTC DTLS encryption is in use without a signed transcript
- **THEN** it is not treated as sufficient host authentication, because signaling carries the SDP fingerprint

### Requirement: First-pairing transport authentication

First pairing has no previously pinned host key. The server SHALL additionally authenticate the transcript and host public key with a pairing-authentication key derived from the fragment using a dedicated HKDF label. The signaling service SHALL receive neither that key nor enough material to calculate it. The client SHALL verify the pairing authenticator, then the host-key signature, and SHALL atomically store the verified host public key together with the newly enrolled device credential.

#### Scenario: Pairing authenticator verified before host-key signature

- **WHEN** a first pairing offer arrives
- **THEN** the client verifies the fragment-derived pairing authenticator, then the host-key signature
- **AND** stores the verified host public key atomically with the new device credential

#### Scenario: Signaling cannot derive the pairing authentication key

- **WHEN** the signaling service observes all traffic it routes for a pairing room
- **THEN** it holds neither the pairing-authentication key nor material sufficient to calculate it

### Requirement: Reconnect transport authentication

Reconnect SHALL send a fresh client nonce before the server creates its offer. The client SHALL require the transcript to contain that exact nonce and SHALL verify the signature with the host public key pinned during pairing. A host-key mismatch, missing, duplicate, or changed fingerprint, stale transcript, repeated offer id, wrong origin, server, or scope, unsupported algorithm, or invalid signature SHALL fail the generation.

#### Scenario: Nonce must match

- **WHEN** the received transcript does not contain the exact nonce the client sent for this attempt
- **THEN** the generation fails

#### Scenario: Tampered transcript field fails the generation

- **WHEN** a signaling relay substitutes a fingerprint, host key, nonce, scope, origin, server id, generation id, expiry, or signature
- **THEN** the generation is rejected before any pairing or reconnect credential is released

#### Scenario: Two-peer proxying is impossible

- **WHEN** an adversarial signaling relay attempts to authenticate two separate WebRTC peers and proxy a pairing or reconnect session
- **THEN** it fails
- **AND** its only successful forwarding path preserves the server-authenticated DTLS endpoint end to end

### Requirement: No data before transport authentication

No PIN, approval response, device public key, device challenge signature, connection ticket, UI bundle, application frame, clipboard content, or terminal data SHALL cross a WebRTC data channel until transport authentication succeeds. The signaling service MAY replay, reorder, replace, or suppress signaling messages only to cause a bounded visible connection failure, and SHALL NOT obtain an authenticated plaintext position between the client and server.

#### Scenario: Nothing released to an unauthenticated transport

- **WHEN** transport authentication has not yet succeeded
- **THEN** no PIN, approval, device key material, ticket, bundle, application frame, clipboard content, or terminal data is sent on any data channel

#### Scenario: Hostile signaling causes only denial of service

- **WHEN** signaling replays, reorders, replaces, or suppresses messages
- **THEN** the result is a bounded visible connection failure, not plaintext observation or mutation

### Requirement: Host key pinning and rotation

The pinned host key SHALL be part of the device credential, not a profile label or signaling record. Host-key rotation SHALL be an explicit trust reset requiring a new pairing ceremony. Restoring or cloning server state SHALL preserve the host key or deliberately rotate server identity and invalidate prior device trust.

#### Scenario: Pinned host-key mismatch requires re-pairing

- **WHEN** the host key presented on reconnect does not match the key pinned for this device
- **THEN** the client shows a server identity change and requires explicit re-pairing
- **AND** it does not silently trust the replacement key

#### Scenario: Restored server state keeps or resets identity

- **WHEN** server state is restored or cloned
- **THEN** the host key is preserved, or server identity is deliberately rotated and prior device trust is invalidated

### Requirement: Exposure is explicit and administrator-controlled

Servers SHALL NOT be remotely reachable until an administrator enables **Expose this server…**. Exposure SHALL connect the server to Terminay's authenticated WebRTC signaling service before advertising a pairing URL, apply the configured six-digit PIN or explicit approval policy, generate a short-lived pairing URL and QR code, display exposure expiry, signaling and relay health, paired devices, and live connections, and allow the administrator to generate another pairing URL, revoke a device, or stop exposure. Hosted pairing links SHALL take the form `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`, where the session subdomain remains the WebRTC peer and `hostName` is a non-secret default label from the exposing machine.

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

#### Scenario: Stopping exposure preserves local work

- **WHEN** the administrator stops exposure
- **THEN** pairing and reconnect are blocked
- **AND** Local Desktop use and server-owned work continue running

### Requirement: Host claim requires proof of the registered host key

A later host claim for the same session SHALL prove possession of the same private server host key. A different key SHALL NOT replace a live registration, and exposure SHALL fail closed when a different key is already registered for that session.

#### Scenario: Second host cannot take over

- **WHEN** a second host that knows only the session origin attempts to register as the reconnect host
- **THEN** it cannot replace the registered reconnect host

#### Scenario: Exposure fails closed on key conflict

- **WHEN** a host attempts exposure for a session whose registration holds a different host key
- **THEN** exposure fails closed

### Requirement: Pairing room lifecycle and QR rotation

A pairing room SHALL be one-time and short-lived. Exposure and the signed reconnect host (`device-host-ready`) SHALL stay up until the administrator stops exposure. Pairing-room expiry, pairing-socket close, or minting a replacement QR SHALL NOT close live WebRTC peers or unregister the reconnect host. The exposing host SHALL refresh `device-host-ready` before that registration expires. When a pairing room is within seconds of expiry, or after a pairing client has connected, Desktop SHALL mint a replacement room and visibly refresh the QR card without disconnecting live clients or dropping reconnect availability.

#### Scenario: QR left on screen stays live

- **WHEN** a pairing room approaches expiry while its QR is displayed
- **THEN** a replacement room is minted and the QR card visibly refreshes
- **AND** live clients stay connected and reconnect availability is retained

#### Scenario: New pairing URL preserves existing state

- **WHEN** the administrator generates another pairing URL
- **THEN** the stable session origin, registered devices, live connections, and server-owned PTYs are unchanged

#### Scenario: Pairing success animation keeps the QR visible

- **WHEN** a browser completes pairing
- **THEN** the QR stays visible while a checkmark draws over it and the modal then closes
- **AND** the QR does not vanish or become a preparing message while that overlay runs

### Requirement: Uniform exposure for embedded and standalone servers

The same exposure model SHALL apply to an embedded Local server and to standalone `terminay-server`. Desktop and the CLI SHALL both start the server-owned hosted pairing host, registering the fragment-derived pairing room and the signed reconnect host before a pairing URL is advertised, and SHALL accept authenticated application transports on the `application` data channel. Desktop SHALL always serve the built server UI archive; the CLI SHALL serve that archive when `TERMINAY_UI_RENDERER_DIRECTORY` points at `dist-web`.

#### Scenario: Standalone server exposes identically

- **WHEN** standalone `terminay-server` is exposed
- **THEN** it registers the pairing room and signed reconnect host in the same way Desktop does

#### Scenario: CLI serves the UI archive when configured

- **WHEN** `TERMINAY_UI_RENDERER_DIRECTORY` points at `dist-web`
- **THEN** the CLI serves the built server UI archive

### Requirement: Opening a hosted pairing link

Opening the advertised hosted pairing URL SHALL land on `app.terminay.com`. The manager SHALL consume the fragment in memory and strip query and hash from the visible URL and history, then ask whether to **Save and connect** with an optional title prefilled from `hostName` or the session id. Cancel SHALL discard the pairing material and save no profile. Confirm SHALL save or update the manager profile with that title, keep `https://app.terminay.com` as the top-level document, and load the reconstructed session pairing URL (`https://<session-id>.terminay.com/v1/#…`) in a fullscreen iframe without storing the fragment. The framed session origin SHALL perform enrollment: WebRTC, PIN or approval, device key, and workspace install, loading and saving that origin's device credential through the manager vault.

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

### Requirement: First-party session-origin enrollment

A first-party visit to `https://<session-id>.terminay.com/v1/#<secret>` SHALL enroll at the session origin using session-origin IndexedDB and SHALL NOT use the manager vault. **Open in new tab** SHALL use a first-party session document that stores its device key in session-origin IndexedDB. Direct and framed credentials for the same origin SHALL be separate.

#### Scenario: Direct session URL enrolls first-party

- **WHEN** the user opens a session-origin `/v1/` pairing URL directly
- **THEN** enrollment occurs at that origin with session-origin IndexedDB

#### Scenario: New-tab credential is separate from the vault

- **WHEN** the user chooses **Open in new tab** from the manager
- **THEN** the resulting first-party document stores its own device key and does not share the manager vault

### Requirement: Pairing URLs are single-use

A complete pairing URL SHALL NOT be usable again. Opening the saved profile or the stable session origin later SHALL use the registered browser device identity. A later **Create pairing link** SHALL advertise a new fragment, and scanning or pasting a previous code SHALL be rejected as already used.

#### Scenario: Consumed pairing URL is rejected

- **WHEN** a user scans or pastes a pairing code that has already been consumed
- **THEN** it is rejected as already used

#### Scenario: Later access needs no pairing URL

- **WHEN** the user opens the saved profile or the stable session origin after enrollment
- **THEN** the registered browser device identity is used and no pairing URL is required

### Requirement: PWA add-connection flow

`https://app.terminay.com` SHALL list the manager profiles stored in that browser and SHALL offer **Add new connection**, which opens a dedicated page to scan the pairing QR with the device camera, choose a photo of that QR, or paste a pairing URL. The PWA SHALL validate the URL, accepting manager-origin hosted links and session-origin `/v1/` links, then use the same **Save and connect** prompt as opening the link in a browser. Confirm SHALL frame the reconstructed session pairing URL without leaving `app.terminay.com`. Selecting a saved profile SHALL load that stable session origin in the same fullscreen iframe, where the session authenticates with the vaulted device key and reconnects.

#### Scenario: QR scan uses the same save prompt

- **WHEN** the user scans or pastes a pairing URL inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed without leaving `app.terminay.com`

#### Scenario: Saved profile reconnects from the vault

- **WHEN** the user selects a saved manager profile
- **THEN** its stable session origin is framed and the session authenticates with the vaulted device key

### Requirement: Returning to the manager list

**Back to connections** SHALL return to the manager list without navigating `window.top`. From a connected workspace this action SHALL be **Switch connections** and **File → Disconnect**. Desktop SHALL omit **Switch connections** because its connection menu lists every remembered profile. Returning to the manager list SHALL unload the iframe.

#### Scenario: Returning unloads the framed session

- **WHEN** the user chooses **Back to connections** or **Switch connections**
- **THEN** the manager list is shown, the iframe is unloaded, and `window.top` is not navigated

#### Scenario: Desktop has no switch action

- **WHEN** a Desktop client displays its connection menu
- **THEN** **Switch connections** is absent and every remembered profile is listed

### Requirement: Missing framed device identity

If the framed session has no valid device identity, that session page SHALL ask for a fresh pairing URL. The manager profile SHALL remain until the user chooses **Forget**, which SHALL also delete that origin's vault slot.

#### Scenario: Invalid identity requests re-pairing

- **WHEN** a framed session finds no valid device identity
- **THEN** the session page asks for a fresh pairing URL and the manager profile is retained

#### Scenario: Forget clears the vault slot

- **WHEN** the user forgets a manager profile
- **THEN** the profile and that origin's vault slot are both deleted

### Requirement: Closed framed-host message schema

The framed host SHALL use one closed, origin-checked `postMessage` schema for device credentials, clipboard, microphone, notifications, and shell control. It SHALL NOT proxy WebRTC, workspace frames, or generic storage. The manager SHALL key vault entries only by `event.origin` and SHALL clone a credential only into the iframe that matches that origin. Structured clone SHALL keep the key non-extractable. The manager SHALL never sign. The session SHALL speak to `parent` only when `parent.origin` is `https://app.terminay.com` and SHALL ignore any other embedder.

#### Scenario: Vault entry is origin-keyed

- **WHEN** a session iframe requests a device credential
- **THEN** the manager resolves the vault slot only from `event.origin` and clones only into the matching iframe
- **AND** an iframe cannot name another origin's slot

#### Scenario: Session ignores foreign embedders

- **WHEN** a session document is embedded by an origin other than `https://app.terminay.com`
- **THEN** it posts nothing to `parent` and ignores that embedder

#### Scenario: Manager never signs

- **WHEN** a challenge must be signed
- **THEN** the session iframe signs it and the manager does not

### Requirement: Framed session presentation and permissions

The PWA SHALL show at most one framed session; opening another connection SHALL replace that iframe. Clipboard and microphone messages SHALL require a user gesture in the manager or in the iframe surface that requested them. The iframe `allow` list MAY include clipboard and microphone and SHALL NOT include camera; camera SHALL stay on the manager for QR scan. The manager SHALL pin the titlebar and session iframe to the visual viewport, including when the iOS keyboard is visible, with the iframe below the titlebar and the workspace inside it not adding `env(safe-area-inset-top)` again. Session and workspace script SHALL NOT assign `window.top` or use `target="_top"`; `target="_blank"` MAY open a first-party tab.

#### Scenario: One framed session at a time

- **WHEN** the user opens another connection while a session is framed
- **THEN** the existing iframe is replaced

#### Scenario: Camera stays on the manager

- **WHEN** a framed session requests camera access
- **THEN** it is not granted through the iframe `allow` list, and QR scanning happens on the manager

#### Scenario: Viewport pinning with the iOS keyboard

- **WHEN** the iOS software keyboard is visible over a framed session
- **THEN** the titlebar and session iframe stay pinned to the visual viewport

### Requirement: iOS PWA storage isolation

An iOS Home Screen PWA SHALL have storage isolated from Safari. Pairing in Safari SHALL NOT populate the PWA vault, and pairing in the PWA SHALL NOT populate Safari.

#### Scenario: Safari pairing does not reach the PWA

- **WHEN** a device pairs in Safari and the user then opens the installed PWA
- **THEN** the PWA vault holds no credential for that origin

### Requirement: Desktop pairing journey

Terminay Desktop **Add connection** SHALL accept the same pairing URL as the browser, including hosted `https://app.terminay.com/?s=…#…` links. The privileged connection host SHALL never treat `app.terminay.com` as the server: it SHALL read the session id from `s`, the one-time secret from the fragment, and the default profile label from `hostName` when present. It SHALL then pair against the stable session origin using the device-enroll exchange on that origin, keep the device key in OS-protected storage, save the remote profile as the session origin plus that label, and open the selected server's verified workspace bundle in a sandboxed window.

#### Scenario: Desktop never enrols against the manager origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** it pairs against the reconstructed stable session origin and never against `app.terminay.com`

#### Scenario: Secrets stay in the privileged host

- **WHEN** a Desktop renderer is bound to a remote connection
- **THEN** it receives an opaque authenticated byte endpoint and non-secret profile identity
- **AND** pairing secrets and private device keys remain in the privileged connection host

### Requirement: Reconnect sequence

Reconnect SHALL proceed in order: the user opens a stable session origin directly, selects its PWA manager profile, or opens its Desktop profile; the client sends a fresh connection nonce, receives the WebRTC offer and authenticated transport transcript, and verifies that transcript with the host key pinned for this device; only after transport authentication the server sends a short-lived challenge containing the server identity, session origin, device id, nonce, and expiry; the client signs the challenge with its device private key; the server verifies the signature with the registered public key and checks expiry and revocation state; the server issues a short-lived, single-use connection ticket bound to that authenticated device and WebRTC peer; and the client opens the application transport and resumes workspace and terminal subscriptions from confirmed revisions and sequence positions. A terminal subscription SHALL resume from the position the display actually rendered or SHALL request a fresh presentation; no component SHALL supply a remembered cursor of its own on either side of the transport.

#### Scenario: Challenge follows transport authentication

- **WHEN** transport authentication has not completed
- **THEN** the server does not send the device challenge

#### Scenario: Revoked device fails the challenge check

- **WHEN** a revoked device signs the challenge correctly
- **THEN** the server rejects it on revocation state and issues no connection ticket

#### Scenario: Subscriptions resume from confirmed positions

- **WHEN** the application transport opens after a reconnect
- **THEN** workspace and terminal subscriptions resume from confirmed revisions and sequence positions

#### Scenario: Terminal resume states an explicit cursor

- **WHEN** a terminal subscription resumes after a reconnect
- **THEN** it names the position the display rendered or requests a fresh presentation, and no remembered cursor is substituted for it

### Requirement: Durable reconnect registration

Standalone `terminay-server` SHALL keep a device-authentication signaling session (`device-host-ready`) for the stable session origin while the process is exposed. Signaling SHALL accept that registration only when the host proves possession of the same server host key registered for that origin. Opening that origin later SHALL join with `device-join` and then prove the browser device key to that server. Pairing rooms SHALL remain one-time and SHALL NOT be reused for reconnect. The device private key SHALL be the only durable browser authentication secret; connection tickets SHALL exist only for individual connection attempts.

#### Scenario: Knowing the hostname is not enough

- **WHEN** a party knows only the public session hostname
- **THEN** it cannot become the WebRTC host for that session

#### Scenario: Fragment cannot be reused for reconnect

- **WHEN** a pairing fragment has been consumed
- **THEN** reconnect cannot use it and proceeds by device key instead

### Requirement: PWA connection manager surface

`app.terminay.com` SHALL be installable as a PWA and SHALL work as a local connection manager, using the same dark workspace chrome, mark, and compact controls as the connected Terminay workspace. It SHALL provide **Add new connection**, which opens a dedicated page to **Scan QR code** (camera or photo) or **Paste pairing URL**; a list of saved manager profiles; **Open** as the primary row action, which frames the session origin in the current PWA view, with **Open in new tab**, rename, and forget in an overflow menu; and same-document PWA chrome by default with that explicit first-party open-in-new-tab action. Its application shell and saved profile list SHALL remain available offline, while opening a profile still requires that profile's stable session origin to be reachable.

#### Scenario: Manager works offline

- **WHEN** the installed PWA is opened without network access
- **THEN** the application shell and saved profile list are available

#### Scenario: Opening a profile requires reachability

- **WHEN** the user opens a saved profile whose session origin is unreachable
- **THEN** the connection does not succeed and the origin is not reported as connected

### Requirement: Manager profile store contents

The manager profile store SHALL contain only a label, the canonical stable session origin, and created and last-opened timestamps. The manager SHALL accept hosted pairing URLs on `app.terminay.com` and session-origin `/v1/` URLs and SHALL store only the reconstructed stable session origin as the bookmark. A non-secret `hostName` query MAY supply the default local label. Opening or pasting a pairing URL SHALL ask **Save and connect** before that bookmark is written, and the user MAY set a title there. The manager SHALL reject URL credentials, unsupported schemes, and any query other than `s`, `hostName`, and `pairingExpiresAt`. It SHALL never store the pairing fragment or complete pairing URL.

#### Scenario: Unsupported query is rejected

- **WHEN** a pairing URL carries a query field other than `s`, `hostName`, or `pairingExpiresAt`
- **THEN** the manager rejects it

#### Scenario: URL credentials are rejected

- **WHEN** a pasted URL contains userinfo credentials or an unsupported scheme
- **THEN** the manager rejects it

#### Scenario: Fragment never enters storage

- **WHEN** a bookmark is written from a pairing URL
- **THEN** only the reconstructed stable session origin, label, and timestamps are stored

### Requirement: Framed-session credential vault

The framed-session vault SHALL be separate from the bookmark list. It SHALL store only that origin's non-extractable device private key plus the non-secret device id and name needed to reconnect. It SHALL live in manager-origin IndexedDB rather than `localStorage`. The manager SHALL never sign with those keys; the session iframe SHALL. Pairing fragments, PINs, tickets, terminal data, and workspace data SHALL never enter the vault.

#### Scenario: Vault contents are limited

- **WHEN** a framed session enrolls a device
- **THEN** the vault holds only the non-extractable private key, device id, and device name for that origin

#### Scenario: Vault is not localStorage

- **WHEN** the manager persists a framed-session credential
- **THEN** it uses manager-origin IndexedDB

### Requirement: Server-bundled workspace delivery

The server distribution SHALL contain the complete responsive workspace UI and its matching application-protocol client. The stable session origin SHALL authenticate the device, obtain the selected server bundle through the WebRTC asset lane, validate its declared contract and resource bounds, and launch it under that same origin. `app.terminay.com` SHALL contain the connection manager only; Desktop and browser hosts SHALL NOT supply another workspace implementation or interpret feature-level application messages.

#### Scenario: Bundle launches at the session origin

- **WHEN** a device authenticates to a stable session origin
- **THEN** the selected server bundle is transferred over the asset lane, validated, and launched under that same origin

#### Scenario: Hosts do not interpret application messages

- **WHEN** a host shell relays application traffic
- **THEN** it does not interpret feature-level application messages or supply an alternative workspace

### Requirement: Connecting-surface progress reporting

The session-origin connecting surface SHALL keep the five-dot loading indicator visible while signaling and archive transfer run. Once the archive start record names `compressedBytes`, it SHALL show a progress bar for total compressed megabytes, bytes already cached for that exact bundle, bytes received on this transfer, and percent complete. A complete cached archive for the same `bundleId` SHALL be reused, with the bar reporting the cached size instead of repeating the download. Pairing PIN entry and connection errors SHALL hide the spinner and bar.

#### Scenario: Progress bar appears with byte totals

- **WHEN** the archive start record names `compressedBytes`
- **THEN** the surface shows total compressed megabytes, cached bytes, received bytes, and percent complete

#### Scenario: Cached bundle is reused

- **WHEN** a complete cached archive exists for the same `bundleId`
- **THEN** it is reused and the bar reports the cached size rather than repeating the download

#### Scenario: Errors and PIN entry hide progress chrome

- **WHEN** pairing PIN entry is shown or a connection error occurs
- **THEN** the spinner and progress bar are hidden

### Requirement: Closed host-context schema

`/api/host-context` SHALL be a closed host-context schema. Display names SHALL travel on the pairing URL and session-host `hostName` and SHALL NOT be carried as extra host-context fields.

#### Scenario: Display name is not a host-context field

- **WHEN** a client obtains host context
- **THEN** the response carries only the closed schema and no extra display-name fields

### Requirement: Data channel chunking and fragmentation

WebRTC DataChannel payloads SHALL stay within the negotiated SCTP maximum message size. The UI archive SHALL be transferred as acknowledged binary chunks of at most 64 KiB on the `asset` and `assets` lanes, with at most four unacknowledged chunks in flight. Archive transfer failures SHALL send typed JSON `asset:bundle-error` with a reason of `cancelled`, `timeout`, `unavailable`, `invalid-request`, or `internal`, and SHALL NOT take down the host process. An application frame above the negotiated maximum message size SHALL travel as ordered fragments that the receiving peer reassembles into the original frame before any feature sees it. A fragment SHALL carry its own `TRMF` magic, format version, transfer id, index, and count; frames that already fit SHALL never be fragmented. A receiver SHALL reassemble at most four concurrent transfers and SHALL evict the oldest when a newer one starts, SHALL never buffer more than its frame limit for one transfer, and SHALL fail the lane closed on a fragment that is out of order, over budget, or of an unsupported version.

#### Scenario: Large query answers complete remotely

- **WHEN** a folder task scan, Git diff, or other large query answer exceeds the SCTP maximum message size
- **THEN** it is fragmented, reassembled, and delivered exactly as it is locally

#### Scenario: Abandoned transfer cannot accumulate

- **WHEN** a sender abandons a transfer mid-frame and new transfers start
- **THEN** the receiver evicts the oldest of at most four concurrent transfers

#### Scenario: Malformed fragment fails the lane closed

- **WHEN** a fragment arrives out of order, over budget, or with an unsupported version
- **THEN** the lane fails closed

#### Scenario: Archive failure is typed and survivable

- **WHEN** archive transfer fails
- **THEN** a typed `asset:bundle-error` JSON message is sent and the host process stays up

### Requirement: Refused sends fail narrowly

A send the channel still refuses SHALL fail only the request that produced it: the server SHALL answer that query with a `resource` error while the session, its subscriptions, and its terminals stay live. Terminal and state lanes carry stream positions and event revisions, so a refused frame there SHALL be terminal for the connection rather than silently desynchronising a client. A send that would exceed the negotiated SCTP maximum SHALL never abort Electron.

#### Scenario: Oversized query answer returns a resource error

- **WHEN** a query answer cannot be sent on the channel
- **THEN** that query returns a `resource` error and the session, subscriptions, and terminals stay live

#### Scenario: Refused terminal frame ends the connection cleanly

- **WHEN** a frame on a terminal or state lane is refused
- **THEN** the connection is failed rather than silently desynchronised

### Requirement: Single connection generation per mounted workspace

The stable session origin SHALL own one WebRTC connection generation for its mounted workspace. Network loss SHALL keep server-owned PTYs and work running. The browser SHALL show reconnecting state, create a fresh authenticated generation, restore subscriptions, and enable input only after hydration completes. The session host SHALL create one generation per connect attempt, shared by pairing or saved-device signaling, bundle install, and the workspace's application `connect`. The workspace SHALL NOT start a second signaling join, peer, or ticket for the same attempt. A `closed` event from a retired generation SHALL NOT start a parallel connect. Automatic recovery, **Retry connection**, document resume, and the initial connect SHALL share one in-flight attempt.

#### Scenario: Input stays disabled until hydration

- **WHEN** a replacement generation is still hydrating
- **THEN** reconnecting state is shown and terminal input remains disabled

#### Scenario: Retired generation cannot fork a connect

- **WHEN** a retired generation emits `closed`
- **THEN** no parallel connect attempt starts

### Requirement: One live connection per device

The server SHALL hold at most one live connection per device. A successful pairing or `device-join` for a device SHALL replace that device's existing peer: the host SHALL close the previous peer and complete its server-side connection cleanup before accepting the replacement. A superseded connection SHALL never outlive, mute, or tear down the resources of the connection that replaced it. Closing a connection SHALL release only what that exact connection owns — its terminal attachments, subscriptions, leases, and checkpoints — and never state belonging to another connection from the same device. Device identity SHALL govern authentication, permissions, and revocation, and SHALL NOT govern connection lifetime.

#### Scenario: Rejoin replaces the previous peer

- **WHEN** the same device joins again
- **THEN** the previous peer is closed and cleaned up before the replacement is accepted

#### Scenario: Late failure of a superseded connection is inert

- **WHEN** a superseded connection fails at any later time
- **THEN** the replacement's live stream, leases, and checkpoints are unaffected

#### Scenario: Second tab takes over

- **WHEN** the workspace is opened in a second tab at the same session origin
- **THEN** that reconnect takes the connection over and the first tab shows reconnecting
- **AND** separate devices, Desktop windows, and Local connections are unaffected

### Requirement: Explicit generation liveness signals

Generation liveness SHALL use explicit signals only. A generation SHALL fail, exactly once, when the peer or ICE connection reports `failed` or `closed`; the ICE `disconnected` grace period expires, where grace starts only when the peer is also not `connected`; a required lane (`control`, `application`, `terminal`, `assets`) leaves `open` after the handshake; the application-protocol reader ends; or the heartbeat bound is exceeded. Traffic patterns SHALL NOT be a liveness signal: quiet PTY output, hydration bursts, and outbound pauses SHALL never be classified, inferred from, or acted on.

#### Scenario: ICE blip while the peer stays connected is ignored

- **WHEN** ICE reports `disconnected` while `connectionState` remains `connected`
- **THEN** the generation is kept and live terminal output continues

#### Scenario: Grace expiry replaces the generation once

- **WHEN** the peer reports `disconnected`, or ICE reports `disconnected` while the peer is also not `connected`
- **THEN** the generation either recovers inside grace or is replaced once without a page reload

#### Scenario: Quiet output is not a failure

- **WHEN** a terminal produces no output for minutes
- **THEN** no traffic-pattern inference is made and the generation stays live

### Requirement: Heartbeat liveness

Liveness SHALL be proven by a heartbeat. The workspace client SHALL send an application-protocol ping every 10 seconds on the live generation and the server SHALL answer on the same lane. Two consecutive missed responses SHALL retire the generation and start recovery. The server SHALL close any connection with no inbound application frames for 60 seconds, so a half-open transport that never fires a close event is still reaped. A healthy but idle workspace SHALL stay connected on pings alone.

#### Scenario: Idle workspace stays connected

- **WHEN** a workspace is healthy but idle for minutes
- **THEN** the heartbeat alone keeps the connection alive

#### Scenario: Stalled transport is detected and recovered

- **WHEN** a transport stops delivering
- **THEN** a missed ping detects it and recovery completes within the heartbeat bound

#### Scenario: Half-open transport is reaped

- **WHEN** no inbound application frames arrive for 60 seconds
- **THEN** the server closes that connection

### Requirement: Live stream integrity after hydration

Live terminal output SHALL share the binary application lane with command results and later workspace events. Attach snapshots, later PTY bytes, new projects, and new terminals SHALL be the same live stream. A generation that hydrates a checkpoint but cannot decode or deliver later events SHALL be failed rather than connected. A new project or terminal created after hydrate SHALL appear on the remote view only while that generation can still deliver. Data-channel frames SHALL be `ArrayBuffer` bytes before the workspace reads them; a `Blob` SHALL be decoded in order or fail that generation visibly, and SHALL never be dropped.

#### Scenario: Hydrated-but-dead generation is failed

- **WHEN** a generation paints a terminal checkpoint but cannot stream later PTY or workspace events
- **THEN** it is treated as a recoverable transport failure and is not left mounted as connected
- **AND** connection and terminal chrome show reconnecting until the replacement generation hydrates

#### Scenario: Post-hydrate creation appears live

- **WHEN** a new project or terminal is created after hydrate on a live generation
- **THEN** it appears on the remote view

#### Scenario: Blob frames are decoded in order

- **WHEN** a data-channel frame arrives as a `Blob`
- **THEN** it is decoded in order or fails that generation visibly, and is never dropped

#### Scenario: Repeated reconnect cycles recover

- **WHEN** at least three reconnect cycles occur in a row during continuous PTY output
- **THEN** each hydrates a checkpoint and then streams new output within the heartbeat bound

### Requirement: Framed PWA resume

Framed PWA resume SHALL use the same reconnect operation. Hiding, freezing, or restoring the session document SHALL NOT leave a painted workspace whose inbound stream is dead. Returning to `app.terminay.com` with a saved framed session SHALL either restore a live generation or show reconnecting or an error with a deadline. The iframe's reload URL SHALL remain the session bootstrap (`/v1/`) rather than a cache-only `/remote-app/` entry that cannot authenticate. Vault `credential.get` SHALL complete or fail visibly inside the host timeout.

#### Scenario: Backgrounded PWA reconnects on return

- **WHEN** the user backgrounds and returns to the installed PWA
- **THEN** the framed session reconnects or shows a bounded retryable error
- **AND** it does not remain on an indefinite loading mark

#### Scenario: Reload enters the session bootstrap

- **WHEN** a browser refresh or iOS iframe restore occurs
- **THEN** the document enters `/v1/` and runs the session host before the workspace

#### Scenario: Vault lookup is bounded

- **WHEN** the framed session requests a vaulted credential
- **THEN** the request completes or fails visibly inside the host timeout

### Requirement: ICE candidate policy

The exposing host SHALL use the same STUN/TURN configuration advertised to browsers. It SHALL advertise ICE host candidates for every usable local address, including loopback, LAN, and VPN overlay addresses, and SHALL NOT bind ICE to a single interface except when signaling itself is loopback. Link-local addresses SHALL be omitted. Diagnostics SHALL never include those candidate addresses.

#### Scenario: VPN overlay connects without TURN

- **WHEN** a phone is on the same VPN overlay as the exposing Desktop
- **THEN** it connects using host ICE candidates without TURN

#### Scenario: Loopback signaling restricts candidates

- **WHEN** signaling itself is loopback
- **THEN** only 127.0.0.1 is used

### Requirement: One handshake at a time per room or session

Signaling SHALL admit one handshake at a time for a pairing room or device session. A second `client-join` or `device-join` SHALL retire an incomplete handshake, and SHALL NOT close an already-authenticated live peer or mix ICE across two offers.

#### Scenario: Second join retires an incomplete handshake

- **WHEN** a second `client-join` or `device-join` arrives while a handshake is incomplete
- **THEN** the incomplete handshake is retired and ICE is not mixed across two offers

#### Scenario: Authenticated peer is not closed by a new handshake attempt

- **WHEN** a new handshake begins while an authenticated live peer exists
- **THEN** that live peer is not closed by the handshake attempt itself

### Requirement: Recovery scope and revocation

Automatic recovery and **Retry connection** SHALL use the same reconnect operation. An expired or revoked device identity SHALL stop recovery and request pairing. Closing one browser tab or Desktop window SHALL affect only that client connection. Device revocation SHALL affect live and future connections.

#### Scenario: Revoked device stops recovering

- **WHEN** the device identity is expired or revoked
- **THEN** recovery stops and pairing is requested

#### Scenario: Revoking one device leaves others alone

- **WHEN** one device is revoked
- **THEN** that device's connection closes and other devices, Local Desktop, and server-owned PTYs are unaffected

### Requirement: Persistence boundaries

The stable session origin, as a first-party document, MAY store the device id and name, the non-extractable browser private key, and non-secret server identity metadata; when the session is framed by the PWA that credential SHALL live in the manager vault instead. The manager origin MAY store manager profiles (label, origin, timestamps) and per-origin framed-session device credentials in IndexedDB. The server MAY store the device id and name, the public device key, the private host key for its session origin, creation, last-seen, and revocation metadata, and security audit events. The signaling service MAY store the public host key or fingerprint for a session and SHALL never store the private host key.

#### Scenario: Signaling never holds the private host key

- **WHEN** signaling records host identity for a session
- **THEN** it stores only the public host key or fingerprint

#### Scenario: One durable key per credential store

- **WHEN** a browser is enrolled
- **THEN** it stores one durable private device key per session origin as a first-party document, or per manager-vault slot when framed
- **AND** the server stores the corresponding public key and revocation state

### Requirement: Hosted services stay data-blind

The signaling service, TURN service, logs, analytics, and URLs SHALL never contain private device keys, private host keys, pairing fragments, PINs, connection tickets, terminal output, project names, paths, filenames, command history, recordings, settings, or secrets. Host `postMessage` SHALL carry only the closed framed-host schema. The manager vault MAY hold per-origin device credentials for framed sessions and MAY clone a credential only to the matching session origin. Hosted services SHALL remain data-blind for Terminay application content.

#### Scenario: Fragment never leaves the client

- **WHEN** pairing completes
- **THEN** the pairing fragment appears in no manager storage, no session URL after consumption, no request, no log, and no analytics event

#### Scenario: Relay sees no application content

- **WHEN** TURN relays packets for a session
- **THEN** it carries only encrypted WebRTC packets and observes no Terminay application content

### Requirement: Metadata-only diagnostics

Hosted WebRTC liveness SHALL be always-on and local. The Desktop Diagnostics folder SHALL record signaling events plus peer and ICE state, ICE disconnect grace, data-channel open and close, and application-lane counters after a client joins. Standalone `terminay-server` SHALL write the same metadata-only events as JSON lines to stderr and, when configured, `--log-sink`. The framed session bootstrap SHALL log the matching client-side counters to the browser console as `[terminay-session]` JSON lines. Traces SHALL include only peer and ICE connection states; data-channel `readyState` for the fixed labels `control`, `application`, `terminal`, `assets`, `asset`, and `api`; inbound and outbound frame counts, byte counts, last-activity age, and buffered amount on the application lane; inbound kind class (`bytes`, `blob`, `string`, `empty`, `other`) and send failure class; and peer close reasons including `replaced-by-rejoin` and `heartbeat-timeout`.

#### Scenario: Traces exclude sensitive material

- **WHEN** diagnostics are recorded
- **THEN** they contain no PTY bytes, typed input, SDP, ICE candidate addresses, pairing URLs, PINs, tickets, session ids, or hostnames

#### Scenario: High-frequency frames do not flood logs

- **WHEN** PTY frames arrive at high frequency
- **THEN** one log line is not produced per frame

#### Scenario: Browser-only diagnosis is possible

- **WHEN** a phone or desktop browser runs a framed session
- **THEN** `[terminay-session]` JSON lines in the console can be copied without a Desktop log folder

### Requirement: Distinct visible failure states

Offline server, signaling failure, relay failure, invalid server identity, invalid bundle, archive transfer failure, and revoked device SHALL be distinct visible errors. An expired or consumed pairing URL SHALL ask the user to generate another one. A missing browser device key SHALL ask for a fresh pairing URL. A revoked device SHALL NOT reconnect until enrolled as a new device. A missing, stale, malformed, replayed, or invalid transport transcript SHALL fail before pairing or device authentication. Failed pairing SHALL leave any PWA manager profile available for retry or forget. Failed reconnect SHALL keep the mounted workspace read-only until recovery or explicit disconnect. Failure SHALL never select another server or terminate server-owned PTYs.

#### Scenario: Each failure class is distinguishable

- **WHEN** a connection fails
- **THEN** the surface distinguishes offline server, signaling failure, relay failure, invalid server identity, invalid bundle, archive transfer failure, and revoked device

#### Scenario: Failed reconnect keeps the workspace read-only

- **WHEN** reconnect fails on a mounted workspace
- **THEN** the workspace stays read-only until recovery or explicit disconnect

#### Scenario: Failure does not switch servers

- **WHEN** any remote-access failure occurs
- **THEN** no other server is selected and no server-owned PTY is terminated

### Requirement: Immutable signed SDP snapshot

The host SHALL sign and signal one immutable SDP snapshot. WebRTC runtime mutation during local-description activation SHALL NOT change the transmitted offer.

#### Scenario: Local-description mutation does not alter the offer

- **WHEN** the WebRTC runtime mutates the local description during activation
- **THEN** the transmitted, signed offer is unchanged

### Requirement: Pairing credential security invariants

Pairing URLs SHALL be short-lived and single-use. The fragment SHALL be consumed in memory and SHALL never be sent in an HTTP request. Pairing SHALL require the fragment plus a PIN or explicit approval, and pairing PIN fields SHALL use a password input so the six-digit code is not shown in the clear. A public session origin, server id, device id, or PIN alone SHALL grant no access.

#### Scenario: PIN entry is masked

- **WHEN** the user enters a pairing PIN
- **THEN** the field is a password input and the six-digit code is not shown in the clear

#### Scenario: Public identifiers grant nothing

- **WHEN** an attacker knows the session origin, server id, device id, or PIN alone
- **THEN** no access is granted

#### Scenario: Fragment never travels over HTTP

- **WHEN** the pairing fragment is processed
- **THEN** it is consumed in memory and never included in an HTTP request

### Requirement: Desktop remote-code containment

Remote server code inside Desktop SHALL have no Node integration and no generic preload authority. Browser private keys SHALL be non-extractable; a first-party session document SHALL bind them to that session origin and a framed PWA session SHALL bind them to the manager vault slot for that exact origin. Full-control remote access SHALL be treated as equivalent to interactive shell access to the selected Terminay Server.

#### Scenario: Remote bundle has no Node access

- **WHEN** a remote server bundle runs inside Desktop
- **THEN** it has no Node integration and no generic preload authority

#### Scenario: Keys are non-extractable

- **WHEN** a browser device key is created
- **THEN** it is non-extractable and bound to its origin or vault slot

### Requirement: Consistent workspace across clients

Local Desktop, remote Desktop, and browser clients connected to one server SHALL observe the same workspace and terminal sessions. Network interruption SHALL reconnect without duplicating PTYs or workspace mutations.

#### Scenario: Same workspace on every client

- **WHEN** Local Desktop, remote Desktop, and a browser connect to one server
- **THEN** they observe the same workspace and terminal sessions

#### Scenario: Interruption does not duplicate state

- **WHEN** a network interruption is recovered
- **THEN** no PTY or workspace mutation is duplicated

### Requirement: Remote access non-goals

Remote access SHALL NOT provide a cloud account or cloud-synchronized connection list, a browser-owned Local server, a reusable pairing link, an independent workspace application at `app.terminay.com`, a generic storage, IndexedDB, or cookie proxy between manager and session, or any merging of PWA vault credentials with first-party session-origin IndexedDB or with Safari's copy of the same origin.

#### Scenario: No generic storage proxy

- **WHEN** a framed session requests storage access through the manager
- **THEN** only the closed framed-host schema is available and no generic storage, IndexedDB, or cookie proxy exists

#### Scenario: Vaults are never merged

- **WHEN** the same origin holds both a first-party credential and a PWA vault credential
- **THEN** they remain separate and are never merged

### Requirement: Outbound delivery recovers from a peer zero receive window

The WebRTC transport SHALL make progress again when a peer's receive window reopens. When the sender has queued outbound data, nothing in flight, and the peer's last advertised receive window is zero, it SHALL transmit exactly one chunk past that window and arm its retransmission timer, so an acknowledgement carrying the reopened window is elicited. The probe SHALL NOT grow the congestion window from its acknowledgement and SHALL remain bounded by the existing retransmission backoff. Outbound delivery SHALL NOT be permanently deadlocked while the peer connection reports connected and every lane reports open.

#### Scenario: Receiver stops draining

- **WHEN** a peer advertises a zero receive window and the sender has queued data with nothing in flight
- **THEN** the sender transmits one probe chunk and arms its retransmission timer rather than going idle

#### Scenario: Window reopens

- **WHEN** the peer's receive window reopens after it drains
- **THEN** outbound delivery resumes without a reconnect and without replacing the connection generation

#### Scenario: Probe does not inflate the window

- **WHEN** a zero-window probe is acknowledged
- **THEN** the congestion window is not grown from that acknowledgement

### Requirement: Serialized data-channel flush

A data-channel flush SHALL be serialized against re-entry. Because the flush draws from a queue shared by every channel of one association and is reachable from both the send path and the association's own callbacks, a flush already running SHALL NOT be entered again concurrently, so sends on one stream cannot interleave.

#### Scenario: Send during a running flush

- **WHEN** a send is issued while a flush of the shared outbound queue is already running
- **THEN** no second flush loop runs concurrently and sends on each stream stay in order

#### Scenario: Two channels flushing

- **WHEN** sends interleave on two channels of one association
- **THEN** each channel's stream is delivered in order

### Requirement: Ordered hash-pinned runtime patch set

The selected WebRTC runtime SHALL be an artifact built by the governed build from a pinned upstream source with an ordered list of patches. Each patch SHALL be pinned by hash and attested in the artifact's provenance, and the ordering SHALL be part of what is attested. The server SHALL validate the selection against that ordered list at load and SHALL refuse a selection whose patch set, order, hashes, or stated purposes do not match. No stage of that governance SHALL assume a fixed number of patches.

#### Scenario: Selection with an unexpected patch set

- **WHEN** the selected runtime's patch list, order, hashes, or purposes do not match the pinned record
- **THEN** the server refuses the selection at load

#### Scenario: Adding a patch

- **WHEN** a further patch is added to the runtime
- **THEN** the build script, selection record, server validation, and release-readiness check accept the extended ordered list without a fixed-count assumption

#### Scenario: Independent rebuild

- **WHEN** the candidate is rebuilt offline from the pinned source mirror a second time
- **THEN** the archive and every file hash are identical to the first build
