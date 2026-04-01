# Termide Remote Access Plan

## Goal

Build secure remote access for Termide using a Vite + React + TypeScript PWA instead of a native iPhone app.

The end result should let a paired browser connect to a Termide host over HTTPS, authenticate strongly, and interact with existing terminal sessions without requiring any hosted Termide account, signaling server, or cloud relay.

## Product Direction

- The remote client is a web app and installable PWA.
- The host can be a Mac, server, or other machine running Termide.
- The browser connects directly to the host over HTTPS and WebSocket.
- Pairing is accountless and serverless.
- QR-based pairing is preferred because it avoids any need for a Termide-operated identity or signaling service.
- Terminal processes remain on the host. The web client only views and controls host-side PTYs.
- Assume a modern browser and design one strong path rather than maintaining fallback auth paths.

## Fixed Decisions

- WebAuthn with `userVerification: "required"` is mandatory on every terminal connection.
- There is no fallback auth path for unsupported or older browsers.
- Each paired browser stores both:
  - a non-extractable WebCrypto device key
  - a separate WebAuthn credential
- Pairing is tied to one exact origin.
- If IndexedDB key material is lost, the browser must re-pair via QR.
- Multiple remote browser connections per paired device are allowed.
- Multiple attached terminal sessions per remote browser are allowed.
- Opening a new browser tab requires a fresh WebAuthn ceremony before it gains terminal access.
- The authenticated WebSocket is established only after a successful HTTPS auth flow.
- Do not use long-lived session tokens or alternative password/PIN/magic-link flows.
- iPhone Safari is the primary supported browser for v1; other modern browsers are best-effort.

## High-Level Architecture

### Components

1. Termide host app
   - Owns PTY and session lifecycle.
   - Runs an HTTPS server and authenticated WebSocket endpoint.
   - Manages paired devices, pairing sessions, and trust records.
   - Streams terminal events to authenticated clients.

2. Browser client / PWA
   - React UI for pairing, session list, output, and input.
   - Generates and stores a device keypair locally with WebCrypto.
   - Uses WebAuthn with user verification before opening a terminal connection.
   - Connects to the host over HTTPS and WSS.

3. Pairing / trust subsystem
   - Short-lived pairing session initiated on the host.
   - QR-code-based bootstrap.
   - One browser installation equals one trusted device identity.

## Security Model

### Desired properties

- All traffic is encrypted in transit.
- The browser verifies the host using normal TLS certificate validation.
- The host authenticates the browser before allowing terminal access.
- A stolen bearer token should not be enough to impersonate a device.
- The private device key should remain on-device and non-exportable.
- A disconnected client should re-authenticate rather than resume a privileged session.
- If a phone is stolen while merely unlocked, starting a new terminal connection should still require Face ID, Touch ID, or device passcode.

### Transport model

Use standard HTTPS plus authenticated WebSocket.

- The host serves the app and API over HTTPS.
- Terminal traffic runs over WSS.
- The authenticated WebSocket is the live session.
- If the socket drops, the client runs the full auth flow again.
- Do not rely on long-lived resumable bearer sessions for terminal access.

### TLS and host identity

- The host should use a normal signed TLS certificate whenever practical.
- If the user has a valid DNS setup such as `mymac.example.com`, the browser can rely on ordinary certificate validation.
- The browser should never ignore certificate warnings.
- All remote access endpoints must require HTTPS and WSS only.

### Device identity

The browser should generate a device keypair during pairing.

- Use WebCrypto.
- Make the private key non-extractable.
- Store the key as a `CryptoKey` in IndexedDB.
- Never store raw private key material in `localStorage`, cookies, or plain IndexedDB records.
- The host stores the paired device public key and metadata.

This gives us durable device identity without exposing raw private key bytes to application code for export.

### User presence and local unlock

Device identity alone is not enough. Starting a terminal connection should also require local user verification.

- Use WebAuthn or passkeys with `userVerification: "required"`.
- Require this check before opening a terminal WebSocket.
- Re-run this check on every reconnect.
- Treat this as the protection against "someone picked up my unlocked phone and tried to open Termide."

### Session model

