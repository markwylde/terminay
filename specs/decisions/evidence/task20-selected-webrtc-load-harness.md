# Task 20 selected WebRTC load harness

Status: implemented, release evidence pending.

`scripts/task20-secure-werift-multi-peer-load.test.mjs` is an opt-in release
probe against the verified selected artifact. It does not import `werift` from
the repository dependency graph and has no node-datachannel fallback. The
runtime root is verified by the production `loadSelectedSecureWeriftRuntime`
boundary before any peers are created.

The probe creates six real peer pairs by default and four ordered data channels
per pair (`api`, `asset`, `control`, and `terminal`). It sustains binary traffic,
keeps both native `bufferedAmount` and a deliberately slow asset consumer's
application queue within explicit bounds, closes one pair halfway through the
run, creates and connects a replacement pair on the same required direct or
relay route, then verifies that traffic continues and every selected-runtime
UDP resource is reclaimed. It records the single crash and recovery, replacement
route, CPU time, RSS growth, native buffering, application queue depth, bytes,
frames, peer count, mode, architecture, and resources before/after without
retaining payload or peer identities.

Run the same probe in each supported release architecture lane:

```sh
TERMINAY_SELECTED_WEBRTC_RUNTIME_ROOT=/absolute/selected/runtime \
  node --test scripts/task20-secure-werift-multi-peer-load.test.mjs
```

For the relay lane, start the existing local coturn fixture and additionally
set `TERMINAY_WEBRTC_LOAD_MODE=turn`, `TERMINAY_TURN_CONFIG_PATH`, and
`TERMINAY_TURN_PORT`. The harness derives short-lived REST credentials from the
fixture's `static-auth-secret` and forces relay-only ICE.

This document is deliberately not pass evidence yet. Chromium interoperability
is now proven separately; the Task 20 operational follow-up remains pending until both
direct and coturn load modes pass, admission-exhaustion is composed into the
release lane, and the recorded bounds pass on every supported release
architecture.

Local harness validation on `darwin-arm64` completed the default direct profile
with six simultaneous peer pairs and 24 real data channels for 10 seconds:
81,219 frames and 332,673,024 bytes were sent; the slow-consumer queue remained
at or below 128 frames with zero rejected frames; native buffering peaked at
28,672 bytes; CPU time was 11,454.388 ms; RSS growth was 173,375,488 bytes; and
all Werift UDP resources were reclaimed after the mid-run peer crash and final
cleanup. This is useful local runtime evidence, but is not a substitute for the
open coturn and supported-architecture lanes.

The selected `0.24.1-candidate.1` artifact carries a governed source patch for
Werift's TURN allocation-refresh lifecycle. The exact patch SHA-256 is bound by
the selection manifest, deterministic provenance materials, and source
correspondence before the extracted npm source is bundled. Two independent
builds and archives matched, and artifact inventory, checksums, provenance,
SBOM, notices, licenses, and source correspondence verified.

With that artifact, the sustained local coturn profile completed four
simultaneous relay-only pairs and 16 real channels for five seconds: every
nominated route was `relay`/UDP/`relay`; 29,731 frames and 121,778,176 bytes
were sent; the slow-consumer queue remained at or below 128 frames with zero
rejections; native buffering peaked at 77,824 bytes; CPU time was 5,957.163 ms;
RSS growth was 158,498,816 bytes; and final resources contained only the
process's existing `PipeWrap`. This specifically regresses the prior Werift
defect where one uncancellable allocation-refresh `Timeout` remained per
closed relay peer.

The adjacent production-host admission composition remains green: the focused
host tests fill the configured pending-native-setup limit, reject the excess
attempt before signaling or peer allocation, then verify aggregate concurrent
setup measurements and identity-free cleanup (2/2 passing in
`apps/terminay-server/test/node-datachannel-host.test.mjs`). This closes the
locally deterministic admission seam, but it does not turn the unrun
release-architecture matrix into pass evidence.

A post-recovery rerun on `darwin-arm64` restaged the selected runtime from two
independent builds. The archive SHA-256 remained
`e97f2f0560f46b9bdf2767c87dccad66b5171ea020f4dde42ebf5cfdde964633`
and the patched bundled runtime remained
`d195bcdb45edc1ecd7866a0d66d2f3f769829b78b7441510a1fc3eb792638e78`,
confirming that the governed timer patch survived recovery. The 10-second
direct profile completed six pairs and 24 channels with host/UDP/host routes,
53,367 frames, 218,591,232 bytes, a maximum application queue of 128, zero
rejections, 28,672 bytes of peak native buffering, 12,183.649 ms CPU time, and
169,295,872 bytes RSS growth. Final resources contained only the process's
existing `PipeWrap`.

The corresponding five-second coturn profile completed four pairs and 16
channels with every route relay/UDP/relay: 17,467 frames, 71,544,832 bytes, a
maximum application queue of 128, zero rejections, 40,960 bytes of peak native
buffering, 6,040.397 ms CPU time, and 1,064,960 bytes RSS growth. Both
pre-existing `PipeWrap` resources remained and no `Timeout`, socket, or other
Werift resource leaked. The focused admission composition also remained 2/2
passing after filling pending native setup capacity, rejecting excess work
before allocation, and verifying identity-free aggregate measurements.
