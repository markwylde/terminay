# PWA framed session host (product contract)

## Goal

Align this repository's product specs with the Safari-safe PWA host: the
installable manager at `app.terminay.com` keeps itself as the top-level
document and loads each `https://<server>.terminay.com` session in a
fullscreen iframe, with a closed origin-checked `postMessage` bus for
credentials, clipboard, microphone, notifications, and shell control.

Implementation of that host belongs to the `terminay.com` repository. This
task is complete when the product contract here matches that behaviour and
no remaining spec in this repository requires top-level PWA navigation or
forbids the manager vault.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Dictation](../features/dictation.md)
- [PWA framed session host](../decisions/pwa-framed-session-host.md)
- Hosted contract: `terminay.com` `specs/remote.md`

## Scope

- Product behaviour, security invariants, and acceptance outcomes in this
  repository.
- A pointer that hosted HTML, headers, service worker, manager UI, session
  bootstrap, and e2e live in `terminay.com`.

Out of scope here: implementing the iframe shell, credential vault, or
session `postMessage` adapter.

## Implementation slices

- [x] Update the remote-access and web-host contracts for framed PWA open,
  manager credential vault, and closed host messages.
- [x] Record the architecture decision.
- [x] Point dictation at manager-side capture when the session is framed.

Hosted implementation is out of scope for this task. See
`terminay.com/specs/tasks/1-pwa-framed-session-host.md`.

## Acceptance checks

- Specs no longer require ordinary top-level navigation as the PWA **Open**
  path.
- Specs allow the manager to hold per-origin non-extractable device
  credentials for framed sessions and forbid using them except to clone into
  the matching session iframe.
- Direct pairing URLs and **Open in new tab** remain first-party session
  documents with their own credential store.
- Local Desktop UI stays unembeddable.

## Definition of done

This repository's feature specs and the hosted `terminay.com` spec describe
the same framed PWA host. Hosted implementation is tracked in `terminay.com`.
