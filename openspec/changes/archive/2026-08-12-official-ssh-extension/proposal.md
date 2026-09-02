## Why

Terminay's project-environment platform had a public extension API and
environment-routed project services but no official provider that proved the
contract end to end. SSH is the baseline case: a POSIX target reached from the
server, with terminals and a filesystem, and with credentials that must never
reach a client host.

## What Changes

- Publish `terminay-plugin-ssh` as a separate official npm package, scaffolded
  from the public SDK with precompiled ESM, no install or build scripts, no
  native dependencies, packed-tarball conformance, and provenance.
- Implement revisioned SSH profiles with vault key, passphrase, password, and
  agent authentication, connection stages and errors, pooling, keepalive,
  backoff, and a default root.
- Implement strict first-use host verification with exact host-key persistence,
  a mismatch and replacement flow, and a separately confirmed and audited
  per-profile unsafe bypass.
- Adapt structured direct SSH PTY channels to `TerminalService` bytes, input,
  resize, exit, backpressure, kill, transport-loss interruption, and status.
  Launch the Remote system default at the provider-canonical root with strict
  POSIX quoting and a filtered, provider-safe environment.
- Implement the SFTP filesystem adapter: canonical home and root browsing and
  bounded realpath, stat, lstat, list, read, write, create, rename, and delete
  with normalized errors, containment, symlink, conflict, large-file and draft
  rules, atomic temporary writes where supported, ambiguous-outcome handling,
  and manual refresh.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `ssh-project-environments`: extension packaging and ownership, profile
  contents and revisions, credential context, host verification and mismatch
  handling, the unsafe bypass, structured connection, remote PTY and trusted
  shell launch, the SFTP adapter, and remote filesystem safety rules.

## Impact

The separate `terminay-plugin-ssh` repository and its published package, the
public extension SDK surface it consumes, the server-side vault it resolves
credentials through, and the Docker-backed SSH fixtures in `npm run test:e2e`.
