## Why

Terminay relied on Electron for WebRTC hosting, native PTY packaging, path
resolution, and safe storage, but the target architecture also had to run
displayless on common Linux servers and load server-provided UI inside
untrusted client boundaries. Those constraints needed executable proof before
the repository committed to hard-to-reverse foundations.

## What Changes

- Ran executable spikes for headless WebRTC, native PTY distribution,
  persistence and vault, and client-host composition, and recorded the
  evidence for each.
- Selected one runtime per spike and recorded the rejected alternatives, the
  supported platform matrix, and the fallback or blocking evidence.
- Recorded the resulting durable decisions as architecture decision records
  rather than changing product behaviour.
- Declared the initial supported distribution matrix: Desktop on macOS 12
  Monterey or newer (arm64) and GNU/Linux x64; standalone Server on GNU/Linux
  x64 and arm64 with a Debian 12-compatible userspace at glibc 2.36 or newer;
  all other targets unsupported.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

_None._

## Impact

No product behaviour changed. The outputs are decision records, evidence
documents under `openspec/adr/evidence/`, and the executable proof scripts
(`scripts/server-state-sqlite-crash.test.mjs`,
`scripts/safe-storage-import.test.mjs`, `scripts/vault-reference.test.mjs`,
`scripts/pty-host-runtime.test.mjs`,
`scripts/pty-electron-main-supervisor.test.mjs`,
`scripts/pty-packaged-macos.test.mjs`,
`scripts/pty-packaged-linux.test.mjs`,
`scripts/pty-runtime-artifact-probe.mjs`,
`scripts/webrtc-headless-resource-limits.test.mjs`,
`scripts/production-webrtc-turn-routes.test.mjs`,
`e2e/server-ui-sandbox.spec.ts`, `e2e/web-client-host.spec.ts`). Every
subsequent foundation change depends on these selections.
