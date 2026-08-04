# Web client-host composition proof

`e2e/web-client-host.spec.ts` starts one loopback HTTP fixture addressed through
three exact browser origins:

- `web.localhost` represents the connection shell;
- `session-a.localhost` and `session-b.localhost` represent two server session
  origins; and
- `attacker.localhost` represents an unauthorized embedding origin.

The proof exercises browser-enforced origin storage, CSP `frame-ancestors`,
iframe sandboxing, exact `postMessage` source/origin/schema checks, responsive
frame sizing, keyboard focus, and origin-scoped clipboard permission grants.
Session cookies use CHIPS (`Secure; SameSite=None; Partitioned`) because current
Chromium rejects an unpartitioned cookie created inside the cross-site session
iframe. The production host must not depend on an ordinary third-party cookie.
The iframe delegates only `clipboard-read` and `clipboard-write`; without that
explicit Permissions Policy delegation, Chromium rejects clipboard access even
when the exact session origin has permission.

## Exact limitations

- Headless Chromium does not expose a software mobile keyboard. The proof
  verifies the mobile viewport, responsive iframe size, focus retention, typed
  input, and resize messages, but not visual-viewport movement caused by an
  Android or iOS keyboard.
- Clipboard access is tested with an explicit iframe Permissions Policy and
  Playwright grants. Chromium rejects access when only the exact session origin
  is granted; the top-level host must also hold the permission before the
  delegated iframe can complete a user-activation write/read roundtrip.
  Clipboard contents therefore are not an origin-isolated secret boundary, and
  the proof does not model every browser's permission prompt or native
  clipboard UI.
- Cache Storage contents are proven origin-isolated through browser APIs. Cache
  files on disk remain browser-managed implementation details and are not
  inspected directly.
- The fixture proves the web parent/session model. Electron sandbox and preload
  isolation are covered separately by `e2e/server-ui-sandbox.spec.ts`.