- The host keeps PTYs alive independently of client connections.
- Browser connections are disposable.
- Disconnecting must not kill the real terminal unless explicitly requested.
- Multiple simultaneous browser connections are allowed for the same paired device.
- Each new browser tab or connection must complete a fresh auth flow before it can access terminals.
- Reconnect means:
  - fetch a fresh challenge
  - prove possession of the paired device key
  - complete WebAuthn user verification
  - open a new authenticated WebSocket

### Revocation

- The host maintains a list of paired devices.
- Removing a device invalidates future signed challenges from that device key.
- The host can terminate live connections from a revoked device immediately.

## Pairing Flow

### User experience

1. User clicks `Pair Device` in Termide.
2. Termide creates a short-lived pairing session.
3. Termide shows a QR code.
4. The browser opens the pairing URL, typically by scanning the QR code.
5. The browser generates a non-extractable device keypair with WebCrypto.
6. The browser sends its public key plus the pairing token to the host.
7. The host verifies the token and stores the trusted device record.
8. The browser stores the device private key in IndexedDB.
9. The device appears in a `Paired Devices` list in Termide.

### QR payload contents

The QR code should contain only bootstrap material, not long-lived secrets.

Suggested payload:

- `host`
- `pairingUrl`
- `pairingToken`
- `pairingExpiresAt`
- `pairingSessionId`

### Pairing token rules

- Single use.
- Short TTL, e.g. 5-10 minutes.
- Bound to the pairing session.
- Deleted once used or expired.

## Authentication Flow

### Connection flow

1. Browser loads the HTTPS app from the host.
2. Browser requests a fresh authentication challenge.
3. Host returns:
   - random nonce
   - challenge ID
   - expiry
   - hostname / origin to bind against
4. Browser signs the challenge using the paired non-extractable device key.
5. Browser completes WebAuthn with user verification required.
6. Browser submits:
   - challenge ID
   - device signature
   - WebAuthn assertion
   - device ID
7. Host verifies:
   - challenge validity
   - public-key signature
   - WebAuthn result
   - device trust status
8. Browser opens the authenticated WebSocket.
9. Host marks that WebSocket as authenticated for that device.

### Challenge design

Each signed challenge should cover:

- nonce
- challenge ID
- device ID
- origin / hostname
- issued-at time
- expiry time
- intended action, e.g. `open-terminal-session`

Rules:

- single use
- very short TTL
- reject stale or replayed submissions

### WebSocket authentication

- Authenticate before allowing terminal actions.
- Treat the WebSocket connection itself as the privileged session.
- Validate the `Origin` header.
- Reject requests from untrusted origins.
- Avoid long-lived session cookies for terminal access.
- If a short-lived handshake cookie is needed, mark it `Secure`, `HttpOnly`, and `SameSite=Strict`.

## Connection Model

### Transport

Use HTTPS for app loading and API requests, and WSS for terminal traffic.

Reasons:

- Terminal traffic is stream-like.
- The browser platform handles HTTPS and WSS well.
- We avoid custom native socket work.
- We can re-auth cleanly whenever the socket is recreated.

### Host binding

- Support normal direct hostnames and ports.
- The plan should not assume Tailscale specifically.
- Users may expose Termide through their own DNS, VPN, LAN, or reverse proxy setup.
- Termide should focus on secure application-layer auth rather than managing the user's network stack.

## Application Protocol

TLS gives us a secure transport, but we still need framing and message types.

### Framing

Use JSON messages over WebSocket for the first version.

This is easy to debug and evolve.

### Base message shape

```json
{
  "type": "write",
  "connectionId": "uuid",
  "seq": 42,
  "sessionId": "terminal-session-id",
  "payload": "ls -la\n"
}
```

### Core message types

Client to server:

- `list-sessions`
- `attach-session`
- `detach-session`
- `create-session`
- `close-session`
- `write`
- `resize`
- `ping`

Server to client:

- `session-list`
- `session-opened`
- `session-closed`
- `session-updated`
- `output`
- `exit`
- `error`
- `pong`

### Sequence numbers

Each connection should have a monotonically increasing client sequence number.

The server should:

- track the highest accepted `seq`
- reject duplicates
- reject obviously stale or replayed frames

### Session attachment model

- A device may list current sessions.
- A device may attach to multiple sessions.
- The host remains the source of truth for PTY lifecycle.

## Terminal Behavior

### PTY ownership

The host app remains the source of truth for PTY lifecycle.

