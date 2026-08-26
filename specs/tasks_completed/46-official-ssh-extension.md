# Official SSH extension

## Goal

Publish `terminay-plugin-ssh` as a separate official npm package and deliver
strictly verified POSIX SSH terminal/filesystem project environments.

## Delivery phase

Phase 3, in parallel with
[Task 48](../tasks/48-puzed-vm-provisioning-experience.md) once the public provider and
UI contracts are stable.

## Dependencies

- [Task 42](../tasks_completed/42-extension-api-manifest-and-host.md)
- [Task 43](../tasks_completed/43-environment-routed-project-services.md)

## Governing specification

- [SSH project environments](../features/ssh-project-environments.md)

## Parallel work streams

### Profiles, credentials, and trust

- [x] Scaffold the separate repo from the public SDK with precompiled ESM, no
  install/build scripts/native deps, packed-tarball conformance, and provenance.
- [x] Implement revisioned profiles, vault key/passphrase/password/agent auth,
  connection stages/errors, pooling/keepalive/backoff, and default root.
- [x] Implement strict first-use challenge, exact host-key persistence,
  mismatch/replace flow, and separately confirmed/audited per-profile unsafe
  bypass.

### Remote terminal

- [x] Adapt structured direct SSH PTY channels to TerminalService bytes, input,
  resize, exit, backpressure, kill, transport-loss interruption, and status.
- [x] Launch Remote system default at the provider-canonical root with strict
  POSIX quoting/generated commands and filtered provider-safe environment.
- [x] Prove no automatic replacement shell and explicit unsupported cwd/
  foreground/agent/MCP behavior.

### SFTP filesystem

- [x] Implement canonical home/root browser and bounded SFTP realpath/stat/
  lstat/list/read/write/create/rename/delete with normalized errors.
- [x] Preserve containment/symlink/conflict/large-file/draft rules, atomic-temp
  writes where supported, ambiguous outcome handling, and manual refresh.
- [x] Add same-profile/different-root isolation and failure/performance limits.

## Acceptance checks

- Docker-backed SSH fixtures prove trust/auth/PTY/SFTP/root/loss/reconnect and
  cross-project isolation through `npm run test:e2e`.
- Client hosts receive no SSH credentials/transport and a remote Terminay Server
  uses its own network, vault, and agent.
- Local Git/process/agent/MCP/filesystem fallbacks are impossible.

## Definition of done

The separately published official package installs through the public platform
and provides reliable terminal/filesystem SSH projects on every server mode.
