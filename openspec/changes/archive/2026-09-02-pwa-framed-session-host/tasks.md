## 1. Product contract alignment

- [x] 1.1 Update the remote-access and web-host contracts for framed PWA open, the manager credential vault, and the closed host message schema, verified by the remote-access and connections-and-client-hosts specs describing framed open with no requirement for top-level PWA navigation
- [x] 1.2 Record the architecture decision, verified by `openspec/adr/0012-pwa-framed-session-host.md` existing in the accepted set
- [x] 1.3 Point dictation at manager-side capture when the session is framed, verified by the dictation spec requiring manager capture after a user gesture and delivery over the closed host channel

## 2. Acceptance

- [x] 2.1 Confirm no remaining spec in this repository requires ordinary top-level navigation as the PWA **Open** path, verified by a repository-wide spec review
- [x] 2.2 Confirm the specs permit the manager to hold per-origin non-extractable device credentials and forbid any use other than cloning into the matching session iframe, verified against the framed-session credential vault and closed message-schema requirements
- [x] 2.3 Confirm direct pairing URLs and **Open in new tab** remain first-party session documents with their own credential store, verified against the first-party session-origin enrollment requirement
- [x] 2.4 Confirm the local Desktop UI stays unembeddable, verified against the Desktop remote-code containment contract
- [x] 2.5 Confirm this repository's specs and the hosted `terminay.com` `specs/remote.md` describe the same framed PWA host, verified by cross-reading both contracts

## 3. Out of scope here

- [x] 3.1 Hosted implementation of the iframe shell, credential vault, and session `postMessage` adapter, tracked in `terminay.com/specs/tasks/1-pwa-framed-session-host.md` and verified by that repository's end-to-end suite
