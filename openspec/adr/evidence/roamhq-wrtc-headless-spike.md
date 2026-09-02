# `@roamhq/wrtc` headless candidate evidence

Date: 2026-07-27

This is candidate evidence for
[Server architecture decision spikes](../../changes/archive/2026-07-27-server-architecture-decision-spikes/).
It does not select a WebRTC runtime or satisfy the complete Headless WebRTC
gate.

## Candidate and environment

- npm package: `@roamhq/wrtc@0.10.0`
- package license: BSD-2-Clause
- native interface: Node-API v3
- embedded WebRTC branch: libwebrtc M106
- test runtime: Node `v22.23.1`
- exercised host: Darwin arm64, without Electron, Chromium, a browser, or a
  display server
- isolated install: temporary npm project outside the Terminay workspace
- isolated `npm audit`: no known dependency advisories

The package does not declare a Node engine. Its README marks Node 22 as
supported on Linux x64 and macOS arm64, but marks Linux arm64 with `?`.

## Executable proof

Two `RTCPeerConnection` instances exchanged descriptions and trickled ICE
candidates directly in one plain Node process. Three reliable, ordered data
channels named `api`, `terminal`, and `asset` opened successfully.

The proof verified:

- 64 ordered messages in each direction on both the `api` and `terminal`
  channels;
- an 8 MiB binary transfer in each direction on the `asset` channel;
- 48 KiB framed chunks with monotonic sequence numbers;
- exact byte counts and matching SHA-256 digests;
- a sender high-water mark of 256 KiB and drain target of 64 KiB;
- explicit close of both ends of every channel and both peers;
- closed channel and peer states; and
- natural process exit without calling `process.exit()`.

The binary directions ran sequentially so both directions exercised the same
bounded sender without a loopback-only simultaneous-send assumption.

| Measurement | Left to right | Right to left |
| --- | ---: | ---: |
| Bytes | 8,388,608 | 8,388,608 |
| Chunks | 171 | 171 |
| SHA-256 | `f9da0f11f7bbfedba19c86be980c9fa92f7c7c95a4797e353385680b23280770` | `f9da0f11f7bbfedba19c86be980c9fa92f7c7c95a4797e353385680b23280770` |
| Backpressure waits across recorded runs | 16–18 | 15–17 |
| Maximum observed native buffer | 294,960 bytes | 294,960 bytes |

Both peer `connectionState` values and all six channel `readyState` values were
`closed` after shutdown. `process.getActiveResourcesInfo()` reported no
non-stdio, non-watchdog resource after close.

The recorded run transferred both binary directions and closed in 3,336 ms.
External wall time through natural process exit was 3.38 seconds.

## Backpressure API blocker

`@roamhq/wrtc` does not implement the standard
`RTCDataChannel.bufferedAmountLowThreshold` property or the
`bufferedamountlow` event.

The exercised data-channel prototype exposes `bufferedAmount`, but neither
low-water member. Assigning `bufferedAmountLowThreshold` creates an ordinary
JavaScript property and no event fires. A first proof that waited for
`bufferedamountlow` stalled until its 10-second watchdog rejected.

The successful proof therefore polls `bufferedAmount` with a bounded
two-millisecond delay while above the low-water target. This bounds queued
bytes but is less efficient than an event-driven adapter. A Terminay adapter
would need this polling behavior or protocol acknowledgements rather than the
browser-style low-water event used by the `werift` candidate.

## Published native artifacts

The generic package declares exact `0.10.0` optional dependencies for all three
required candidates:

- `@roamhq/wrtc-linux-x64`;
- `@roamhq/wrtc-linux-arm64`; and
- `@roamhq/wrtc-darwin-arm64`.

Isolated npm installs using explicit `--os` and `--cpu` selected the matching
Linux package without running a local compile. Registry tarballs contain one
native binary plus an index, README, and package manifest:

| Package | Archive / unpacked | Inspected binary |
| --- | ---: | --- |
| `@roamhq/wrtc-linux-x64@0.10.0` | 9,532,442 / 26,221,950 bytes | ELF x86-64 |
| `@roamhq/wrtc-linux-arm64@0.10.0` | 8,321,094 / 21,706,514 bytes | ELF ARM aarch64 |
| `@roamhq/wrtc-darwin-arm64@0.10.0` | 8,158,856 / 25,056,316 bytes | Mach-O arm64 |

