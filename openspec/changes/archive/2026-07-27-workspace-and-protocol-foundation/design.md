## Context

See proposal.md for motivation. This change ran immediately after the server
architecture decision spikes closed, so it deliberately took no dependency on a
concrete WebRTC implementation or a final native-platform claim: those were
still being decided and neither affects package direction or a
transport-neutral contract.

## Goals / Non-Goals

Goals:
- Enforceable dependency direction between deployable applications and shared
  packages.
- One versioned application contract that any later service can move onto,
  one service at a time.
- No user-facing behaviour change: existing Desktop builds, packaging, and
  tests stay green throughout.

Non-Goals:
- Moving any application service onto the server (later tasks).
- Claiming server runtime or connection-host behaviour; `terminay-server` and
  `terminay-web` gain only a composition entry here.
- Promoting the terminal-only remote renderer into the canonical protocol or
  the responsive UI; it stays an explicitly named compatibility build.

## Decisions

**Deterministic binary framing, not JSON strings.** Frames carry a magic value
and wire-format version, a frame-kind discriminator, fixed-width big-endian
header and body lengths, a canonical UTF-8 JSON header, and an optional raw
body. Canonical JSON rejects undefined values, non-finite numbers,
duplicate/unknown fields, invalid UTF-8, and non-deterministic key ordering.
Decoders validate declared lengths and resource limits before allocating or
parsing bodies, and peers negotiate limits downward rather than silently
exceeding either side's maximum. Shared code uses `Uint8Array`, never Node
`Buffer`, so the same code runs in a browser.

**`send` is an admission signal, not a delivery guarantee.** `send(frame)`
resolves when the adapter accepts the frame into its bounded queue. Delivery,
acknowledgement, and commit guarantees come from application acknowledgements,
stream positions, and command results. This rule exists specifically so a
concrete WebRTC library's boolean send return is never mistaken for a safe
retry or delivery signal.

**Uncertain command outcomes are resolved, never guessed.** Commands carry a
stable command id, correlation id, validated operation and payload, optional
expected revision, and bounded deadline. A repeated completed command id
returns its recorded result instead of executing again; a disconnect with an
uncertain outcome is resolved through command status plus snapshot/event
resync.

**Authority is asserted by the server, not the client hello.**
Transport-specific authentication happens before or alongside the protocol
adapter; the server handshake reports the resulting canonical client identity,
authorization scope, server identity, and capabilities. Electron window ids,
browser ids, and titles are kept out of the contract entirely — this is the
architectural boundary the whole change exists to establish.

**Legacy services are quarantined, not re-architected.** Electron-owned
services moved mechanically into `legacy-services/` only where needed to keep
the Desktop build working. Services are moved rather than copied, one
compatibility composition entry is the only permitted host import, new services
cannot be added, and boundary tests reject growth of the file/import surface.
The existing broad preload stays available only to the existing trusted local
renderer; it is never exposed to server-provided UI and is never the
implementation of `TerminayClient`.

**A boundary checker, with forbidden fixtures.** A TypeScript-AST checker
inspects static imports, exports, dynamic imports, and `require` calls, and
validates both source direction and declared package dependencies. Tests
include representative forbidden fixtures so a checker that silently stops
inspecting a syntax form fails CI rather than passing vacuously.

## Risks / Trade-offs

- A large mechanical move risks breaking packaging and E2E paths. Mitigated by
  a strict sequence: tooling and empty manifests first, protocol and
  conformance in isolation, then one application-migration owner performing all
  physical moves and path rewrites while no other work touches `src/`,
  `electron/`, root build configuration, lockfiles, or E2E fixture paths.
- The quarantine directory is migration debt and could become a second Desktop
  architecture. Mitigated by the no-additions rule and the boundary test that
  records and rejects growth.
- Version 0 compatibility is deliberately not supported. The fixture set
  documents a version-0 handshake and asserts the closed `incompatible_version`
  outcome with supported minimum and maximum, so the failure is deterministic
  rather than a partial parse.

## Migration Plan

1. Close the architecture spikes and all active feature-drift work before
   moving source paths.
2. Add workspace orchestration, shared compiler settings, empty manifests,
   boundary tooling, and compatibility aliases for existing root commands.
3. Implement protocol and protocol-conformance without touching the running
   application; freeze the public framing/transport surface once malformed,
   duplicate, stale, cancelled, oversized, slow-consumer, reconnect, and
   incompatible cases pass in memory.
4. Implement client-core, server-core dispatch boundaries, and the
   responsive-UI provider foundation against those public entries.
5. Implement the framed Electron IPC compatibility adapter and run the
   conformance suite through a real main/preload/renderer path.
6. Move Desktop sources and build configuration mechanically, preserving entry
   routes, legacy remote behaviour, output resolution, and E2E behaviour.
7. Add Server and Web compositions without claiming later runtime work.
8. Replace hard-coded `src`, `electron`, `dist`, and `dist-electron` paths with
   one workspace-path helper and application-owned outputs.
9. Enable boundary checks in normal CI, build shared artifacts twice and
   compare sorted hashes, and drop temporary exceptions.
10. Run the full smoke, focused, E2E, packaging, audit, and independent-build
    gates before checking off any slice.
