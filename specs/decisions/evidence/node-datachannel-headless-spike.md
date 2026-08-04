# `node-datachannel` headless candidate evidence

Date: 2026-07-27

This is candidate evidence for
[Server architecture decision spikes](../../tasks_completed/3-server-architecture-decision-spikes.md).
It does not select a WebRTC runtime or satisfy the complete Headless WebRTC
gate.

## Candidate and environments

- npm package: `node-datachannel@0.32.3`
- package license: MPL-2.0
- declared Node engine: `>=18.20.0`
- native interface: Node-API v8
- test runtime: Node `v22.23.1` in both Linux lanes
- Linux arm64: architecture-native container in an arm64 Podman Linux VM on
  Apple Silicon
- Linux x64: architecture-emulated container in the same arm64 Podman VM;
  this is not evidence from physical x64 hardware
- both tests run without Electron, Chromium, a browser, or a display server
- each wrapper run creates and removes a fresh temporary npm project outside
  the Terminay workspace
- both clean Linux images have no `cc`, `c++`, `gcc`, `g++`, `clang`,
  `clang++`, `cmake`, `make`, or `ninja`
- both isolated installs resolve the published native prebuild without a
  compiler toolchain

The package version is `0.32.3`; `getLibraryVersion()` reports the embedded
libdatachannel version as `0.24.2`.

## Executable proof

The checked-in proof is
[`scripts/spikes/headless-webrtc-node-datachannel.mjs`](../../../scripts/spikes/headless-webrtc-node-datachannel.mjs).
The wrapper test is
[`scripts/headless-webrtc-node-datachannel.test.mjs`](../../../scripts/headless-webrtc-node-datachannel.test.mjs).
The wrapper writes an isolated package manifest, installs exactly
`node-datachannel@0.32.3`, inspects the installed binary, launches the proof in
a child Node process, requires natural child exit, and removes the temporary
project. It does not add a root dependency.

Two `PeerConnection` instances exchange their local descriptions and ICE
candidates directly in a plain Node process. The proof uses three reliable,
ordered data channels named `api`, `asset`, and `terminal`, and verifies:

- connection and channel-open events for both peers;
- 1,000 ordered text messages in each direction on every channel;
- a 16 MiB binary transfer in 64 KiB payload frames;
- sequence headers and acknowledgement messages on every binary frame;
- an application sender window capped at 64 frames, or 4 MiB, in the Linux
  evidence runs;
- exact received byte count and a stable SHA-256 digest;
- close events on both ends of the channel;
- explicit close of both peers followed by the library `cleanup()` call; and
- natural process exit with no active non-stdio handles after cleanup.

The reproducible Linux runs produced:

| Measurement | Linux arm64, native architecture | Linux x64, emulated architecture |
| --- | ---: | ---: |
| Node | 22.23.1 | 22.23.1 |
| Ordered text messages | 1,000 each direction per channel | 1,000 each direction per channel |
| Binary bytes | 16,777,216 | 16,777,216 |
| Binary SHA-256 | `2755ce9870e28532a2dc174d69313ae6784873b17a7e67f12622641bbd4defb4` | same |
| Negotiated maximum message size | 262,144 bytes | 262,144 bytes |
| Acknowledgement-window bound | 4,194,304 bytes | 4,194,304 bytes |
| Maximum application in-flight data | 4,194,304 bytes | 4,194,304 bytes |
| Application pressure waits | 192 | 192 |
| `sendMessageBinary(false)` results | 253 | 196 |
| Maximum native `bufferedAmount()` | 3,997,940 bytes | 1,638,500 bytes |
| Proof duration | 16,232 ms | 2,148 ms |
| Complete install/inspect/proof test | 18,996 ms | 11,152 ms |
| Active non-stdio handles after cleanup | 0 | 0 |

The native-architecture arm64 lane used loopback netem delay of 50 ms and a
20 Mbit rate to exercise sustained pressure. The emulated x64 lane exercised
the same bounded window without netem because the emulated `tc` command could
not configure the arm64 host kernel. Both lanes reached real false send-return
paths and applied the same no-retry rule.

The application acknowledgement window supplies a deterministic end-to-end
bound independent of native buffer timing.

## Send return-value caveat

With the SCTP send buffer constrained to 32 KiB,
`sendMessageBinary()` returned `false` 253 times on Linux arm64 and 196 times
on Linux x64. Every corresponding unique frame was nevertheless delivered
exactly once.

An earlier diagnostic retried a frame when the method returned `false`. The
receiver obtained more bytes than the sender's logical transfer size, proving
that `false` does not mean that the payload was rejected and safe to retry.
The package API documentation declares a Boolean result but does not define
this acceptance semantic. Its bundled `DataChannelStream` currently treats
`false` as a failed write, which can report an error after data has already
been accepted.

A Terminay adapter must not retry based solely on this Boolean. Protocol-level
sequence identities, acknowledgements, deduplication, and a bounded sender
window remain necessary. The upstream meaning of the return value needs
confirmation before relying on the bundled stream wrapper.

## Published native artifacts

The `v0.32.3` GitHub release was published on 2026-04-26 and contains Node-API
v8 prebuilds for:

- Darwin arm64 and x64;
- GNU/Linux x64, arm64, and arm;
- musl Linux x64, arm64, and arm; and
- Windows x64, arm64, and x86.