All three export the Node-API registration symbols. The Darwin arm64 artifact
installed and ran under Node 22.

### Linux compatibility constraints

Both Linux artifacts reference symbols through glibc 2.34 and dynamically
depend on `libasound.so.2`, in addition to libc, libm, and libgcc. They are not
self-contained headless-server artifacts.

This excludes distributions with older glibc and requires an ALSA runtime
library even when Terminay uses data channels only. Clean Linux execution must
therefore test the declared supported distributions and confirm that the
standalone archive either supplies or explicitly installs the ALSA dependency.

The local Podman machine stopped immediately after startup, so the Linux
binaries could not be loaded or exercised here. Artifact inspection is not a
substitute for the Linux x64 and arm64 runtime gate.

The Darwin artifact has a minimum macOS version of 11.0 and links AppKit,
AVFoundation, CoreFoundation, CoreGraphics, Foundation, and libSystem. It is
ad-hoc linker-signed rather than signed with a development team.

## Maintenance and security observations

Version 0.10.0 was published on 2026-03-10 and its changelog includes a cleanup
crash fix. The repository remained active after the release.

The release updates its embedded WebRTC from M98 to M106. M106 is nevertheless
an old WebRTC branch, so a clean npm audit does not establish that the bundled
native WebRTC stack contains current upstream security fixes. A native-code
vulnerability review and an explicit update policy are required before
selection.

The source tag contains no checked-in CI workflow proving the published Linux
arm64 artifact on Node 22. The package's own support table also leaves that
combination unconfirmed.

## Reproduction outline

Create an isolated project and run the proof with the pinned baseline:

```sh
SPIKE_DIR="$(mktemp -d /tmp/terminay-roamhq-wrtc.XXXXXX)"
npm --prefix "$SPIKE_DIR" init -y
npm --prefix "$SPIKE_DIR" install --save-exact @roamhq/wrtc@0.10.0
NODE_PATH="$SPIKE_DIR/node_modules" \
  npx --yes node@22.23.1 \
  scripts/spikes/headless-webrtc-roamhq-wrtc.cjs
```

Run that command from the Terminay worktree. The proof creates both peers in
the same displayless process, forwards each
non-null ICE candidate to the other peer, verifies ordered text, frames binary
chunks with a sequence number, polls `bufferedAmount` at the declared
high/low-water limits, compares hashes, closes channels and peers, and permits
the Node process to exit naturally.

Cross-platform package selection can be inspected without installing into the
Terminay workspace:

```sh
npm install --os=linux --cpu=x64 @roamhq/wrtc@0.10.0
npm install --os=linux --cpu=arm64 @roamhq/wrtc@0.10.0
npm pack @roamhq/wrtc-linux-x64@0.10.0
npm pack @roamhq/wrtc-linux-arm64@0.10.0
npm pack @roamhq/wrtc-darwin-arm64@0.10.0
```

## Evidence still missing

- clean Linux x64 and Linux arm64 Node 22 execution;
- install and load on every supported minimum glibc distribution;
- a standalone-archive proof for the `libasound.so.2` dependency;
- production Terminay signaling, signed signaling, first pairing, saved
  reconnect, revocation, and channel isolation;
- STUN and TURN on real NAT-constrained networks;
- disconnect, reconnect, peer crash, candidate failure, and forced-shutdown
  behavior;
- sustained multi-client CPU, memory, thread, descriptor, and throughput
  measurements;
- Electron-supervised compatibility through the same adapter; and
- a security-maintenance decision for embedded libwebrtc M106.

## Primary evidence sources

- npm generic package:
  `https://registry.npmjs.org/@roamhq/wrtc/-/wrtc-0.10.0.tgz`
- npm Linux x64 package:
  `https://registry.npmjs.org/@roamhq/wrtc-linux-x64/-/wrtc-linux-x64-0.10.0.tgz`
- npm Linux arm64 package:
  `https://registry.npmjs.org/@roamhq/wrtc-linux-arm64/-/wrtc-linux-arm64-0.10.0.tgz`
- npm Darwin arm64 package:
  `https://registry.npmjs.org/@roamhq/wrtc-darwin-arm64/-/wrtc-darwin-arm64-0.10.0.tgz`
- source tag:
  `https://github.com/WonderInventions/node-webrtc/tree/v0.10.0`
