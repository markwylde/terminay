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
  packages/server-core/test/terminal-claim-release-boundaries.test.mjs
```

These suites reject hostile npm specifications, integrity/lock/script/native/
path inputs, malformed and oversized IPC, unsafe callback DTOs, provider-id
collisions, forged and replayed MCP requests, forged project and
terminal-session claims, and cross-extension/field secret access. They also
prove deadline/cancellation/admission limits, crash/quarantine isolation, and
secret zeroization/redaction.

## Official agent extensions

```sh
npm run compile --workspaces --if-present
node --test extensions/agent-*/test/*.test.mjs
```

These suites prove that a provider observes only the terminals it was admitted
to, that observation stays inside the broker's permitted operations, and that a
crashing or failing provider never widens its own authority.

The Docker acceptance suite remains separate: Electron E2E must be invoked only
through `npm run test:e2e`. Unit/contract evidence must not be represented as
published-artifact, Docker, or real-infrastructure evidence.
