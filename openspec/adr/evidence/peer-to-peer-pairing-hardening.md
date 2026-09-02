# Evidence: peer-to-peer pairing hardening (transport contract version 2)

Supports [ADR-0013](../0013-device-bound-host-approval-and-channel-only-credentials.md).

## What is proven in this repository

Every proof below runs the production hosted pairing host
(`apps/terminay-server/src/remote/hostedPairingHost.ts`) against a real
loopback Werift peer through an in-process relay that only forwards frames by
type (`scripts/support/hostedLoopbackRelay.mjs`). The relay never parses a
transcript and the assertions check its frame log for leaked material.

| Claim | Test |
| --- | --- |
| Match-code derivation is deterministic, bound to fragment, nonce, host key, and device key, and rendered from the 32-symbol alphabet | `packages/protocol/test/pairing-approval.test.mjs` |
| `device-join` proof payload and approval message shapes are closed | `packages/protocol/test/pairing-approval.test.mjs` |
| Enrollment parks until approval; deny, expiry, rotation, and peer closure enroll nothing; one request per room; tickets are peer-bound; identity reset revokes everything | `apps/terminay-server/test/pairing-approval.test.mjs` |
| Approval socket lists metadata only and applies approve/deny once | `apps/terminay-server/test/approval-socket.test.mjs` |
| Browser-shell contract end to end: host context is refused before a ticket, a racing second device is refused, the host and device derive the same code, the relay never sees the code or pairing token, a bogus `device-join` proof yields no offer and leaves the live peer untouched, the live peer is replaced only after the replacement consumed its ticket, and a ticket earned by one peer fails on another | `apps/terminay-server/test/hosted-pairing-approval-flow.test.mjs` |
| Desktop pairs on the authenticated channel with no HTTP request, shows the same code the host shows, pins the host key beside the device key, reconnects with the device-join proof, and refuses a changed host key | `scripts/desktop-hosted-connection.test.mjs`, `scripts/desktop-hosted-pairing-url.test.mjs` |
| Shared device flow: pending response, match-code display, approval, denial, and refusal without an authenticated lane | `scripts/device-pairing-flow.test.mjs` |
| A build cannot advertise remote access without contract version 2 | `scripts/authenticated-webrtc-release-evidence.test.mjs` |
| A leftover `TERMINAY_REMOTE_PAIRING_PIN` makes the standalone server refuse to start | `apps/terminay-server/test/standalone-pairing-handoff.test.mjs` |

Run them with:

```sh
npm run build:workspaces
node --test packages/protocol/test/pairing-approval.test.mjs \
  apps/terminay-server/test/pairing-approval.test.mjs \
  apps/terminay-server/test/approval-socket.test.mjs \
  apps/terminay-server/test/hosted-pairing-approval-flow.test.mjs \
  scripts/desktop-hosted-connection.test.mjs \
  scripts/desktop-hosted-pairing-url.test.mjs \
  scripts/device-pairing-flow.test.mjs
```

The two loopback WebRTC tests need the selected runtime staged at
`build/webrtc-runtime/artifact` (`npm run test:webrtc-runtime-selection`
verifies it).

## Contract handed to the hosted browser shell and relay

The browser session shell and the signaling relay live outside this
repository. They must adopt the following before the change is archived, and
their conformance run is recorded here when it completes.

- `authenticatedTransportVersion` is `2` on `host-ready`, `device-host-ready`,
  `client-join`, and `device-join`. A version-1 peer is refused visibly.
- `device-join` carries `deviceProof`: base64url RSA-PSS SHA-256 (salt 32) by
  the device key over `"terminay remote v1 device join" \n sessionId \n
  clientNonce`. The relay forwards it unchanged and verifies nothing.
- `/api/devices/enroll` answers `{ status: 'pending', approvalId, expiresAt }`.
  The shell derives the match code with `deriveMatchCode` from
  `@terminay/protocol` (HKDF label `terminay remote v1 match code`, HMAC over
  client nonce, host public key, SHA-256 of the device SPKI DER, first 25 bits,
  alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) and shows it while waiting.
- The decision arrives on the `api` lane as `enrollment-approved`
  (`approvalId`, `deviceId`, `deviceName`, `ticket`) or `enrollment-denied`
  (`approvalId`, `reason`).
- `/api/host-context` and the archive lanes answer only after
  `application-auth` consumed a ticket on that peer.
- There is no PIN field anywhere in the shell.

Conformance run: terminay.com PR 87 (`feat/pairing-approval-v2`) implements
this contract in the relay and session shell while keeping version-1 servers
working, and its CI (relay specs, shared match-code vector, pairing and
reconnect e2e) passes. The version-2 pairing and reconnect e2e against a
server from this change runs once terminay.com is deployed and this change
merges; until then the loopback proofs above stand in for it.