The browser client must never spawn local shell processes. It only controls existing PTYs hosted by Termide.

### Output handling

For each attached session, the host streams:

- output chunks
- exit notifications
- title/color metadata updates if needed

### Input handling

The browser sends:

- raw input bytes
- resize events
- control actions like interrupt if supported

### Resize policy

There is an important product decision here:

- Option A: remote resize changes the actual PTY size
- Option B: remote client is view-only for dimensions and does not resize the PTY
- Option C: whichever client is active owns dimensions

Recommended first version:

- The active attached client controls PTY size while attached.

## Device Management UI

The host app should expose:

- `Pair Device`
- `Paired Devices`
- device nickname
- paired date
- last seen
- revoke/remove device

The PWA should expose:

- known hosts
- trust status
- connection count in the header, e.g. `3 connections`
- a connection list showing active remote connections and attached sessions
- revoke/close selected live connections
- remove this pairing locally
- reconnect status

## PWA Requirements

- Build as Vite + React + TypeScript.
- Support installable PWA behavior where browser support allows it.
- Work well on iPhone Safari and desktop browsers.
- Keep the UI mobile-friendly first, without assuming native wrappers.
- Handle IndexedDB absence or key loss gracefully by prompting the user to re-pair.

## Suggested File / Module Boundaries

Host side:

- `remote/pairing.ts`
  - pairing sessions and QR payloads
- `remote/deviceStore.ts`
  - paired devices, revocation, metadata
- `remote/challengeStore.ts`
  - one-time auth challenges and replay protection
- `remote/httpServer.ts`
  - HTTPS server and app/API serving
- `remote/wsServer.ts`
  - authenticated WebSocket handling
- `remote/connectionStore.ts`
  - active remote connection metadata and revocation
- `remote/protocol.ts`
  - message schemas and encode/decode helpers
- `remote/sessionBridge.ts`
  - PTY/session to remote-client event bridging

PWA side:

- `services/pairing.ts`
  - QR bootstrap and pairing flow
- `services/deviceKeys.ts`
  - WebCrypto key generation and IndexedDB storage
- `services/webauthn.ts`
  - passkey / WebAuthn user verification
- `services/auth.ts`
  - challenge signing and connect flow
- `services/socket.ts`
  - authenticated WebSocket lifecycle
- `features/terminal/*`
  - terminal UI and state

## Implementation Phases

### Phase 1: HTTPS and trust foundation

Deliverables:

- HTTPS server for remote UI and API
- QR pairing flow
- device public/private key generation in browser
- non-extractable key storage in IndexedDB
- trusted device store on host
- successful signed challenge verification from browser

### Phase 2: WebAuthn gate and authenticated WebSocket

Deliverables:

- WebAuthn setup and user verification
- combined device-key + WebAuthn auth flow
- authenticated WebSocket connection
- reconnect path with full re-auth
- replay protection for challenges
- exact-origin trust enforcement

### Phase 3: Terminal read-only remote view

Deliverables:

- session list
- attach to session
- receive output
- disconnect/reconnect handling
- heartbeat / keepalive

### Phase 4: Terminal input and session control

Deliverables:

- input writes
- resize
- create/close session actions if desired
- sequence validation
- error handling for stale sessions

### Phase 5: Device management and hardening

Deliverables:

- paired devices UI
- revoke device
- local pairing reset
- better diagnostics
- audit logging
- CSP and browser hardening review

## Risks And Design Notes

### 1. Browser storage durability

IndexedDB is the right place to store a non-extractable device key, but browser storage is not perfectly durable forever.

Mitigation:

- handle missing keys cleanly
- allow re-pairing without damaging host PTYs
- avoid assuming persistent browser storage is infallible

### 2. XSS remains the main browser risk

Non-extractable keys reduce export risk, but malicious script running in our origin may still be able to misuse authenticated flows.

Mitigation:

- strict CSP
- minimize third-party scripts
- avoid unsafe HTML rendering
- keep the app surface small and review terminal-adjacent UI carefully

### 3. WebAuthn platform behavior

WebAuthn is useful for user verification, but browser UX and support details vary by platform.

Mitigation:

- build the auth flow to fail clearly
- test iPhone Safari early
- keep the pairing and reconnect UX simple
- do not add fallback auth paths for unsupported browsers

### 4. No session resumption

