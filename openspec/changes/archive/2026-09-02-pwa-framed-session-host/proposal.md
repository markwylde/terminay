## Why

An installed iOS Home Screen app stays chrome-less only while the top-level
document remains on `app.terminay.com`. Opening a connection by navigating the
top-level document to `https://<server>.terminay.com` shows Safari's address bar
and defeats the installed-app presentation, and Safari partitions a cross-origin
session iframe's storage so a framed session cannot persist its own device
credential. This repository's product specs still described top-level PWA
navigation and forbade a manager-held credential store, so they no longer matched
the host Terminay ships.

## What Changes

- The PWA **Open** path frames the selected stable session origin inside the
  manager instead of navigating the top-level document. **BREAKING** for any
  reading of the specs that requires ordinary top-level navigation.
- The advertised hosted pairing URL lands on `app.terminay.com`, is consumed in
  memory, and is confirmed through **Save and connect** before any bookmark is
  written; the reconstructed session pairing URL is then framed.
- The manager holds an origin-keyed vault of non-extractable device private keys
  for framed sessions. The manager never signs; the session iframe does.
- A closed, origin-checked `postMessage` schema carries device credentials,
  clipboard, microphone, notifications, and shell control. It carries no WebRTC,
  no workspace frames, and no generic storage.
- Direct pairing URLs and **Open in new tab** stay first-party session documents
  with their own session-origin credential store, separate from the vault.
- Dictation capture moves to the manager, after a user gesture, when the session
  is framed; audio reaches the session over the closed host channel.
- The local Desktop UI stays unembeddable, and bundle bytes, pairing fragments,
  PINs, and connection tickets stay out of the manager origin.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: framed PWA open, manager credential vault, closed framed-host
  message schema, and first-party session-origin enrollment.
- `connections-and-client-hosts`: web host scope becomes manager plus framed
  session host plus vault, and the manager stays out of the credential path.
- `dictation`: manager-side microphone capture for a framed session.

## Impact

- Product contract only in this repository. The iframe shell, credential vault,
  session `postMessage` adapter, hosted HTML, headers, service worker, manager
  UI, session bootstrap, and their end-to-end tests are implemented in the
  `terminay.com` repository (`specs/remote.md`, its task
  `1-pwa-framed-session-host.md`).
- Affects the web connection host, remote-access pairing and reconnect journeys,
  and the dictation capture path in framed sessions.
- No change to Desktop, to the Terminay Server, or to the application protocol.
