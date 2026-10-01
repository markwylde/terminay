## 1. Desktop pairing and persistence

- [x] 1.1 Resolve direct `/v1/` links before loopback hosted-session classification and classify saved loopback direct origins consistently. Verify: protocol URL tests cover localhost, IPv4 and IPv6 loopback, hosted session URLs, and HTTP embedded links.
- [x] 1.2 Persist sanitized Desktop profile metadata immediately after successful device enrollment and retain it when initial reconnect or workspace loading fails. Verify: a focused main-process test proves profile persistence and device identity survive the first-load rejection without serializing the pairing URL or fragment.

## 2. WebRTC recovery and diagnostics

- [x] 2.1 Keep Desktop peer and required-lane liveness monitoring active after setup, with one terminal failure callback, degraded-ICE feedback, and the existing ICE recovery grace behavior. Verify: lifecycle tests cover late failure, channel closure, transient ICE disconnect, grace expiry, and duplicate events.
- [x] 2.2 Record the selected candidate pair and changes in Desktop and standalone server structured diagnostics, excluding credentials, SDP, and application content. Verify: tests assert candidate type, protocol, address, port, state, and sensitive-field absence.

## 3. Pairing room and user feedback

- [x] 3.1 Invalidate a consumed pairing room synchronously with successful approval while preserving its authenticated peer. Verify: hosted approval integration tests prove immediate room rotation and that a stale-room join cannot replace the approved peer.
- [x] 3.2 Add explicit pairing progress, prevent concurrent attempts, normalize IPC errors, and show actionable used-link and connection-loss recovery. Verify: protocol and UI regressions cover lifecycle states, disabled submit, and friendly known/unknown error formatting.

## 4. Listener and CLI behavior

- [x] 4.1 Serve the direct-link explanation at `/v1/`, prefer hosted QR output when both modes are enabled, and classify public ready-log URLs by exposure mode. Verify: local listener and CLI tests assert page content, QR selection, and correct URL class.
- [x] 4.2 Warn when a loopback direct signaling URL has no advertised UDP media route and provide actionable `sudo`-missing or helper-permission errors. Verify: CLI tests cover the warning and the missing-`sudo`/inaccessible-helper error mappings.

## 5. Operator documentation and integration

- [x] 5.1 Update the standalone runbook and `terminay.com` remote-access guidance for foreground containers, hosted QR links, direct browser behavior, UDP reachability, and transient disconnects. Verify: documentation tests assert the platform distinction and recovery guidance.
- [ ] 5.2 Run focused regression tests, OpenSpec validation, type checks, and the Docker-isolated Electron E2E suite. Focused suites and `openspec validate --all` pass; `npm run test:e2e` could not run because the Docker service is unavailable.
