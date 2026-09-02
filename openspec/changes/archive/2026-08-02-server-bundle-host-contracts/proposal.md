## Why

The repository already had a content-addressed server bundle, a unified framed
protocol, a shared client library, and host bridge seams, but the bundle manifest
did not declare the complete host-bridge and execution-runtime contract, feature
clients could still be constructed by compatibility host paths, and nothing proved
that an older compatible host can forward a newer bundle's unknown application
operations unchanged.

## What Changes

- Define one runtime-validated host bootstrap carrying exact server and profile
  identity, verified bundle identity, opaque byte-endpoint version, host-bridge
  version, host kind, and individual capabilities.
- Define a closed capability registry with versioned semantic actions for route
  and window presentation, native menus, approved file selection, clipboard write,
  notifications, updater, and guarded OS integration.
- **BREAKING** Prohibit renderer-selected host modes: `mode=electron`, URL or
  query privilege flags, server-supplied capabilities, unknown fields, raw
  `BrowserWindow`, arbitrary paths, generic IPC, and server commands are rejected.
- Extend the bundle manifest with validated bundle-format, application-protocol,
  minimum execution-runtime, supported host-bridge range, and required and
  optional capability declarations, bound into the manifest fingerprint and
  signature.
- Add one shared compatibility evaluator with typed bootstrap, byte-transport,
  manifest, execution-runtime, bridge, and required-capability incompatibility
  results, decided before any executable asset launches.
- **BREAKING** Remove host-side decoding and translation of feature operation
  names, results, workspace snapshots, and application events; `TerminayClient`
  and the feature facades stay in the server bundle's module graph.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-runtime-and-protocol`: adds bundle manifest compatibility declarations
  and the shared compatibility evaluator that gates launch.
- `connections-and-client-hosts`: adds the runtime-validated host bootstrap, the
  closed capability registry, and application-protocol blindness for hosts.

## Impact

The bundle manifest format and its fingerprint and signature, the host bootstrap
contract in both Desktop and browser hosts, the host bridge capability registry,
and every host package that previously understood feature operation names.