Re-auth on every reconnect is simpler and safer, but it can add friction.

Mitigation:

- keep the ceremony fast
- preserve host-side PTYs so reconnecting is cheap
- avoid trying to make browser auth invisible at the cost of weaker security

### 5. Host certificate setup

HTTPS is strongest when the host has a real trusted certificate, but that depends on the user's DNS/network setup.

Mitigation:

- support valid custom hostnames cleanly
- document that certificate warnings must never be bypassed
- keep the app protocol independent of any one DNS or VPN provider

## Checklist

### Architecture

- [x] Decide the exact deployment shapes we want to support: LAN, VPN, reverse proxy, direct hostname.
- [x] Decide whether v1 supports read-only mode, full input mode, or both.
- [x] Decide the PTY resize ownership rule for simultaneous desktop + remote usage.
- [x] Require WebAuthn on every terminal connect with no fallback.
- [x] Pair each browser with both a WebCrypto device key and a WebAuthn credential.
- [x] Tie pairing to one exact origin.
- [x] Force full re-pair if browser key material is lost.
- [x] Allow multiple remote browser connections per paired device.
- [x] Allow multiple attached sessions per remote browser.
- [x] Require fresh WebAuthn for each new browser tab/connection.
- [x] Use HTTPS auth flow before opening authenticated WebSocket, with no resumable session token.
- [x] Avoid all password/PIN/magic-link fallback auth paths.
- [x] Treat iPhone Safari as the primary browser target for v1.

### Host App Foundations

- [x] Create a remote access module boundary in the host app.
- [x] Add an HTTPS server for the remote UI and API.
- [x] Add a trusted device store.
- [x] Add a pairing session store with expiry and single-use enforcement.
- [x] Add a one-time challenge store with replay protection.
- [x] Add an authenticated WebSocket server.

### Pairing

- [x] Add `Pair Device` UI to the host app.
- [x] Generate QR payloads with pairing URL, token, expiry, and host details.
- [x] Add QR rendering in the host app.
- [x] Implement browser device key generation with WebCrypto.
- [x] Store the private key as non-extractable in IndexedDB.
- [x] Register and persist a WebAuthn credential for the paired browser.
- [x] Submit the public key and pairing token to the host.
- [x] Persist trusted device metadata on the host.

### Authentication

- [x] Define the signed challenge payload.
- [x] Implement challenge issuance with short expiry and single-use enforcement.
- [x] Implement browser challenge signing with the stored device key.
- [x] Add WebAuthn user verification with `userVerification: "required"`.
- [x] Verify both the device-key signature and the WebAuthn assertion on the host.
- [x] Re-run the full auth flow on every reconnect.
- [x] Re-run WebAuthn for each new browser tab before terminal access.
- [x] Validate `Origin` on WebSocket requests.
- [x] Enforce exact-origin matching during pairing and auth.
- [x] Avoid durable bearer tokens for terminal access.

### Protocol

- [x] Define JSON message format over WebSocket.
- [x] Define `list-sessions`.
- [x] Define `attach-session`.
- [x] Define `write`.
- [x] Define `resize`.
- [x] Define `output`.
- [x] Define `exit`.
- [x] Add per-connection sequence validation.
- [x] Add structured error messages.

### PTY Bridge

- [x] Bridge Termide session list into the remote server.
- [x] Stream session metadata updates.
- [x] Stream output bytes to attached clients.
- [x] Forward input bytes from authenticated clients to the PTY.
- [x] Handle PTY close/exit cleanup.

### PWA

- [x] Create the Vite + React + TypeScript remote client.
- [x] Add host list / pairing state UI.
- [x] Add connection state UI.
- [x] Add terminal session list UI.
- [x] Add terminal output rendering.
- [x] Add terminal input composer.
- [x] Add terminal resize handling.
- [x] Add reconnect handling after network interruption.
- [x] Handle lost IndexedDB identity by prompting for re-pair.

### Hardening

- [x] Add CSP and review browser security headers.
- [x] Ensure cookies, if used at all, are `Secure`, `HttpOnly`, and `SameSite=Strict`.
- [x] Avoid storing secrets in `localStorage`.
- [x] Add audit logging for pairing, auth, revoke, and connect events.
- [x] Ensure revocation closes live connections for that device.
- [x] Add active-connection management UI and server-side connection revocation.
