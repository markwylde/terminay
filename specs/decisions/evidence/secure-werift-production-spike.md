# Secure Werift production-runtime evidence

Date: 2026-07-28

This record evaluates the smallest supportable alternative to the blocked
`node-datachannel@0.32.3` prebuilds. It proves a candidate path; it does not
select a runtime or authorize a production dependency.

## Finding

A Terminay-owned, ESM-only Werift artifact is the current front-runner.
The published `werift@0.24.1` package remains unacceptable unchanged because
its dependency metadata installs the legacy `werift-ice -> ip` chain and
`npm audit` reports `GHSA-2p57-rm9w-gvfp` as high severity.

The package's ESM entry is a bundled artifact with a different dependency
shape:

- its ICE implementation parses addresses with `node:net`;
- it imports neither `ip` nor `werift-ice`; and
- its actual external imports resolve through seven JavaScript packages.

An integrity-pinned candidate repacks that ESM output with only those imports.
Its isolated production dependency graph reports zero critical or high npm
advisories. The same artifact completes the isolated legacy
bootstrap/terminal compatibility flow when the sibling integration proof is
explicitly enabled; it does not prove the sibling peer owner's canonical
four-channel bridge.

This result removes the known high advisory from the executable graph. It is
not a claim that `npm audit` proves the TypeScript WebRTC implementation free
of security defects.

## Reproducible proof

Run:

```sh
npm run test:spike-production-headless-webrtc-secure-werift
```

The default command always builds, compares, audits, imports, and
fail-closed-verifies the candidate. It reports the sibling-dependent browser
proof as an explicit skip. Run that integration only after the sibling peer
owner installs the ticket-bound canonical bridge:

```sh
TERMINAY_RUN_SIBLING_WEBRTC_BRIDGE_PROOF=1 \
  npm run test:spike-production-headless-webrtc-secure-werift
```

[`scripts/build-secure-werift-candidate.mjs`](../../../scripts/build-secure-werift-candidate.mjs)
and
[`scripts/production-headless-webrtc-secure-werift.test.mjs`](../../../scripts/production-headless-webrtc-secure-werift.test.mjs)
perform the following work outside the repository dependency graph:

1. performs two independent installs with dependency scripts disabled;
2. verifies the exact version, integrity, and declared license of all 35
   retained package install paths, including npm's nested `tslib`;
3. downloads exactly `werift@0.24.1` and verifies npm integrity, SHA-512,
   registry `gitHead`, and the source repository's license hash;
4. extracts only the published ESM entry and creates a private candidate;
5. rejects exact `ip` and `werift-ice` packages, imports from those packages,
   undeclared files, and a source-map reference;
6. emits a runtime lock, upstream source correspondence, an explicit source-map
   policy, verbatim license files, third-party notices, CycloneDX 1.6 SBOM, and
   `SHA256SUMS`;
7. compares the exact allowlist and every SHA-256 across the two builds;
8. runs `npm audit --omit=dev --audit-level=high`;
9. runs the 8 MiB bounded transfer and natural-shutdown proof with exactly
   Node 22.23.1;
10. imports the same artifact from a real Electron main process and from its
    `ELECTRON_RUN_AS_NODE` server child;
11. runs the existing production remote service and coordinator against the
   real hosted signaling service and Chromium's native `RTCPeerConnection`,
   including explicit six-digit browser enrollment, terminal data-channel
   input/output, PIN-free saved-grant reconnect, and denial after device
   revocation; and
12. removes both complete temporary projects after natural process exit.

Exact upstream identity:

| Property | Value |
| --- | --- |
| npm package | `werift@0.24.1` |
| npm integrity | `sha512-8Mpf0FWO2pkd9UQyZ0Hb1CcimydlNh8KCvZGD2X/D0ucVY6ubJxX91cndOpTOnPA7wleopop044VSNZeCEwgeA==` |
| tarball SHA-512 | `f0ca5fd0558eda991df544326741dbd427229b2765361f0a0af6460f65ff0f4b9c558eae6c9c57f7572774ea533a73c0ef095ea29a29d38e1548d65e084c2078` |
| npm `gitHead` | `243fd7e24c39fbe03fb855928daddd793fc8d4fa` |

Exact external runtime dependencies in the proof:

| Package | Version |
| --- | --- |
| `@fidm/x509` | `1.2.1` |
| `@noble/curves` | `1.9.7` |
| `@peculiar/x509` | `1.14.3` |
| `@shinyoshiaki/binary-data` | `0.6.1` |
| `debug` | `4.4.0` |
| `multicast-dns` | `7.2.5` |
| `tweetnacl` | `1.0.3` |

