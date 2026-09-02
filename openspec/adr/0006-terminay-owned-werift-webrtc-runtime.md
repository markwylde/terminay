# ADR-0006: Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime

Status: accepted
Date: 2026-07-27

## Context

Remote access needs WebRTC in a headless Node server — no browser, no display
server. Three runtimes were evaluated, each proven with a displayless session
carrying three ordered data channels plus a bounded binary transfer:

| Candidate | Passing evidence | Selection blockers |
| --- | --- | --- |
| Terminay-owned Werift 0.24.1 ESM artifact | Pure TypeScript displayless session; three ordered channels; bounded transfer; exact production pairing, two-factor reconnect, signed signaling, terminal, revocation, direct ICE, authenticated TURN-only relay, and natural exit; two independent candidate builds have an identical allowlist and hashes; npm tarball, source commit, every retained dependency, notices, source correspondence, and SBOM are pinned; Node 22 and Electron-main/child imports pass; minimized executable graph has zero critical/high npm advisories; the same deterministic artifact passes native Linux arm64 and emulated Linux x64 runtime proofs | Published package unchanged still installs high-advisory `werift-ice -> ip`; native release certification, sustained real multi-peer ceilings, and release integration remain outstanding |
| `node-datachannel` 0.32.3 | Displayless Node 22 ordered/binary session; protocol ACK window; clean shutdown; audited isolated install; clean Linux arm64 and emulated x64 execution from published N-API v8 artifacts without a compiler | Published Linux prebuilds statically contain EOL OpenSSL 1.1.1w; macOS/Windows contain OpenSSL 3.6.2 affected by later advisories; the binding predates later libdatachannel DTLS/ICE fixes; a physical/native Linux x64 run and production signaling/TURN/reconnect gates remain; Boolean send result is not a safe acceptance/retry signal |
| `@roamhq/wrtc` 0.10.0 | Displayless Node 22 three-channel session; bounded bidirectional 8 MiB transfer; clean shutdown; audited isolated install | No low-water event; Linux requires glibc 2.34 and ALSA; Linux arm64 support is unconfirmed; bundled libwebrtc M106 needs explicit native security review |

`werift` is pure TypeScript and so carries the lowest native packaging risk, but
the published package's stale dependency metadata installs the vulnerable legacy
ICE chain (`werift-ice -> ip`, `GHSA-2p57-rm9w-gvfp`). Its ESM entry is already
bundled from the rewritten ICE implementation, imports neither legacy package,
and has a smaller actual dependency graph — which makes a minimized, pinned
artifact viable without patching upstream behaviour.

Detailed candidate records:

- [node-datachannel headless spike](./evidence/node-datachannel-headless-spike.md)
- [node-datachannel native supply-chain audit](./evidence/node-datachannel-native-supply-chain.md)
- [secure Werift production-runtime spike](./evidence/secure-werift-production-spike.md)
- [@roamhq/wrtc headless spike](./evidence/roamhq-wrtc-headless-spike.md)

## Decision

Terminay Server uses a Terminay-owned, deterministic, ESM-only artifact derived
from Werift 0.24.1 behind a WebRTC peer adapter. Pairing, authorization,
signaling, and the application protocol remain outside that adapter.

The machine-readable selection record is `build/webrtc-runtime/selection.json`.
Release packaging and runtime loading must consume that exact record rather than
infer a runtime from installed packages or environment variables.

The production loader verifies the selected identity and complete deterministic
payload before importing executable code. If that artifact cannot be verified,
the server WebRTC adapter stops with an actionable diagnostic. Terminay does not
fall back to the blocked `node-datachannel` prebuilds or to the published Werift
package.

## Consequences

- Terminay owns a build step for its WebRTC runtime and must track upstream
  Werift changes itself, rather than consuming the published package.
- A verification failure is a hard stop rather than a degraded mode, which
  prevents an unverified transport from ever carrying application data.
- The adapter boundary keeps pairing, authorization, signaling, and the
  application protocol independent of the chosen runtime, so a future
  replacement does not reach into the protocol layers.
