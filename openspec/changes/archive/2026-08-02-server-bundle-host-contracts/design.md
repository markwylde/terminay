## Context

See proposal.md for the gap. This change defines and proves the stable boundary
that lets a browser or Desktop shell launch the selected server's exact UI bundle
without understanding that server's feature-level application protocol.

The renderer-facing byte endpoint itself is not owned here. The single-owner
WebRTC transport-generation work owns the replaceable byte endpoint, its exact
server and profile binding, lifecycle, cancellation, backpressure, and
transport-generation replacement. This change consumes that endpoint and owns only
its bundle and bootstrap compatibility declaration and its application-protocol
blindness. It deliberately introduces neither another channel bridge nor another
reconnect owner.

## Goals / Non-Goals

Goals: versioned runtime contracts for bundle manifests, host bootstrap, byte
endpoint compatibility, compatibility evaluation, and semantic host capabilities,
each with cross-version and hostile-input evidence.

Non-Goals: a second transport recovery layer, feature-aware host adapters, and
any host-side interpretation of application payloads.

## Decisions

- Host privilege is declared by the bootstrap, never selected by the renderer. A
  `mode=electron` marker, a URL or query privilege flag, a server-supplied
  capability, or an unknown field fails closed rather than widening the host.
- The capability registry is closed and versioned, expressed as semantic actions
  rather than as raw primitives. No entry exposes `BrowserWindow`, arbitrary
  paths, generic IPC, or server commands.
- Every native action that reads or changes host state requires exact source,
  window, profile, and server binding plus a user gesture.
- Compatibility fields are bound into the manifest fingerprint and signature, so a
  manifest cannot advertise different compatibility than the one that was signed.
  Missing, contradictory, unknown, or unbounded requirements are rejected before
  any asset executes.
- One shared evaluator produces typed incompatibility results rather than each
  host inventing its own checks, so Desktop and browser agree on what is
  incompatible and why.
- A missing optional capability is presentation negotiation, not a connection
  failure: the shared route contract selects an in-page fallback or a clear
  unavailable action.
- Hosts forward valid application frames whose operation names and payloads they
  do not recognise. Only stable envelope and size validation remains, and that
  validation is application-version agnostic. This is what lets an older host run
  a newer bundle.

## Risks / Trade-offs

Binding compatibility into the signature means a compatibility correction requires
a new signed manifest; that is accepted, because an unsigned compatibility claim
would be trivially forgeable.

Keeping `TerminayClient` and the feature facades inside the bundle's module graph
increases bundle size, but it is the only way a host can stay protocol-blind while
the application protocol continues to move.

## Migration Plan

Compatibility host paths that constructed feature clients are removed; host
packages depend only on the bootstrap, bundle, transport, profile, and host-bridge
contracts. Browser and Desktop adoption then proceeds without feature-aware host
adapters.
