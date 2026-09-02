## 1. Host bootstrap and capability contract

- [x] 1.1 Define one runtime-validated host bootstrap containing exact
  server/profile identity, verified bundle identity, opaque byte-endpoint version,
  host-bridge version, host kind, and individual capabilities, verified by the
  bootstrap schema tests
- [x] 1.2 Define a closed capability registry with versioned semantic actions for
  route/window presentation, native menus, approved file selection, clipboard
  write, notifications, updater, and guarded OS integration, verified by the
  registry declaration gate
- [x] 1.3 Prohibit renderer-selected host modes, rejecting `mode=electron`,
  URL/query privilege flags, server-supplied capabilities, unknown fields, raw
  `BrowserWindow`, arbitrary paths, generic IPC, and server commands, verified by
  hostile-input tests
- [x] 1.4 Require exact source/window/profile/server binding and a user gesture for
  each native action that reads or changes host state, verified by the capability
  binding tests

## 2. Bundle compatibility metadata

- [x] 2.1 Extend the bundle manifest with validated bundle-format,
  application-protocol, minimum execution-runtime, supported host-bridge range,
  and required/optional capability declarations, verified by manifest validation
- [x] 2.2 Bind compatibility fields into the manifest fingerprint and signature and
  reject missing, contradictory, unknown, or unbounded requirements before
  executing any asset, verified by tampered-manifest tests
- [x] 2.3 Add one shared evaluator with typed bootstrap, byte-transport, manifest,
  execution-runtime, bridge, and required-capability incompatibility results,
  verified by the evaluator's result-type coverage
- [x] 2.4 Treat missing optional capabilities as presentation negotiation rather
  than connection failure, with the shared route contract selecting an in-page
  fallback or a clear unavailable action

## 3. Consume the protocol-blind byte endpoint

- [x] 3.1 Remove host-side decoding and translation of feature operation names,
  results, workspace snapshots, and application events, keeping only stable
  envelope and size validation, verified by the host-blindness tests
- [x] 3.2 Keep `TerminayClient` and the feature facades in the generated server
  bundle's module graph so host packages depend only on bootstrap, bundle,
  transport, profile, and host-bridge contracts, verified by the host package
  dependency checks

## 4. Acceptance

- [x] 4.1 A fixture server bundle constructs its own matching `TerminayClient` over
  the stable host-provided byte endpoint
- [x] 4.2 The host forwards valid application frames containing operation names and
  payloads it does not recognise
- [x] 4.3 Bundle compatibility is decided before executable assets launch or a new
  connection or window is committed
- [x] 4.4 Optional host capabilities degrade independently and cannot be enabled by
  renderer or server input
- [x] 4.5 Cross-server frames, unknown bridge fields, oversized messages, stale
  sources, and generic IPC requests fail closed