- Had `node-datachannel` been selected, its Boolean `sendMessageBinary` return
  would have required an adapter rule: the arm64 run observed 253 false results
  and the x64 run 196, none of which indicated actual loss — sequence framing,
  receiver deduplication, acknowledgements, exact byte count, and SHA-256
  verification proved delivery. The Boolean return is not a reliable
  message-acceptance signal.

### Evidence

`scripts/production-webrtc-turn-routes.test.mjs` builds and audits the exact
minimized artifact, starts an isolated authenticated coturn instance, and runs
the production `runHost` surface. Its direct browser-to-Werift terminal route
selects a nominated host/peer-reflexive pair. Its forced relay-only
Werift-to-Werift terminal route selects nominated, succeeded relay/relay UDP
pairs at both peers. Separate attempts with a wrong REST credential and an
expired timestamp credential produce no selected pair and no terminal traffic.
The temporary coturn secret remains in a mode-0600 config, is absent from
arguments and environment values, and is checked against captured output.

The settings parser accepts the legacy comma-separated URL form and a strict
structured JSON form. The structured form preserves paired TURN username and
credential fields through `RemoteAccessService` into `HostConfig`; bounded
entry/URL counts, scheme validation, unknown-key rejection, and redacted errors
keep that configuration surface closed.

The isolated Werift fixture proof (`npm run test:spike-headless-webrtc`) copies a
pinned fixture lockfile into a fresh temporary directory, runs
`npm ci --ignore-scripts`, and executes an offerer and answerer in a plain Node
process with no Electron, Chromium, browser, or display server. It verifies
offer/answer/ICE gathering on both peers; separate ordered `api`, `asset`, and
`terminal` channels; 32 ordered messages each way on every channel; an 8 MiB
asset transfer in 48 KiB chunks with a 256 KiB high-water and 64 KiB low-water
mark using `bufferedAmountLow`; exact chunk order, byte count, and SHA-256
equality at the receiver; and release of every Werift socket and timer before
natural process exit within 15 seconds. `werift` 0.24.1 is pinned only in
`scripts/spikes/werift-fixture/package-lock.json` and is absent from the root
application dependency graph.

Measurements recorded 2026-07-27, Node 22.23.1 on Darwin arm64:

| Measurement | Result |
| --- | ---: |
| ICE candidates | 4 host, 4 client |
| Offer / answer SDP | 910 / 909 bytes |
| Asset transfer | 8,388,608 bytes in 171 chunks |
| Backpressure waits | 28 |
| Maximum observed buffered amount | 294,912 bytes |
| Asset transfer time | 673 ms |
| Peer/channel close time | 11 ms |
| Total proof time | 923 ms |
| Active resources after close | one stdout `PipeWrap`; no Werift socket or timer |

The same test also passes under Node 24.15.0.

The candidate builder proves deterministic source identity, a complete retained
dependency lock, notices and license texts, a CycloneDX SBOM, an exact file
allowlist and hashes across two builds, Node 22 execution, and import from both
an Electron main process and its server child.

The `node-datachannel` candidate proof
(`scripts/headless-webrtc-node-datachannel.test.mjs`) installed exactly 0.32.3
into a fresh temporary project, inspected its native binary, and ran a child
proof exchanging 1,000 sequenced messages both ways on three ordered channels
plus a 16 MiB binary payload through a bounded ACK window, on native arm64 in an
arm64 Podman VM under 50 ms/20 Mbit loopback shaping and on x64 under
architecture emulation in the same VM. Both native modules dynamically require
only the matching loader plus standard system `libdl`, `libpthread`, `libm`, and
`libc`, and both child proofs closed all peers and channels and exited naturally.
The full native audit verified all 11 release archives and binaries and found the
OpenSSL and libdatachannel exposures listed above, which `npm audit` does not
cover.

## Open items

- Native release certification, sustained real multi-peer ceilings, trusted
  provenance attestation, update-response operations, and release integration
  remain outstanding gates. They do not weaken this selection.
- The isolated Werift fixture proof is intentionally narrower than the selection
  gate: it does not by itself prove production signaling, first pairing, saved
  reconnect, revocation, signed-signal replay rejection, STUN/TURN,
  hostile-network behaviour, Linux x64/arm64 distribution, sustained
  multi-client resource use, or security maintenance. The production route,
  pressure, revocation, and cleanup tests close the transport-viability gate.
