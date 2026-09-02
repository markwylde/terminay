# Production headless WebRTC Linux evidence

Date: 2026-07-27

This evidence exercises the production `RemoteAccessService`, hardened hosted
signaling service, browser client, and plain-Node WebRTC host. It distinguishes
executed native evidence, architecture-emulated diagnostics, and configured
but unexecuted CI.

## Executed clean Linux artifact proofs

The arm64 lane runs in an architecture-native Debian 12 container inside the
arm64 Podman Linux VM. It uses Node 22.23.1, has no compiler or build system,
and has no `DISPLAY` or `WAYLAND_DISPLAY`.

The x64 lane runs the same Debian 12 container under QEMU architecture
emulation on that arm64 VM. It is not native x64 evidence. Both lanes execute
the exact minimized `werift` 0.24.1 ESM artifact and pass:

- two independent deterministic builds with identical file hashes;
- the exact 44-file allowlist, upstream npm integrity, tarball SHA-512, and
  git-head checks;
- a production-dependency audit with zero total vulnerabilities;
- the pinned Node 22.23.1 runtime;
- the bounded 8 MiB peer/data-channel behavior proof; and
- clean peer shutdown with no active socket or timer resource.

The native arm64 run closes in 64 ms. The architecture-emulated x64 run closes
in 24 ms. Both emit the same upstream tarball SHA-512
`f0ca5fd0558eda991df544326741dbd427229b2765361f0a0af6460f65ff0f4b9c558eae6c9c57f7572774ea533a73c0ef095ea29a29d38e1548d65e084c2078`
and git head `243fd7e24c39fbe03fb855928daddd793fc8d4fa`.

The same native arm64 lane also executes `node-datachannel` 0.32.3 through the
complete production proof. It loads
`build/Release/node_datachannel.node` as an ARM aarch64 ELF with build ID
`0b3c82783face1612ac146e75a504720f987085a`. That is compatibility evidence,
not a runtime selection: the separate supply-chain decision rejects the
candidate for the server foundation.

The minimized-Werift production harness separately passes the complete hosted
pairing, signed signaling, terminal, two-factor reconnect, revocation, and
shutdown flow from a displayless plain-Node host. The clean Linux executions
use the runtime-only mode so architecture emulation does not turn Chromium
itself into part of the runtime portability result.

## Linux x64 architecture-emulated diagnostic

The local x64 lane uses an amd64 Debian 12 container under QEMU on the arm64
VM. Node reports `process.arch === "x64"` and the clean displayless preflight
passes.

The initial `node-datachannel` run loads the x86-64 native artifact and reaches
the production test, but the amd64 Podman client used for nested PostgreSQL
control crashes under QEMU. Moving PostgreSQL outside emulation removes that
unrelated failure.

An attempted full minimized-Werift production run completes artifact
construction, integrity checks, dependency installation, and the clean x64
preflight. Emulated Chromium exits before `browser.newContext()`. The passing
x64 evidence therefore covers the exact architecture-neutral server runtime,
not an emulated browser.

## Native CI matrix

`.github/workflows/ci.yml` contains matching `ubuntu-24.04` x64 and
`ubuntu-24.04-arm` arm64 lanes. Each lane pins Node 22.23.1, installs the
headless Chromium shell, asserts the native Node architecture, and runs the
minimized-Werift production proof without a display server.

The production protocol spans this repository and `markwylde/terminay.com`.
The CI job is disabled unless `TERMINAY_HOSTED_WEBRTC_REF` names a published
hosted-service revision with the matching hardened protocol. No compatible
hosted-service revision is published in this evidence set, so the native CI
matrix is configured but unexecuted. The local proof explicitly uses the
`terminay.com-headless-webrtc-security` sibling worktree and does not modify
the hosted-service main clone.

## Reproduction

The clean local arm64 artifact proof is:

```sh
TERMINAY_PROOF_RUNTIME=secure-werift TERMINAY_RUNTIME_ONLY=1 \
  sh scripts/run-production-headless-webrtc-linux-container.sh arm64
```

The x64 command runs under architecture emulation on an arm64 Podman VM and
does not substitute for the gated native x64 CI lane:

```sh
TERMINAY_PROOF_RUNTIME=secure-werift TERMINAY_RUNTIME_ONLY=1 \
  sh scripts/run-production-headless-webrtc-linux-container.sh x64
```