The artifact gates pass on Darwin arm64 with Node 24.14.0 as the test runner,
Node 22.23.1 as the bounded runtime, and Electron 42.7.1 for the main/child
import. The candidate contains 44 allowlisted files: its runtime and metadata,
the Werift MIT license, and one verbatim license text for each of the 35 pinned
install paths. The audit reports zero critical and high advisories.

The retained graph deliberately includes `@leichtgewicht/ip-codec`; that is a
distinct maintained codec used by `dns-packet`, not the vulnerable package
named exactly `ip`. Neither exact `ip` nor `werift-ice` appears in the lock,
SBOM, package graph, or ESM imports.

## Artifact contents and source-map policy

The candidate is a release-shaped proof rather than a committed binary:

- `lib/index.mjs` is byte-for-byte the ESM entry from the integrity-pinned npm
  tarball;
- `RUNTIME-LOCK.json` pins every retained install path by version, SHA-512
  integrity, and declared license;
- `LICENSES/` and `THIRD_PARTY_NOTICES.md` preserve the upstream MIT notice and
  every retained third-party license, including BSD-3-Clause, Apache-2.0,
  0BSD, and Unlicense texts;
- `sbom.cdx.json` records the npm package URLs, hashes, versions, licenses, and
  distinct nested install paths;
- `SOURCE-CORRESPONDENCE.json` binds the npm tarball, registry `gitHead`, source
  license, and build policy; and
- `SHA256SUMS` binds every other allowlisted artifact file.

The upstream npm ESM output contains no source map and no `sourceMappingURL`.
The candidate therefore does not invent or distribute a misleading map.
`SOURCE_MAP_POLICY.md` records that choice; the pinned npm tarball and git
commit remain the source correspondence.

## Isolated compatibility-flow result

The runtime-neutral
[`e2e/webrtc-headless-node-host.spec.ts`](../../../e2e/webrtc-headless-node-host.spec.ts)
uses the same production `RemoteAccessService`, `runHost` coordinator, hosted
signaling service, and browser client for both native and Werift candidates.
The secure Werift artifact proves the legacy bootstrap/terminal compatibility
flow, not installation of the sibling peer owner's ticket-bound canonical
four-channel application bridge:

- displayless first pairing through the hosted service;
- origin-bound device-private-key storage;
- saved reconnect requiring both device proof and reconnect grant;
- closed-envelope signed offer, answer, and ICE signaling;
- relay-invisible reconnect signaling keys;
- separate `api`, `asset`, and `terminal` channels;
- acknowledged and bounded asset transfer;
- terminal input and output;
- revocation and rejected reconnect after revocation; and
- coordinator, sockets, timers, hosted service, and browser shutdown followed
  by natural process exit.

The corresponding `node-datachannel` wrapper still passes after the harness
became runtime-neutral.

## Adapter contract discovered by the proof

Werift needs three narrow adapter rules:

1. It emits gathered ICE candidates while the local offer is still being
   installed. The adapter queues those candidates until the authenticated
   answer installs the remote description, so a browser never receives ICE
   before the signed offer.
2. Its candidate `toJSON()` result may contain `undefined` properties. The
   adapter JSON-normalizes the result before signing so the signed object is
   byte-for-byte equivalent to the relay-serialized object.
3. Its default advertised SCTP maximum is 65,536 bytes, smaller than the
   production JSON envelope around one base64 asset chunk. The adapter
   advertises a 1 MiB maximum while the application protocol retains its own
   smaller chunk, acknowledgement-window, and transfer limits.

These rules remain inside the WebRTC peer adapter. Pairing, authorization,
signaling, and application messages remain runtime-independent.

## Candidate comparison and maintenance cost

| Path | Security and provenance | Distribution | Adaptation and ownership |
| --- | --- | --- | --- |
| Published `node-datachannel@0.32.3` prebuild | Blocked by affected/EOL embedded OpenSSL, older libdatachannel fixes, and incomplete native provenance | Broad N-API prebuild matrix already works | Small adapter; large unowned native risk |
| Terminay-built `node-datachannel` | Can use current libdatachannel and supported OpenSSL with a pinned native build | Requires reproducible x64/arm64 and Desktop native artifacts, SBOM, signing, notices, CVE monitoring, and rebuild response | Existing adapter; highest continuing release burden |
| Published `werift@0.24.1` unchanged | Blocked by installed high-advisory legacy dependency | Architecture-neutral JavaScript | Small adapter, but unacceptable graph |
| Terminay-owned Werift ESM artifact | No known critical/high issue in the executable npm graph; exact tarball and source correspondence are available | One JavaScript artifact for Node and Electron architectures | Three small adapter rules; Terminay owns dependency review and upstream merge cadence |
| `@roamhq/wrtc@0.10.0` | Clean npm graph does not cover bundled libwebrtc M106 | Native Linux ALSA/glibc requirements and unconfirmed arm64 | W3C-shaped adapter; old native security branch remains a blocker |

