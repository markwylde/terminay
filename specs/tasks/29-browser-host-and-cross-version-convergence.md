# Browser host and cross-version convergence

## Goal

Make the deployed browser artifact a small stable connection/bundle host and
prove Local Desktop, remote Desktop, direct browser, and browser-manager
sessions launch one server's same verified workspace bundle across the supported
compatibility window.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Remote access](../features/remote-access.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-bundled clients and protocol-blind hosts](../decisions/server-bundled-client-hosts.md)

## Dependencies

- [Task 27: Server bundle and host contracts](./27-server-bundle-host-contracts.md)
- [Task 28: Desktop server-bundle host and state extraction](./28-desktop-server-bundle-host-and-state.md)
- [Task 23: Embedded Desktop WebRTC exposure](./23-embedded-desktop-remote-exposure.md)
- [Task 41: Single-owner WebRTC transport generations](../tasks_completed/41-single-owner-webrtc-transport-generations.md)
- [Task 43: WebRTC transport recovery acceptance](./43-webrtc-transport-recovery-acceptance.md)

## Current gap

The browser host has profile, pairing/reconnect, origin-isolation, and verified
bundle seams, but the normal deployed composition still needs an explicit
dependency boundary proving it contains no independent full workspace fallback.
Cross-host evidence does not yet prove that all four launch paths execute the
same bundle id or cover compatible older/current/newer host and server fixtures.

## Implementation slices

### Thin browser shell

- [ ] Limit the deployed manager to connection profiles, pairing/reconnect,
  signaling/WebRTC bootstrap, bundle verification/installation, isolated
  session launch, and bounded failure/recovery UI.
- [ ] Remove any independently versioned full workspace fallback from the
  manager artifact and normal module graph.
- [ ] Install and execute each server bundle only in its exact isolated session
  origin. Never execute unrelated server code or credentials in the manager
  origin.
- [ ] Pass only the Task 27 browser host context and Task 41 opaque byte
  endpoint across a closed exact-source/exact-origin bridge.
- [ ] Keep `app.terminay.com` canonical, preserve its same-origin sanitized
  profile metadata, and use `web.terminay.com` only as a retired redirect.

### Origin, cache, and credential isolation

- [ ] Commit verified bundles atomically and keep the previous complete bundle
  after interruption, invalid hashes, unsafe paths, incompatible requirements,
  or server-identity mismatch.
- [ ] Keep manager persistence metadata-only and keep origin credentials and
  bundle storage out of profile messages, URLs, logs, and analytics.
- [ ] Preserve direct session-origin launch and a safe route back to connection
  management without transferring credentials.

## Acceptance checks

- The browser manager artifact contains no independently evolving full
  workspace build.
- A selected server supplies the complete workspace and matching
  `TerminayClient`; the manager supplies only compatible bootstrap, transport,
  bundle installation, and browser presentation.
- One server reports the same verified bundle and server-owned identities in
  all four launch paths.
- Compatible host shells connect across server application versions without
  interpreting feature frames.
- Incompatible required boundaries fail before launch with a typed upgrade
  requirement; optional host capabilities degrade without disconnecting.
- Manager/session/sibling origins and Desktop profiles cannot cross credentials,
  caches, DOM, transports, or workspace state.

## Definition of done

The production browser artifact is a thin isolated server-bundle host, the
four supported launch paths run the same selected-server workspace artifact,
and the bounded cross-version/security matrix is verified as a release gate.
