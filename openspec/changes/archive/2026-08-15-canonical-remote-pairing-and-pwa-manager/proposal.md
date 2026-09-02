## Why

Remote access carried several competing architectures at once: browser and
server reconnect grants with derived HMAC proof keys and grant rotation;
manager-origin pairing coordination with iframe and window messaging and manager
knowledge of session authentication state; profile metadata import and
cross-origin migration between `app.terminay.com` and `web.terminay.com`; a
direct-network LAN listener with its own settings and QR journey alongside
WebRTC; and browser profile records that exceeded the PWA's bookmark role.

## What Changes

- **BREAKING** Replace reconnect grants and derived proof and signaling keys
  with one versioned enrollment and reconnect contract: a non-extractable
  signing key created at the exact session origin, a server-issued nonce
  challenge signed by the registered device key, and a short-lived single-use
  connection ticket bound to the authenticated device and WebRTC peer. Existing
  remote browser and Desktop pairings may be invalidated and paired again.
- Make each server's stable `https://<server>.terminay.com` origin own the
  complete browser pairing, authentication, WebRTC, bundle, reconnect, status,
  and error journey. Pairing authority comes only from a short-lived, single-use
  URL fragment, consumed in memory and removed from the visible URL and history
  before loading unrelated resources.
- **BREAKING** Reduce `app.terminay.com` to an installable connection bookmark
  manager storing exactly label, canonical stable HTTPS origin, created time,
  and last-opened time. Manager-side enrollment, reconnect vaults, device
  credentials, workspace loading, session host bridges, iframe and window
  messaging, pairing result callbacks, profile metadata import, and migration
  code are deleted, along with `web.terminay.com` migration behaviour.
- **BREAKING** Delete the direct-network LAN listener with its settings, QR
  flow, status, IPC, persistence, diagnostics, tests, and release configuration.
  WebRTC signaling and TURN relay are the only remote exposure and application
  transport path.
- Present paired devices by name and metadata with a revocation action, keeping
  forget, disconnect, revoke, and stop exposure as distinct confirmed
  operations. Device revocation closes live connections and rejects future
  proofs without affecting other devices or server-owned PTYs.
- Replace persisted remote-device state with an explicit current schema that
  starts clean when another schema is encountered; no migration code is added.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: session-origin enrollment, single-use pairing URLs, reconnect
  transport authentication, the PWA add-connection flow and manager list,
  recovery scope and revocation, persistence boundaries, uniform exposure, the
  Desktop pairing journey, and the pairing credential security invariants.
- `connections-and-client-hosts`: web connection host scope, the PWA profile
  store record, the manager staying out of the credential path, browser
  connection journeys, and the web host storage split.

## Impact

Server remote-device authentication and exposure, the WebRTC signaling and TURN
bootstrap, Desktop protected credential storage and pairing, the shared and
Desktop remote UI, the separate `app.terminay.com` PWA repository, and the test
suites that asserted the removed mechanisms.
