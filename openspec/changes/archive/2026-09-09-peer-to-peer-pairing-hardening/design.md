## Context

The 2026-09-02 audit confirmed the transport-authentication contract from the
end-to-end host authentication change is implemented correctly in the shared
verifier and in the server-owned hosted pairing host, but found that the trust
model is only as strong as its weakest client path and its cheapest second
factor. Five findings rated medium or above are in scope here:

1. Desktop **Add connection** and reconnect run `enroll`, `challenge`,
   `verify`, and ticket delivery over HTTPS `fetch` to
   `https://<session>.terminay.com`, an origin the hosted relay terminates,
   and never pin the host key (`electron/remote/desktopPairing.ts`,
   `desktopReconnect.ts`, `electron/main.ts`).
2. The PIN is checked in `pairingPinMatches` before the pairing store is
   consulted, so failures never lock the room; the CLI path compares plaintext
   and the Desktop path runs synchronous scrypt per attempt.
3. `addHandshakePeer` closes a device's live peer on `device-join` arrival,
   before the joiner authenticates.
4. `bindApi` and `bindUiArchiveChannels` serve `/api/host-context` and the
   full archive to any DTLS peer, and any join retires the single handshake.
5. `loadOrCreateHostedHostKey` writes the Ed25519 private key as plaintext
   JSON, on Desktop beside safeStorage-protected device keys, with no
   rotation path.

The browser session shell (the `/v1/` page) and the signaling relay live
outside this repository. Their behaviour is fixed by the `remote-access` spec
and by shared vectors in `packages/protocol`; this change extends that contract
and treats it as the integration boundary.

Boundaries crossed, per ADR-0011: Server ↔ remote device/WebRTC (all five),
Server ↔ hosted signaling (1, 3, 4), vault/logging → operators (5), and
authenticated client → extension/environment management (ticket binding).

## Goals / Non-Goals

**Goals:**

- Every credential-bearing message on every client path travels only on a data
  channel whose offer transcript the client verified.
- Replace the PIN with a second factor that is bound to the exact enrolling
  device key, cannot be brute-forced, and cannot be phished by a crafted link.
- A live device cannot be disconnected by anyone who has not authenticated as
  that device.
- Nothing beyond the non-secret bootstrap record is served to a peer without a
  consumed ticket, and handshake resources are bounded.
- The host key is as protected as the device keys it anchors, and an operator
  can deliberately reset server identity.

**Non-Goals:**

- Changing the transport transcript format or the HKDF label set from the
  previous change.
- Replacing werift or the DTLS stack.
- Fixing the Low findings (the `app.*` manager-hostname rule survives only as
  a label mapping once the PIN is gone; it is no longer a credential path).
- Zero-interaction pairing. The user chose host approval.

## Decisions

### D1. Desktop becomes a second implementation of the browser shell contract

Desktop's hosted pairing and reconnect will join signaling itself and run the
device API over the `api` data channel of the transcript-verified peer. The
existing `createDesktopBootstrappedWebRtcConnection` already opens signaling
and gates `setRemoteDescription` through `AuthenticatedWebRtcOfferVerifier`;
it gains:

- a `pairing` mode that derives room id, pairing token, and relay-join token
  from the fragment with `deriveHostedPairingSecrets`, sends `client-join` with
  a fresh nonce, and verifies the pairing authenticator;
- a `device` mode that sends `device-join` with the device-key proof (D4) and
  verifies against the pinned host key;
- an `api` lane in `desktopWebRtcTransport.ts` exposing `postJson` over the
  `api-request`/`api-response` frames the hosted host already speaks, so
  `establishDevicePairing` and `authenticateDevice` in
  `src/remote/services` run unchanged with a data-channel `RemoteApiTransport`.

`establishDesktopDevicePairing` and `createDesktopReconnectTransport` keep
their HTTPS clients only when the origin is loopback HTTP, which is the
embedded local-UI server. For any HTTPS origin they route through the WebRTC
client and return the pinned host key from `onPinned`, which
`enrollPairedDesktopRemoteProfile` stores through `saveDeviceIdentity`.

Alternative considered: have the hosted service proxy the HTTPS device
endpoints to the server over signaling. Rejected because it makes the relay a
credential path, which ADR-0011 forbids, and because it needs code outside
this repository to hold secrets.

### D2. Host approval with a device-bound match code replaces the PIN

The second factor becomes an approval on the exposing host of a code both
sides derive:

```
matchKey  = HKDF-SHA256(ikm = fragment, salt = "", info = "terminay remote v1 match code")
code      = HMAC-SHA256(matchKey, clientNonce || hostPublicKey || SHA256(devicePublicKeyDer))
render    = first 25 bits of code → 5 symbols from "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
```

The server derives it when `/api/devices/enroll` arrives on an authenticated
pairing peer, creates a **pending approval** in `ServerRemoteExposure`
(room id, device name, device public key, code, peer id, expiry 120 s), and
answers the client with `{ status: 'pending', approvalId }`. The client derives
the same code locally and displays it. The host UI shows name and code with
Approve and Deny. Approve calls `remote.approveEnrollment(approvalId)`, which
runs the existing `enrollDevice`, issues the ticket, and pushes
`{ type: 'enrollment-approved', ticket }` on the same peer's `api` channel.
Deny or expiry pushes `enrollment-denied` and consumes nothing.

Why a code and not just "Approve this device": binding the code to the device
public key means an attacker who captured the QR and raced the legitimate
device produces a different code on the host than the user sees on their own
phone, so the user can tell which request is theirs. Why 25 bits: five symbols
are readable at a glance and the attacker gets exactly one guess per approval
window because the room admits one pending request at a time.

Why derive from the fragment rather than only from the transcript: the fragment
is the one input the relay never sees, so a relay that fakes a pending request
cannot make the host display a code that matches anything the user's device
shows.

