## Context

See proposal.md. This change closes out the server-bundled client-host
architecture on the browser side: the bundle and host contracts, the Desktop
server-bundle host, embedded Desktop WebRTC exposure, single-owner WebRTC
transport generations, and WebRTC transport recovery acceptance were already in
place, so what remained was proving the deployed browser artifact carries no
second workspace and that every launch path converges on one bundle.

## Goals / Non-Goals

Goals:
- The production browser artifact is a thin isolated server-bundle host.
- Local Desktop, remote Desktop, direct browser, and browser-manager launches
  run the same selected-server workspace artifact.
- The bounded cross-version and security matrix is verified as a release gate.

Non-Goals:
- Changing the Desktop host, the transport generation model, or the recovery
  acceptance contract, all of which this change depends on.

## Decisions

### The manager holds no workspace

Any independently versioned full workspace fallback was removed from the
manager artifact and its normal module graph, not merely gated behind a flag.
The manager's responsibilities are enumerated and bounded: connection profiles,
pairing and reconnect, signaling and WebRTC bootstrap, bundle verification and
installation, isolated session launch, and bounded failure and recovery UI. The
selected server supplies the complete workspace and its matching
`TerminayClient`; the manager supplies only compatible bootstrap, transport,
bundle installation, and browser presentation.

### One canonical manager origin

`app.terminay.com` is canonical and keeps its same-origin sanitized profile
metadata. `web.terminay.com` becomes a retired redirect rather than a second
live manager.

### Bundle installation is atomic

A verified bundle is committed atomically. Interruption, an invalid hash, an
unsafe path, an incompatible requirement, or a server-identity mismatch leaves
the previous complete bundle in place rather than a partial install.

### Compatibility is negotiated, not interpreted

Compatible host shells connect across server application versions without
interpreting feature frames. Incompatible required boundaries fail before
launch with a typed upgrade requirement; optional host capabilities degrade
without disconnecting.

## Risks / Trade-offs

- Removing the fallback means a manager that cannot install a bundle has no
  workspace to fall back to. This is intentional — a second workspace build is
  exactly the drift this change removes — so the manager must instead render a
  bounded, typed failure and recovery surface.
- Cross-version coverage is a bounded matrix of older, current, and newer host
  and server fixtures rather than an open-ended one.