The required release files exist and unpack as the expected native
architectures. The GNU/Linux x64 and arm64 files are also installed and loaded
by the clean Node 22 wrapper runs:

| Asset | Inspected binary |
| --- | --- |
| `node-datachannel-v0.32.3-napi-v8-linux-x64.tar.gz` | ELF x86-64, GNU/Linux; installed and exercised under architecture emulation |
| `node-datachannel-v0.32.3-napi-v8-linux-arm64.tar.gz` | ELF ARM aarch64, GNU/Linux; installed and exercised natively in the arm64 VM |
| `node-datachannel-v0.32.3-napi-v8-linuxmusl-x64.tar.gz` | ELF x86-64, SYSV/musl build |
| `node-datachannel-v0.32.3-napi-v8-linuxmusl-arm64.tar.gz` | ELF ARM aarch64, SYSV/musl build |
| `node-datachannel-v0.32.3-napi-v8-darwin-arm64.tar.gz` | Mach-O arm64; installed and exercised |

The tagged upstream Linux workflow builds and tests Debian and Alpine variants
for amd64, arm64, and arm under containers/QEMU. The tagged macOS arm64
workflow builds and tests on `macos-14`. Those workflows build and test with
Node 18, then publish Node-API v8 artifacts. The npm publish workflow uses Node
20.

`readelf` and `ldd` show that both exercised GNU/Linux binaries depend only on
the matching dynamic loader plus `libdl`, `libpthread`, `libm`, and `libc`.
There is no separately distributed WebRTC, OpenSSL, or C++ runtime dependency.
The arm64 build id is
`0b3c82783face1612ac146e75a504720f987085a`; the x64 build id is
`8bb796005ef530a07045b4f86eff9f06ee55054a`. These match the inspected
published release files.

Node-API v8 and the declared engine range are exercised successfully under
Node 22 on both required GNU/Linux architectures. Upstream itself runs the
tagged native test workflows on Node 18 rather than Node 22.

## Supply-chain and maintenance observations

- npm reports one package maintainer.
- The npm tarball has registry integrity metadata and an npm registry
  signature.
- The `v0.32.3` Git tag commit is unsigned.
- The repository was active after the release and was not archived when this
  evidence was collected.
- The install path depends on deprecated `prebuild-install@7.1.3`.

The separate
[native supply-chain audit](./node-datachannel-native-supply-chain.md)
verifies every release archive and native binary. It finds that the published
Linux prebuilds statically contain end-of-life OpenSSL `1.1.1w`, the
macOS/Windows prebuilds contain OpenSSL `3.6.2` affected by later advisories,
and the binding pins libdatachannel before later DTLS/ICE memory-safety and
synchronization fixes. A zero-advisory npm audit does not cover those bundled
C/C++ components. The current upstream prebuilds are therefore a selection
blocker even though their behavior proof passes.

## Evidence still missing

- execution on physical/native Linux x64 hardware rather than architecture
  emulation;
- execution of the published musl x64 and arm64 builds;
- native Linux execution of the
  [production Terminay integration](node-datachannel-production-headless-spike.md),
  whose host-level proof covers signaling, signed first pairing, two-factor
  reconnect, revocation, isolated traffic channels, and bounded assets;
- STUN and TURN on hostile or NAT-constrained networks;
- behavior during transport loss, candidate failure, peer crash, and forced
  shutdown;
- sustained multi-client CPU, memory, file-descriptor, and throughput
  measurements;
- confirmation or upstream resolution of `sendMessageBinary()` Boolean
  semantics; and
- Electron-supervised compatibility using the same adapter; and
- a patched, supported, provenance- and license-complete native payload rather
  than the current affected upstream prebuilds.

The native-architecture arm64 lane is strong local evidence for that target.
The x64 lane proves artifact selection, linking, Node 22 loading, protocol
behavior, and clean shutdown under architecture emulation, but it does not
replace a final release smoke test on native x64 hardware.

## Reproduction

The host-level isolated wrapper is:

```sh
node --test scripts/headless-webrtc-node-datachannel.test.mjs
```

The clean-container evidence sets:

```text
TERMINAY_SPIKE_REQUIRE_NO_COMPILER=1
TERMINAY_SPIKE_EXPECT_FALSE_SEND=1
TERMINAY_SPIKE_MAX_IN_FLIGHT_CHUNKS=64
```

The arm64 container runs from `node:22-bookworm-slim` with `--arch arm64`.
The x64 container uses the same image and command with `--arch amd64`.
`file`, `binutils`, and, for arm64 network shaping, `iproute2` are installed
only for inspection and test control; no compiler or build system is present.

## Primary evidence sources

- npm metadata and tarball:
  `https://registry.npmjs.org/node-datachannel/-/node-datachannel-0.32.3.tgz`
- tagged release and assets:
  `https://github.com/murat-dogan/node-datachannel/releases/tag/v0.32.3`
- tagged Linux build/test workflow:
  `https://github.com/murat-dogan/node-datachannel/blob/v0.32.3/.github/workflows/build-linux.yml`
- tagged macOS arm64 build/test workflow:
  `https://github.com/murat-dogan/node-datachannel/blob/v0.32.3/.github/workflows/build-mac-m1.yml`
- package API:
  `https://github.com/murat-dogan/node-datachannel/blob/v0.32.3/API.md`
