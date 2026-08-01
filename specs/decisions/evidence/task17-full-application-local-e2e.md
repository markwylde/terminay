# Task 17 full-application local E2E evidence

The `node-datachannel` module is intentionally absent from both the root and
`@terminay/server` dependency/optional-dependency manifests. The lockfile
likewise contains no package entry. This matches the existing native
supply-chain decision: published `node-datachannel@0.32.3` prebuilds remain
blocked because of their embedded OpenSSL/libdatachannel provenance and
release-source correspondence requirements. It must not be silently added as
an optional production dependency merely because the adapter can load it.

The local probe ran on `darwin arm64` under Node `v24.14.0` and returned
`ERR_MODULE_NOT_FOUND`. npm metadata reports `node-datachannel@0.32.3` supports
Node `>=18.20.0`, so this is not recorded as a platform install failure: it is
the expected result of the explicit supply-chain gate. No install/build was
attempted and no native WebRTC pairing/TURN/provider result is claimed.

The deterministic local suite instead exercises the canonical framed client
and server composition over both Local and isolated headless channel
transports:

- workspace snapshots, project moves, identity preservation, and scoped
  reconnect projections;
- terminal creation, attach, input, output, resize, detach, replacement attach,
  replay ownership, and reconnect acknowledgement;
- file explorer, folder tasks, file read/save conflict behavior;
- Git status, diff, worktrees, default branch, and pull-request semantics;
- agent snapshots, events, acknowledgements, provider normalization, reconnect,
  and project scoping; and
- binary bodies, cancellation, settings/AI/Git/recording operation composition,
  and connection cleanup.

Run:

```sh
npm run build --workspace @terminay/server-core
node --test \
  packages/server-core/test/remote-local-conformance.test.mjs \
  packages/server-core/test/server-composition.test.mjs \
  packages/server-core/test/workspace-project-move-protocol.test.mjs \
  packages/server-core/test/terminal-protocol.test.mjs \
  packages/server-core/test/file-viewer-client-e2e.test.mjs \
  packages/server-core/test/git-framed-client.test.mjs \
  packages/server-core/test/agent-protocol.test.mjs
node --test scripts/task17-native-runtime-availability.test.mjs
```

Current deterministic result: 32 passing tests. Native availability probe: one
explicit skip because the audited native candidate is intentionally undeclared
and absent.
