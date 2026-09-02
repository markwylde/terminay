## 1. Protocol contract

- [x] 1.1 Add `deriveMatchCode(fragment, clientNonce, hostPublicKey, devicePublicKeyDer)` to `packages/protocol` with the HKDF label, HMAC input order, and 32-symbol alphabet from design D2, verified by deterministic vectors shared with the browser shell
- [x] 1.2 Add the `device-join` proof payload builder and verifier (`"terminay remote v1 device join"`, session id, client nonce; RSA-PSS SHA-256) and the approval message shapes (`pending`, `enrollment-approved`, `enrollment-denied`) to `packages/protocol`, verified by parser tests that reject unknown fields and oversized values
- [x] 1.3 Bump `AUTHENTICATED_WEBRTC_TRANSPORT_VERSION` to 2 and verify a version-1 client or server fails visibly against a version-2 peer in the conformance suite

## 2. Server approval and PIN removal

- [x] 2.1 Add a pending-approval store to `ServerRemoteExposure` (one per room, 120 s expiry, peer id, device name, public key, match code) with `requestEnrollment`, `approveEnrollment`, `denyEnrollment`, and cleanup, verified by unit tests covering approve, deny, expiry, room rotation, and a second request while one is pending
- [x] 2.2 Change `/api/devices/enroll` in `hostedPairingHost.ts` to create a pending approval and answer `pending`, and push `enrollment-approved` with the ticket or `enrollment-denied` on the same peer's `api` channel, verified by an end-to-end pairing test
- [x] 2.3 Remove `pairingPinMatches`, the `pin` and `verifyPairingPin` options, `TERMINAY_REMOTE_PAIRING_PIN` handling in `cliOptions.ts` and `cli.ts`, the `pairingPin` field in `localUiServer.ts`, and delete `electron/remote/pin.ts` and `pinGuard.ts`, verified by a grep gate in the security tests that no PIN symbol remains and by an error when the env var is set
- [x] 2.4 Drop `pairingPinHash` and `pinFailureLimit` from `RemoteAccessSettings`, ignore them on read, and delete the verifier file at Desktop startup, verified by a settings-migration test
- [x] 2.5 Add `approve <approvalId>` and `deny <approvalId>` to the standalone control socket and print pending requests as metadata-only JSON lines, verified by a control-endpoint test that the line carries only device name, code, and id

## 3. Peer lifecycle, tickets, and gating

- [x] 3.1 Move `livePeers.close(deviceId)` from `addHandshakePeer` to `bindControl` after `consumeConnectionTicket` succeeds and before `acceptApplication`, verified by a test that an unauthenticated `device-join` leaves the live peer's terminal stream flowing
- [x] 3.2 Verify the `device-join` proof in `handleDeviceSignal` before `startPeer`, remembering client nonces for the transcript lifetime, verified by tests for missing, wrong-key, and replayed proofs
- [x] 3.3 Replace the single `handshake` slot with a map keyed by room or session id, a global cap of four, and a 60 s timeout, verified by tests that a fifth join is refused and an existing handshake for another room is untouched
- [x] 3.4 Record `peerId` on tickets at issue and require it at `consumeConnectionTicket`, marking a mismatched ticket used, verified by a two-peer replay test
- [x] 3.5 Answer only `/api/devices/*` on `bindApi` before a ticket is consumed and wire host context and archive lanes after consumption, verified by a test that an unticketed peer receives no archive bytes and no host context

## 4. Host key protection and identity reset

- [x] 4.1 Introduce `HostKeyStore` with the file backend for standalone and a safeStorage backend on Desktop reusing `ProtectedValueCodec`, migrating an existing plaintext key once and refusing exposure when protected storage is unavailable, verified by tests for fresh, migrated, and unavailable cases
- [x] 4.2 Add `resetServerIdentity` to `ServerRemoteExposure` that rotates the key, revokes every device, closes live peers, re-registers `device-host-ready`, and audits `identity-reset`, exposed as a Remote Control action and `terminay-server reset-identity`, verified by a test that every device's next reconnect reports a host identity change

## 5. Desktop authenticated-channel client

- [x] 5.1 Add an `api` lane to `desktopWebRtcTransport.ts` speaking `api-request`/`api-response` and expose it as a `RemoteApiTransport`, verified by a unit test against the hosted host's `bindApi`
- [x] 5.2 Add `pairing` mode to `createDesktopBootstrappedWebRtcConnection`: derive secrets with `deriveHostedPairingSecrets`, send `client-join` with a fresh nonce, verify the pairing authenticator, and return the pinned host key via `onPinned`, verified by the shared vectors and the adversarial signaling harness
- [x] 5.3 Add the `device-join` proof to Desktop `device` mode and run challenge, verify, and application auth over the `api` and `control` lanes, verified by a reconnect test that asserts no HTTPS request leaves the host
- [x] 5.4 Route `establishDesktopDevicePairing` and `createDesktopReconnectTransport` through the WebRTC client for every non-loopback origin and store the host key with `saveDeviceIdentity`, keeping HTTPS only for loopback, verified by tests for both origins
- [ ] 5.5 Show the match code in Desktop **Add connection** while awaiting approval and drop `pairingPin` from `connection.pair` in `nativeActions.ts` and `main.ts`, verified by the Electron e2e suite run through `npm run test:e2e`

## 6. Host UI and CLI surfaces

- [x] 6.1 Replace the PIN modal in `RemoteExposurePanel.tsx` and the PIN field in `RemotePairingModal.tsx` with the pending-approval view (device name, match code, Approve, Deny) that swaps in for the QR and restores a fresh QR after the decision, verified by component tests
- [ ] 6.2 Add pending approvals and **Reset server identity** to the Remote Control Exposure cards and raise a Desktop notification on a new request that opens Remote Control on it, verified by the Electron e2e suite
- [x] 6.3 Update `docs/operations/standalone-server.md` and `docker-pairing-smoke.md` to remove the PIN variable and document approval over the control socket, verified by the docker pairing smoke passing without the variable

## 7. Security evidence and external contract

- [x] 7.1 Extend the adversarial signaling harness with Desktop pairing and reconnect, a captured-QR race showing differing match codes, an unauthenticated `device-join` against a live peer, and ticket replay across peers, verified by every case failing closed
- [ ] 7.2 Publish the version-2 contract (match code vectors, `device-join` proof, approval shapes) to the hosted browser shell and relay owners and record their conformance run under `openspec/adr/evidence/`, verified before this change is archived
- [ ] 7.3 Run `openspec validate --all` and the full security test lane, verified green in CI
