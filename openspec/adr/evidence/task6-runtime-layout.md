# Task 6 runtime-layout evidence

`scripts/task6-runtime-layout.test.mjs` checks the declared development,
standalone, and packaged Desktop resource layouts using deterministic temporary
fixtures. It resolves every declared path, requires regular files, rejects
missing or unsafe paths, repeats the inspection for stable evidence, and checks
that the current workspace and Electron Builder metadata advertise the matching
server, UI, MCP, and unpacked Electron directories.

The same focused test now also records a non-executing resolution contract for
packaging-sensitive runtime dependencies. It verifies that Desktop and
standalone manifests declare the same `node-pty` range, the standalone CLI owns
the `node-pty` import, provider commands resolve only from server env/PATH
defaults (`TERMINAY_CODEX_COMMAND || codex` and
`TERMINAY_CLAUDE_CODE_COMMAND || claude`), managed provider hooks are generated
under `.terminay/agent-hooks` with mode `0700` and loopback-only delivery, the
server-owned MCP entry is `terminay-mcp`/`dist/mcpEntry.js` with inherited
control socket/token environment, and Desktop unpacked runtime assets remain
declared as `dist-electron/**`.

This is a packaging-layout contract only. It does not claim that native Desktop
artifacts were built, signed, notarized, published, or executed, and it does not
close the broader provider-CLI, hook, node-pty, or full standalone/Desktop
runtime-parity gate across every real packaged layout.

## Final standalone-artifact preflight

On 2026-07-28, after removing temporary server/test data, the focused local
preflight passed 19/19 assertions:

```sh
node --test \
  scripts/task6-runtime-layout.test.mjs \
  scripts/standalone-server-artifact-ci.test.mjs \
  scripts/standalone-server-archive-probe.test.mjs \
  scripts/record-native-runner-evidence.test.mjs \
  scripts/release-readiness.test.mjs
```

This proves the deterministic layout, native matrix wiring, safe archive
inspection, exact artifact/commit evidence binding, and release-readiness
contracts against the current source tree. It does not manufacture either
required hosted-runner result.

The available local container authority is an arm64 Podman Linux VM on an
arm64 Darwin host. An arm64 Linux container can therefore execute instructions
without cross-architecture emulation and is useful as a local diagnostic lane.
It still cannot satisfy the release gate: the required record is produced by
the repository's GitHub-hosted `ubuntu-24.04-arm` job and binds that runner
identity, immutable commit, and exact uploaded archive. The locally available
x64 container path uses QEMU emulation and is expressly rejected as native x64
evidence. Consequently neither local lane may be used to tick the standalone
artifact parent; verified archive/evidence pairs from both hosted x64 and arm64
matrix jobs remain required.
