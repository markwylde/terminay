## 1. Profiles, credentials, and trust

- [x] 1.1 Scaffold the separate repository from the public SDK with precompiled
  ESM, no install or build scripts, no native dependencies, packed-tarball
  conformance, and provenance, verified by the packaging conformance checks
- [x] 1.2 Implement revisioned profiles, vault key/passphrase/password/agent
  authentication, connection stages and errors, pooling, keepalive, backoff, and
  the default root, verified by profile and connection tests
- [x] 1.3 Implement strict first-use challenge, exact host-key persistence, the
  mismatch and replace flow, and a separately confirmed and audited per-profile
  unsafe bypass, verified by host-key mismatch and replacement tests

## 2. Remote terminal

- [x] 2.1 Adapt structured direct SSH PTY channels to `TerminalService` bytes,
  input, resize, exit, backpressure, kill, transport-loss interruption, and
  status, verified by Docker-backed PTY fixtures
- [x] 2.2 Launch the Remote system default at the provider-canonical root with
  strict POSIX quoting, generated commands, and a filtered provider-safe
  environment, verified by launch tests
- [x] 2.3 Prove no automatic replacement shell and explicit unsupported
  cwd/foreground/agent/MCP behaviour, verified by capability tests

## 3. SFTP filesystem

- [x] 3.1 Implement canonical home and root browsing and bounded SFTP realpath,
  stat, lstat, list, read, write, create, rename, and delete with normalized
  errors, verified by SFTP adapter tests
- [x] 3.2 Preserve containment, symlink, conflict, large-file, and draft rules,
  atomic temporary writes where supported, ambiguous outcome handling, and
  manual refresh, verified by filesystem safety tests
- [x] 3.3 Add same-profile/different-root isolation and failure and performance
  limits, verified by isolation tests

## 4. Acceptance

- [x] 4.1 Docker-backed SSH fixtures prove trust, authentication, PTY, SFTP,
  root, loss, reconnect, and cross-project isolation through `npm run test:e2e`
- [x] 4.2 Client hosts receive no SSH credentials or transport, and a remote
  Terminay Server uses its own network, vault, and agent, verified by boundary
  assertions
- [x] 4.3 Local Git, process, agent, MCP, and filesystem fallbacks are
  impossible, verified by fallback-prohibition tests