`webrtc-polyfill@1.2.2` wraps the same blocked
`node-datachannel@0.32.3` native payload. New or low-adoption packages without a
credible security history, complete browser interoperability, production
signaling, TURN, and shutdown evidence do not reduce risk merely by avoiding a
compiler.

## Security ownership and update policy

The Terminay server-runtime security owner owns this artifact, even where an
upstream maintainer accepts a packaging improvement. The owner:

- checks npm and GitHub advisories, upstream Werift releases, and changes to
  DTLS, ICE, SCTP, certificate, and crypto dependencies at least weekly and
  before every Terminay release;
- triages a critical report within 24 hours and a high report within three
  business days;
- disables externally exposed WebRTC within 24 hours when a critical issue has
  no demonstrated safe mitigation, and publishes a rebuilt or otherwise
  mitigated release within 72 hours; high issues have a seven-day mitigation
  target;
- reruns browser interoperability, authenticated TURN-only, hostile-network,
  shutdown, resource-pressure, audit, license, SBOM, and double-build equality
  gates for every changed source or dependency pin; and
- reviews the complete retained graph and upstream delta quarterly even when no
  advisory fires.

The fallback is fail-closed: Terminay disables remote WebRTC exposure while
local embedded-server use remains available. A last-known-good candidate is
used only when the reported issue provably does not affect it.
`node-datachannel` is not an automatic fallback while its documented native
security and provenance blockers remain. A new Werift release never enters the
artifact through a range; it requires an explicit identity/pin update, fresh
notices and SBOM, and all candidate gates.

## Open release gates

The candidate is not a selected release artifact. Selection remains open until:

- the exact artifact passes authenticated TURN-only route proof and records
  selected candidate-pair evidence;
- native Linux x64 and arm64 production runs pass on the supported Node floor;
- real multi-peer pressure and memory/CPU ceilings pass;
- `MEDIA_SURFACE_POLICY.md` governs intentional retention of the exact upstream
  closure after an `RTCPeerConnection`-only tree-shaken build twice failed the
  full Chromium connection proof; the privileged runtime loader instead
  projects a frozen capability whose only key is `RTCPeerConnection`;
- the candidate builder and generated metadata are integrated into the actual
  Server/Desktop packaging and provenance-attestation pipeline.

The clean rebuild contract is now implemented by
`scripts/prove-secure-werift-offline-rebuild.mjs`. A distinct acquisition step
populates an npm content-addressed cache plus the pinned upstream license and
writes the exact candidate, package-integrity, tarball, git-head, and license
pins into `mirror.json`. The proof step starts two clean build roots, enables
npm offline mode, reads the license only from the verified mirror, and requires
identical payload hashes and npm archives. CI keeps acquisition and proof as
separate named steps. This is a checked-in, locally executed contract; it is
not a claim that the workflow has run on GitHub-hosted infrastructure.

## Deterministic release metadata and signing hook

The candidate builder emits a fixed CycloneDX 1.6 SBOM, complete retained
license texts and notices, a pinned runtime lock, source correspondence bound
to the npm integrity/tarball digest/git head, deterministic in-toto/SLSA
provenance, and an exact `SHA256SUMS` manifest covering every payload file.
Verification rejects extra files, symlinks, malformed or incomplete checksum
rows, altered provenance subjects, and material drift.

`signSecureWeriftArchive` now provides a detached Ed25519 release hook over the
exact deterministic npm archive without putting a signing key or signature
inside the reproducible payload. Its verifier binds the artifact basename and
SHA-256 before checking the signature, and fails closed for payload mutation or
an unrelated key. Coverage:
`scripts/secure-werift-release-contract.test.mjs`.

This is a locally testable release contract, not evidence that a production
signing key, transparency service, hosted offline rebuild, or published
artifact exists.

Werift has recent releases and repository activity, but no detected
`SECURITY.md` or published security support window. Terminay therefore owns
the release-security decision even if upstream accepts the packaging fix.

## Primary sources

- npm package metadata:
  `https://registry.npmjs.org/werift/0.24.1`
- source commit recorded by npm:
  `https://github.com/shinyoshiaki/werift-webrtc/commit/243fd7e24c39fbe03fb855928daddd793fc8d4fa`
- Werift repository security page:
  `https://github.com/shinyoshiaki/werift-webrtc/security`
- `ip` advisory:
  `https://github.com/advisories/GHSA-2p57-rm9w-gvfp`
- native candidate audit:
  [node-datachannel native supply-chain evidence](./node-datachannel-native-supply-chain.md)
