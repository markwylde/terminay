# Extension security evidence

This is the reproducible Task 51 hostile-boundary evidence map. Run it from the
named repositories after building; a release record must capture commits,
commands, UTC completion time, and results. Tests use sentinels and never real
credentials or infrastructure.

## Terminay Server

```sh
npm run build --workspace @terminay/server-core
node --test \
  packages/server-core/test/extension-host.test.mjs \
  packages/server-core/test/extension-installer.test.mjs \
  packages/server-core/test/extension-secret-broker.test.mjs \
  packages/server-core/test/project-environment-router.test.mjs \
  packages/server-core/test/remote-file-protocol.test.mjs \
  packages/server-core/test/remote-mcp-bridge.test.mjs \
  packages/server-core/test/terminal-claim-release-boundaries.test.mjs
```

These suites reject hostile npm specifications, integrity/lock/script/native/
path inputs, malformed and oversized IPC, unsafe callback DTOs, provider-id
collisions, forged/replayed/cross-environment MCP requests, forged project and
terminal-session claims, and cross-extension/profile/field secret access. They
also prove deadline/cancellation/admission limits, crash/quarantine isolation,
secret zeroization/redaction, remote SFTP-only routing, immutable long-lived
bindings, and no fallback to local PTY/filesystem when a provider fails.

## Official SSH extension

```sh
npm run compile
node --test test/profile-trust.test.mjs test/filesystem.test.mjs test/pool-terminal.test.mjs
```

These suites prove strict first-use approval, exact fingerprint persistence,
mismatch/replace/replay behavior, profile-local explicit bypass, logical-host
identity, root and symlink traversal rejection, per-root/revision isolation,
bounded channel pooling, disconnect `outcome-unknown`, and no replacement/local
terminal after loss.

## Official Puzed extension

```sh
npm run build
node --test test/puzed.test.mjs test/provisioning.test.mjs
```

These suites prove exact-origin URL validation, manual redirect rejection before
authorization forwarding, transient zeroized API-key use, bounded/paginated
forms, exact system tag filtering, public-key-only creation, durable idempotency,
restart/resume boundaries, non-destructive failure, and one ref-counted SSE
stream per profile/organization.

The Docker acceptance suite remains separate: Electron E2E must be invoked only
through `npm run test:e2e`, and real Puzed smoke is opt-in. Unit/contract evidence
must not be represented as published-artifact, Docker, or real-infrastructure
evidence.
