## Context

See proposal.md for the motivation. The constraint is a browser one: iOS keeps an
installed PWA chrome-less only while the top-level document stays on the manager
origin, and Safari partitions storage for a cross-origin iframe so the framed
session cannot keep its own device key. Per-server session origins remain the
isolation boundary for untrusted server-bundled UI, so the workspace itself must
not move onto `app.terminay.com`.

## Goals / Non-Goals

Goals:

- Keep the installed PWA presentation chrome-less for every saved connection.
- Give a framed session a durable device credential without moving the workspace,
  the bundle bytes, or the connection ticket onto the manager origin.
- Keep one storage implementation rather than one for Safari and one for Chrome.
- Keep the specs in this repository and the hosted `terminay.com` spec describing
  the same host.

Non-Goals:

- Implementing the iframe shell, the credential vault, or the session
  `postMessage` adapter — those belong to `terminay.com`.
- Changing Desktop, the Terminay Server, or the application protocol.
- Making the manager a participant in authentication beyond custody of a
  non-extractable key.

## Decisions

- **Frame, do not navigate.** The manager stays the top-level document and loads
  the exact stable session origin in a fullscreen iframe. At most one session is
  framed; opening another replaces it. Session and workspace script never assign
  `window.top` or use `target="_top"`.
- **Custody without authority.** The manager stores only a non-extractable device
  private key plus the non-secret device id and name, keyed strictly by
  `event.origin`, in manager-origin IndexedDB rather than `localStorage`. The key
  is cloned only into the iframe whose origin matches its slot, structured clone
  keeps it non-extractable, and the manager never signs. This crosses the
  credential trust boundary deliberately: custody of an unusable key is not the
  same as participation in the authentication path, which still excludes PINs,
  tickets, terminal data, and workspace data.
- **Closed message schema.** One origin-checked schema carries device
  credentials, clipboard, microphone, notifications, and shell control, and
  nothing else. WebRTC, workspace frames, and generic storage stay out of it, so
  the manager cannot become a transport or a storage proxy. The session speaks to
  `parent` only when `parent.origin` is the manager origin and ignores any other
  embedder; Desktop's local UI stays unembeddable.
- **Two credential worlds, kept separate.** A direct `/v1/` pairing URL and
  **Open in new tab** enroll first-party at the session origin using
  session-origin IndexedDB. Framed and direct credentials for one origin are
  separate records, and an iOS Home Screen PWA's storage is isolated from Safari's.
- **Permission placement follows the gesture.** Clipboard and microphone are
  allowed through the iframe and require a user gesture; camera stays on the
  manager for QR scanning. Dictation therefore captures in the manager when the
  session is framed and delivers audio over the closed channel.
- **Bookmarks stay minimal.** The manager stores only a label, the canonical
  stable session origin, and created and last-opened timestamps. Pairing
  fragments, queries beyond `s`, `hostName`, and `pairingExpiresAt`, URL
  credentials, and unsupported schemes never become bookmark state.

## Risks / Trade-offs

- The manager origin now holds key material it previously never saw. Mitigated by
  non-extractability, strict origin keying, IndexedDB-only storage, no signing in
  the manager, and deletion of the vault slot on **Forget**.
- A compromised manager origin can attempt to hand a key to an iframe. It cannot
  use the key itself, and origin keying means it cannot address another origin's
  slot.
- Framing adds a viewport and permission surface — the titlebar and iframe must
  stay pinned to the visual viewport with the iOS keyboard visible, and the
  workspace inside must not re-apply the safe-area inset.
- The contract and its implementation live in two repositories, so the hosted
  `terminay.com` spec must stay aligned.

## Migration Plan

No product data migrates in this repository. Existing first-party session
credentials remain valid for direct and new-tab documents; a framed session
without a valid device identity asks for a fresh pairing URL while its manager
profile is retained.
