# Server bundle and host contracts

## Goal

Define and prove the stable boundary that lets a browser or Desktop shell launch
the selected Terminay Server's exact UI bundle without understanding that
server's feature-level application protocol.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Server-bundled clients and protocol-blind hosts](../decisions/server-bundled-client-hosts.md)

## Current gap

The repository has a content-addressed server bundle, unified framed protocol,
shared client library, and host bridge seams. The bundle manifest does not yet
declare the complete host-bridge/execution-runtime contract, feature clients
can still be constructed by compatibility host paths, and no single runtime
contract proves that an older compatible host can forward a newer bundle's
unknown application operations unchanged.

## Dependency

- [Task 41: Single-owner WebRTC transport generations](../tasks_completed/41-single-owner-webrtc-transport-generations.md)

## Implementation slices

### Host bootstrap and capability contract

- [ ] Define one runtime-validated host bootstrap containing exact
  server/profile identity, verified bundle identity, opaque byte-endpoint
  version, host-bridge version, host kind, and individual capabilities.
- [ ] Define a closed capability registry with versioned semantic actions for
  route/window presentation, native menus, approved file selection, clipboard
  write, notifications, updater, and guarded OS integration.
- [ ] Prohibit renderer-selected host modes. Reject `mode=electron`, URL/query
  privilege flags, server-supplied capabilities, unknown fields, raw
  `BrowserWindow`, arbitrary paths, generic IPC, and server commands.
- [ ] Require exact source/window/profile/server binding and a user gesture for
  each native action that reads or changes host state.

### Bundle compatibility metadata

- [ ] Extend the bundle manifest with validated bundle-format,
  application-protocol, minimum execution-runtime, supported host-bridge range,
  and required/optional capability declarations.
- [ ] Bind compatibility fields into the manifest fingerprint/signature and
  reject missing, contradictory, unknown, or unbounded requirements before
  executing any asset.
- [ ] Add one shared evaluator with typed bootstrap, byte-transport, manifest,
  execution-runtime, bridge, and required-capability incompatibility results.
- [ ] Treat missing optional capabilities as presentation negotiation, not a
  connection failure; the shared route contract selects an in-page fallback or
  a clear unavailable action.

### Consume the protocol-blind byte endpoint

Task 41 owns the replaceable renderer-facing byte endpoint, its exact
server/profile binding, lifecycle, cancellation, backpressure, and WebRTC
transport-generation replacement. This task consumes that endpoint and owns
only its bundle/bootstrap compatibility declaration and application-protocol
blindness. It must not introduce another channel bridge or reconnect owner.

- [ ] Remove host-side decoding/translation of feature operation names,
  results, workspace snapshots, and application events. Stable envelope and
  size validation remains application-version agnostic.
- [ ] Keep `TerminayClient` and feature facades in the generated server bundle's
  module graph. Host packages depend only on bootstrap, bundle, transport,
  profile, and host-bridge contracts.

### Compatibility evidence

- [ ] Add minimum/current/maximum compatible fixtures for bundle format, host
  bridge, execution runtime, and byte-endpoint versions.
- [ ] Prove an older compatible host forwards a newer fixture bundle's unknown
  application operation unchanged to its matching server.
- [ ] Prove missing optional native capabilities preserve a usable workspace,
  while a missing required boundary fails before launch and names the component
  that must be upgraded.
- [ ] Add static dependency checks preventing feature-specific clients,
  workspace reducers, persistent feature DTOs, or a full workspace entry from
  entering a host-contract package.

## Acceptance checks

- A fixture server bundle constructs its own matching `TerminayClient` over the
  stable host-provided byte endpoint.
- The host forwards valid application frames containing operation names and
  payloads it does not recognize.
- Bundle compatibility is decided before executable assets launch or a new
  connection/window is committed.
- Optional host capabilities degrade independently and cannot be enabled by
  renderer/server input.
- Cross-server frames, unknown bridge fields, oversized messages, stale
  sources, and generic IPC requests fail closed.

## Definition of done

Bundle manifests, host bootstrap, Task 41's byte endpoint compatibility,
compatibility evaluation, and semantic host capabilities are versioned runtime
contracts with cross-version and hostile-input evidence. Browser and Desktop
adoption can proceed without feature-aware host adapters or another transport
recovery layer.