PIN removal touches `cliOptions.ts` (`TERMINAY_REMOTE_PAIRING_PIN` becomes an
error if set), `cli.ts` (`requiresRemotePairingPin`, `matchesPairingPin`,
`pin:` option), `hostedPairingHost.ts` (`pairingPinMatches`,
`verifyPairingPin` option), `localUiServer.ts` (`pairingPin` field),
`electron/remote/pin.ts` and `pinGuard.ts` (deleted), `settings.ts`
(`pairingPinHash`, `pinFailureLimit` removed and dropped on read),
`electron/main.ts` (verifier file removed at startup), `nativeActions.ts`
(`connection.pair` loses `pairingPin`), and the Exposure and Pair Device
surfaces. The standalone CLI prints the pending request as a metadata-only
line and accepts `terminay-server approve <approvalId>` / `deny` /
`approvals` over an owner-only stream socket inside the data root
(`approval.sock`). The existing control socket is Desktop-only and scoped to
per-terminal MCP tokens, so it is not reused for administrative approval.

Alternative considered: keep the PIN and add lockout. Rejected by the user and
because a fixed user-chosen PIN sent to whichever host a link names is still
phishable.

### D3. Replace a live peer only after the replacement authenticates

`addHandshakePeer` stops calling `livePeers.close(deviceId)` up front. The
handshake peer is tracked separately; `bindControl`, after
`consumeConnectionTicket` succeeds and before `acceptApplication`, awaits
`livePeers.close(ticket.deviceId)` and then registers the new peer. The
ordering guarantee from the previous change (old cleanup completes before the
new connection attaches) is preserved because the await sits before
`acceptApplication`. An unauthenticated joiner therefore holds only a handshake
slot, never the device's live slot.

### D4. Relay admits `device-join` only with a device-key proof

The `device-join` message gains `deviceProof`: an RSA-PSS signature by the
device key over `"terminay remote v1 device join" \n sessionId \n clientNonce`.
The relay cannot verify it (it has no device public keys and must stay
data-blind), so the server verifies it inside `handleDeviceSignal` before
creating a peer, and the relay contract requires the field to be present and
bounded. This keeps the relay data-blind while ensuring that a `device-join`
without the device key never reaches `startPeer`. Replay is bounded by the
client nonce, which the server remembers for the transcript lifetime.

Alternative considered: have the relay verify against a public key registered
by the host. Rejected because it gives the relay a durable per-device record
and a reason to hold state that ADR-0011 wants to keep to bounded DoS.

### D5. Ticket-gated bootstrap and bounded handshakes

`bindApi` answers only `/api/devices/*` on a peer without a consumed ticket;
`/api/host-context` and the archive lanes are wired after
`consumeConnectionTicket` succeeds on that peer. `HostedPairingHost` keeps a
handshake map keyed by room or session id rather than a single `handshake`
variable, with a global cap of four and a 60 s timer per entry. Tickets record
`peerId` at issue time and `consumeConnectionTicket` takes the presenting peer
id; mismatch marks the ticket used and fails.

### D6. Host key protection and identity reset

`hostedHostKey.ts` gains a `HostKeyStore` interface with two backends: the
existing owner-only file for standalone, and a safeStorage-encrypted file on
Desktop that reuses the `ProtectedValueCodec` from `deviceCredentialStore.ts`.
Desktop refuses exposure when the codec is unavailable or `basic_text`,
matching the device-key rule. **Reset server identity** in Remote Control and
`terminay-server reset-identity` generate a new key, call
`revokeDevice` for every device, close every live peer, re-register
`device-host-ready` with the new key, and audit `identity-reset`.

## Risks / Trade-offs

- [Browser shell and relay are external] → The `packages/protocol` conformance
  vectors gain match-code and `device-join` proof cases, and the change is not
  archived until the hosted service reports passing them.
- [Approval adds a step to every first pairing] → The pending request replaces
  the QR in the same dialog and Desktop raises a notification, so the
  administrator is already looking at the surface that needs the tap.
- [Match code collision: 1 in 33.5 million per attempt] → One pending request
  per room and a 120 s window make it a one-shot guess.
- [Desktop WebRTC client complexity grows] → It reuses the shared verifier,
  `deriveHostedPairingSecrets`, and the transport-neutral device flow; only the
  signaling join and the `api` lane are new.
- [Host-key migration on Desktop] → On first launch the plaintext key is read,
  written through safeStorage, and the plaintext file is removed; if
  safeStorage is unavailable the key stays and exposure is refused with a
  visible reason rather than silently downgrading.
- [Removing `pairingPinHash` from settings] → The field is dropped on read and
  the verifier file deleted; no data a user needs is lost.

## Migration Plan

1. Land protocol additions (match code, `device-join` proof, approval message
   shapes, ticket peer binding) with vectors.
2. Land server-side approval, deferred replacement, ticket gating, bounded
   handshakes, host-key store, and identity reset behind the existing
   transport version; bump `AUTHENTICATED_WEBRTC_TRANSPORT_VERSION` to 2 so a
   browser shell or Desktop without the new contract fails visibly rather than
   silently pairing without approval.
3. Land Desktop data-channel client and UI, remove the PIN.
4. Hosted service adopts version 2 (match-code display, `device-join` proof
   field). Rollback is the previous version pair on both sides; there is no
   partial-version mode.

## Open Questions

- Resolved during implementation: the standalone server has no control socket
  of its own, so approval uses a dedicated owner-only socket in the data root.
- None of the in-force ADRs need revisiting. ADR-0011's remote-device row
  reads "PIN/approval"; the adr step records the approval-with-match-code
  decision and the data-channel-only credential rule as a new ADR rather than
  editing ADR-0011.
