# `node-datachannel` native supply-chain evidence

Date: 2026-07-27

This record audits the exact `node-datachannel@0.32.3` candidate used by the
[headless runtime spike](./node-datachannel-headless-spike.md). It is evidence
for the security-maintenance and native-distribution comparison in
[Server architecture decision spikes](../../changes/archive/2026-07-27-server-architecture-decision-spikes/).
It does not select the candidate.

## Finding

The published package is not acceptable as a Terminay release dependency in
its present form.

- Every published GNU/Linux and musl binary statically contains
  OpenSSL `1.1.1w`, which reached public end of life on 2023-09-11. OpenSSL
  lists 24 subsequently disclosed issues as affecting `1.1.1w`, including one
  high-severity issue. Public fixes for the 1.1.1 line are not available
  without extended support.
- Every published macOS and Windows binary statically contains
  OpenSSL `3.6.2`. OpenSSL lists five issues fixed in `3.6.3` as affecting that
  version, including high-severity CVE-2026-45447.
- The binding embeds libdatachannel `0.24.2`. Releases `0.24.3` and `0.24.4`
  contain later DTLS race/deadlock fixes, additional packet-size checks, an
  ICE callback heap-use-after-free fix, and OpenSSL DTLS/TLS BIO
  synchronization fixes.
- `npm audit` reports zero advisories because it audits the JavaScript install
  dependency tree. It does not inventory or assess statically linked OpenSSL,
  libdatachannel, libjuice, usrsctp, libsrtp, or plog.
- The native build inputs do not establish reproducible source
  correspondence. OpenSSL arrives from mutable Debian/Alpine container package
  repositories, a current Homebrew reinstall, or a current vcpkg checkout.
  The release has asset digests, but no native SBOM, source manifest, detached
  signature, or provenance attestation.

The behavioral and platform evidence for this candidate remains valid, but a
clean behavioral test cannot compensate for the native security and
provenance gaps.

## Reproducible inventory

[`scripts/node-datachannel-supply-chain-inventory.mjs`](../../../scripts/node-datachannel-supply-chain-inventory.mjs)
creates a temporary npm project outside the repository dependency graph,
installs exactly `node-datachannel@0.32.3`, runs `npm audit`, verifies the npm
tarball integrity, resolves source tags to commits, verifies the complete
libdatachannel submodule tree, checks the GitHub release matrix and digests,
extracts the matching native archive, and proves that the installed `.node`
file is byte-for-byte the published release binary.

The default run downloads and inspects the current host asset:

```sh
node scripts/node-datachannel-supply-chain-inventory.mjs \
  > /tmp/node-datachannel-inventory.json
```

The complete 11-asset audit is:

```sh
node scripts/node-datachannel-supply-chain-inventory.mjs --all-assets \
  > /tmp/node-datachannel-inventory-all.json
```

`GITHUB_TOKEN` is optional and is used only as a bearer token for the public
GitHub metadata requests when present. It avoids the small unauthenticated API
rate limit during repeated audit runs and is never included in the report.

The script has only Node built-in imports, changes no repository manifest or
lockfile, removes its temporary installation, rejects a changed source tag,
submodule commit, release matrix, archive digest, binary digest, or embedded
library version, and labels the limits of npm audit in its JSON output.

The full-matrix run passed on 2026-07-27. The isolated npm audit reported zero
known JavaScript advisories and the installed Darwin arm64 binary matched its
release binary exactly.

## Exact source mapping

| Component                  | Version or source identity                    | Exact source                                                                                                                         |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node binding               | `0.32.3`                                      | lightweight tag `v0.32.3`, unsigned commit `e495b7efad200bca44038609455c06a7f2ea812d`                                                |
| libdatachannel             | `0.24.2`                                      | unsigned annotated tag object `251f1b407907be571a9360e6d4f8dbce55c775c0`, unsigned commit `4e4f4892dccb2a57fe3a490d0c9d958de4244e74` |
| libjuice                   | `1.7.0`                                       | submodule commit `5948a4162d37bc213d6051b67ee2876ccc5a99a6`                                                                          |
| libsrtp                    | `2.7.0`                                       | submodule commit and lightweight tag `ee1a77c9f9dc02c42bda9901038c500c5efe4cfa`                                                      |
| usrsctp                    | source reports `0.9.5.0`                      | libdatachannel fork commit `fec583d54493f879d2ae44a743423bf8a04371ab`                                                                |
| plog                       | source reports `1.1.10` plus 15 later commits | submodule commit `94899e0b926ac1b0f4750bfbd495167b4a6ae9ef`                                                                          |
| nlohmann JSON              | `3.12.0` tree                                 | submodule commit `55f93686c01528224f448c19128836e7df245f72`; used by source examples, not linked into the addon                      |
| node-addon-api             | `7.0.0`                                       | exact npm dev dependency in the tagged lockfile; header code participates in the native build                                        |
| OpenSSL, Linux and musl    | `1.1.1w`                                      | statically present in every published Linux binary; exact upstream source commit and package build are not recorded                  |
| OpenSSL, macOS and Windows | `3.6.2`                                       | statically present in every published macOS/Windows binary; exact upstream source commit and package build are not recorded          |

The binding's tagged CMake file fetches libdatachannel by mutable tag name
`v0.24.2`, enables media and WebSocket support, selects OpenSSL, and requests
static OpenSSL libraries. Libdatachannel's exact tag tree pins its own
submodules by commit. A source rebuild therefore has a precise C/C++
submodule tree only if the resolved libdatachannel tag is independently
verified against the commit above.

The release binaries demonstrate that OpenSSL, libdatachannel, libjuice,
libsrtp, usrsctp, plog, and the C++ runtime are incorporated into the `.node`
file. They are not separate npm or shared-library dependencies. The GNU/Linux
binaries dynamically require only the relevant loader, `libc`, `libdl`,
`libm`, and `libpthread`; the macOS binaries require the system C++ and system
libraries. This is why an npm dependency scan cannot see the native stack.

## Published Node-API artifact matrix

All archives contain exactly `build/Release/node_datachannel.node`. All use
Node-API v8, while the package declares Node `>=18.20.0`. One binary per
OS/libc/architecture is sufficient across compatible Node and Electron
versions; there is no per-Node-ABI matrix.

| Target           | Archive SHA-256                                                    | Native binary SHA-256                                              | Native identity                                         | Embedded OpenSSL |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- | ---------------- |
| Darwin arm64     | `69fbffdacb9abda2a76809693443328b6aad71af25947e0733913340365f4da8` | `1d4f814bede82a5412b19e8973e44eb484d504acc52f17796e90add75dc9ac80` | Mach-O UUID `9F6335B4-4A7F-32D6-82B7-2A38F2548273`      | `3.6.2`          |
| Darwin x64       | `4f79b7ff0fe035db8d2006842537aca2a2def957569aae6ff578107b56adec38` | `d38ddb63ab5ffa397be6830e050484ee9338055e732909db4c077ce08bb29495` | Mach-O UUID `F21F017A-7F05-3299-B799-4FC44625BEBA`      | `3.6.2`          |
| GNU/Linux arm    | `4212da9a978bf6fb37e6147230268cbdf4ac19297ffa9b93cc05acde129137fb` | `0f351d041ed18b9c67be82078878ac5d30e4a4858c798cf8f7eea429199fc91c` | ELF build id `bf94cde560715943a9cb9958b558d27eaa994e07` | `1.1.1w`         |
| GNU/Linux arm64  | `4bdbd80aeb11fb0a903318defe663a833a1f0af2615450fe10dab75c81723445` | `18ffa3e08a07578c9fea053cd32350a69506f2bfa615c077c6e5ad5843df27a3` | ELF build id `0b3c82783face1612ac146e75a504720f987085a` | `1.1.1w`         |
| GNU/Linux x64    | `4092afc9cd594a3326eb1bd823da452b227b742ea8222689b2cea6f7344cf67a` | `1da298b65c65c2d47109708af662ee2a3b92cf1f34881da6455619e14729e7b4` | ELF build id `8bb796005ef530a07045b4f86eff9f06ee55054a` | `1.1.1w`         |
| musl Linux arm   | `c1d9eaf66a5c14c719947b755db91d7604ebaa6d09b8e75b7a177f239ea19950` | `9544f5219a3cefc845b7e36d18927b68d17910f4c0158bf764d57827cf166f2f` | ELF, no GNU build id advertised                         | `1.1.1w`         |
| musl Linux arm64 | `894f7ad9f7a78c2f8cf3ba8c1dc24774322cc3f1bad68891cadf5f1223dcfd63` | `db2f11fd00bbdf9bc06b183bd97f3914b06b1163816afb2c73006d85878fbcb2` | ELF, no GNU build id advertised                         | `1.1.1w`         |
| musl Linux x64   | `543dbd84b2f15b531714b51f8ce29a4690a8d6af6ee69affd5cec5b85c54e871` | `2540f2bbd1602bc2505070b9e2764e3c8092d9c4969b4a42306badb90ade6eae` | ELF, no GNU build id advertised                         | `1.1.1w`         |
| Windows arm64    | `64fe160b953f6dfd44ae3e1f75da0d654e7d23c75c976a2e6a94102fbbc08bb0` | `c8ce3ad67f7be2eb2a1a0c749b8bf26e39106f2f5062ecdcf628e1d1eb7ac39e` | PE timestamp 2026-04-26 10:01:00                        | `3.6.2`          |
| Windows x64      | `3bfacc4125b296197fe9e22ebd9a52f05321c50aca9d80b92897507f898c12c3` | `9c994ed1262f12313694d34f18a4b8e291b21790360d603a78cd23a4f5539b25` | PE timestamp 2026-04-26 10:00:10                        | `3.6.2`          |
| Windows x86      | `cf97f107bc73864ec7907f25baf7a7691010ed3bdedde56d6720542deb806d27` | `01b1fe9ab0d6e313493edf17a390dd83d30b2fed166cdb4d9a528214d7df99ab` | PE timestamp 2026-04-26 09:58:40                        | `3.6.2`          |

The release matrix is broader than Terminay's initial supported matrix.
Terminay requires Desktop macOS arm64 and GNU/Linux x64, plus standalone
GNU/Linux x64 and arm64. All four required uses resolve to an affected
published binary. musl, 32-bit, Windows, and macOS x64 assets do not turn into
Terminay support merely because upstream publishes them.

## Vulnerability and advisory review

### OpenSSL

OpenSSL's official affected-version records establish the following issues
after `1.1.1w`. These are library-level affected results. Many involve APIs
that the data-channel path may not call, so this table does not claim that
every issue is remotely reachable through Terminay. Conversely, lack of an
application reachability proof is not a safe basis for shipping an
unsupported, statically linked cryptographic library.

| Fixed after `1.1.1w` in extended release | OpenSSL-listed affected issues                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `1.1.1x`                                 | CVE-2023-5678 (low), CVE-2024-0727 (low)                                                                                 |
| `1.1.1y`                                 | CVE-2024-2511 (low), CVE-2024-4741 (low)                                                                                 |
| `1.1.1za`                                | CVE-2024-5535 (low)                                                                                                      |
| `1.1.1zb`                                | CVE-2024-9143 (low), CVE-2024-13176 (low)                                                                                |
| `1.1.1zd`                                | CVE-2025-9230 (moderate)                                                                                                 |
| `1.1.1ze`                                | CVE-2025-68160, CVE-2025-69418, CVE-2025-69419, CVE-2025-69420, CVE-2025-69421, CVE-2026-22795, CVE-2026-22796 (all low) |
| `1.1.1zg`                                | CVE-2026-28387, CVE-2026-28388, CVE-2026-28389, CVE-2026-28390 (all low)                                                 |
| `1.1.1zh`                                | CVE-2026-34180 (low), CVE-2026-42766 (low), CVE-2026-45447 (high), CVE-2026-7383 (low), CVE-2026-9076 (low)              |

The five `1.1.1zh` issues also affect OpenSSL `3.6.2` and are fixed in `3.6.3`.
CVE-2026-45447 is a PKCS#7 verification use-after-free that OpenSSL assesses
as high severity because application-dependent exploitation may include
remote code execution. The node-datachannel WebRTC surface does not expose a
PKCS#7 verification API, so direct reachability through the selected adapter
is not established. The Linux binaries contain a `PKCS7_verify` symbol, while
the inspected macOS and Windows binaries do not expose that symbol. Every
required candidate binary still contains an OpenSSL release with listed
issues; reachability analysis narrows individual exploit claims but does not
restore support or a public patch path for `1.1.1w`.

### libdatachannel and its submodules

GitHub's repository advisory endpoints returned no published advisories for
node-datachannel, libdatachannel, libjuice, libsrtp, or the libdatachannel
usrsctp fork. Neither node-datachannel nor libdatachannel contains a
`SECURITY.md` reporting/support policy. These negative searches are useful
inventory results, not proof that the native code has no vulnerabilities.

NVD keyword searches returned:

- CVE-2019-20503 for usrsctp before 2019-12-20. The NVD-referenced fix commit
  `790a7a2555aefb392a5a69923f1e9d17b4968467` is an ancestor of the pinned
  2025 libdatachannel fork commit, so the bundled source contains that fix.
- CVE-2007-6092, CVE-2013-2139, and CVE-2015-6360 for old libsrtp releases.
  Bundled libsrtp `2.7.0` is newer than the affected version bounds reported
  for those entries.
- no NVD keyword record for libdatachannel or libjuice.

Upstream release notes still identify important unnumbered fixes after the
embedded libdatachannel version:

- `0.24.3` drops packets when the DTLS input queue is full, fixes a race
  between DTLS ClientHello and incoming-connection registration, adds media
  packet-size checks, updates libjuice to `1.7.1`, and updates libsrtp to
  `2.8.0`;
- `0.24.4` fixes a heap use-after-free in an in-flight ICE receive callback
  and synchronization races in OpenSSL DTLS and TLS input BIO handling; and
- `0.24.5` fixes a WebSocket TLS regression and updates libjuice to `1.7.2`.

The current node-datachannel default branch still reports package `0.32.3` and
still fetches libdatachannel `0.24.2`; there is no later binding commit that
absorbs those fixes.

## Package and build provenance

The npm tarball has:

- registry integrity
  `sha512-Aok1ZhLsll472lRefgWYuWJ0070jh0ecHravTdRyZEmoESumebMEQV8Y+poBwSW2ZbEwAokAOGsK5Cu8pDDT2g==`;
- SHA-1 `27c7cfae1c549e3a65ca51a001ae3b67301c4155`;
- an npm registry signature;
- no npm provenance or attestation metadata; and
- one npm maintainer.

The release was published on 2026-04-26. The build checks for Linux, macOS
arm64/x64, and Windows x86/x64/arm64 succeeded against the tagged commit.
The workflows upload N-API archives directly to the GitHub release. GitHub now
reports a SHA-256 digest for every asset, and the executable inventory verifies
all of them.

The inventory also verifies the immutable workflow-run records for Linux run
`24952615956`, macOS arm64 run `24952618505`, macOS x64 run `24952621087`,
Windows run `24952623542`, and npm publish run `24953023814`. Every run reports
source commit `e495b7efad200bca44038609455c06a7f2ea812d`, manual dispatch, successful
completion, and the expected tagged workflow. This is strong GitHub-hosted
correlation between source, build time, upload time, and asset creation, but it
is not a signed subject-digest attestation binding each output digest to its
run.

The following properties prevent those hashes from being a reproducible
source-to-binary chain:

- the wrapper and libdatachannel release commits and tags are unsigned;
- GitHub Action dependencies use mutable major tags rather than commit SHAs;
- Linux images use mutable `node:18-bullseye` and `node:18-alpine3.16` tags,
  then install unpinned distribution packages;
- macOS runs `brew reinstall openssl@3`;
- Windows bootstraps the current vcpkg checkout and installs the current
  OpenSSL port;
- no workflow captures base-image digests, OpenSSL source identity, compiler
  identity, complete build flags, an SBOM, or an in-toto/SLSA-style
  attestation in the release; and
- release archives have GitHub digests but no independent signature.

The install path also depends on deprecated
`prebuild-install@7.1.3`. If a prebuild cannot be downloaded, the package's
install script falls back to a source build after another npm install. A
Terminay release cannot allow that network-dependent fallback to silently
change its native payload.

The wrapper declares the installer with a semver range, and a consumer install
does not use the dependency's own package lock. The 36-package JavaScript tree
reported by the executable inventory is therefore the exact resolution on the
audit date, not an upstream-pinned consumer tree.

### Maintenance cadence

node-datachannel published 13 stable releases from `0.24.0` in January 2025
through `0.32.3` in April 2026. Four releases arrived in 2026 before the
current three-month gap. The repository is not archived, but its default
branch has no source commit after `0.32.3`.

libdatachannel is active and published `0.24.2` on 2026-03-29, `0.24.3` on
2026-05-09, `0.24.4` on 2026-06-08, and `0.24.5` on 2026-06-12. The binding's
lag therefore matters: fixes exist upstream, but a user of the published
binding cannot consume them without building or patching the native addon.

There is no documented security support window or private-reporting policy in
either repository. Terminay therefore cannot delegate its release response
time to an upstream security SLA that does not exist.

## License inventory and distribution obligations

This is an engineering inventory, not legal advice.

| Native component | License in exact source              | Distribution observation                                                                                 |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| node-datachannel | MPL-2.0                              | npm tarball includes the wrapper MPL license and wrapper source                                          |
| libdatachannel   | MPL-2.0                              | native archive contains only the binary; npm tarball does not contain its license or source              |
| libjuice         | MPL-2.0                              | statically linked; its license/source are absent from the native archive                                 |
| libsrtp          | BSD-3-Clause                         | statically linked; required binary-distribution notice is absent from the native archive                 |
| usrsctp          | BSD-3-Clause                         | statically linked; required binary-distribution notice is absent from the native archive                 |
| plog             | MIT                                  | header code is incorporated; its notice is absent from the native archive                                |
| node-addon-api   | MIT                                  | header code is incorporated; its notice is not identified by the upstream native archive                 |
| OpenSSL 1.1.1w   | OpenSSL and Original SSLeay licenses | statically linked Linux payload needs the applicable acknowledgements and license text                   |
| OpenSSL 3.6.2    | Apache-2.0                           | statically linked macOS/Windows payload needs the applicable license and notice material                 |
| nlohmann JSON    | MIT                                  | exact source tree is fetched for libdatachannel examples, but no evidence shows it linked into the addon |

The isolated npm install contains 36 packages: 24 MIT, six ISC, two
Apache-2.0, one BSD-3-Clause, one MPL-2.0, and two packages with
multi-license expressions. Those packages primarily implement the deprecated
prebuild installer. Vendoring a verified native payload rather than running
the installer in production removes most of that runtime distribution and
attack surface.

Terminay's artifact needs its own third-party notice and source-correspondence
manifest. At minimum it records exact source commits and patches, includes all
license/notice text required for every compiled or shipped component, and
provides the MPL-covered source in the manner reviewed for the release. The
upstream one-file native archives do not satisfy that operational requirement
for Terminay by themselves.

## Required release disposition

`node-datachannel@0.32.3` stays blocked as a selected runtime while Terminay
uses the published binaries.

A viable native path has one of these outcomes:

1. upstream publishes a new binding whose exact binary contains a supported,
   patched OpenSSL line and a libdatachannel release containing the later
   DTLS/ICE fixes, with adequate source and license correspondence; or
2. Terminay owns a narrowly scoped native build for only its supported targets.

The second path uses exact immutable commits, a supported OpenSSL LTS patch
release, digest-pinned build images and tools, and the same source for
standalone Server and Desktop. Because Terminay needs data channels rather
than native media or WebSockets, the build disables media and WebSocket
support if adapter testing confirms no hidden dependency. This removes
libsrtp and the native WebSocket surface while retaining the OpenSSL DTLS,
libjuice ICE, and usrsctp components that require continuing review.

The release gate for either path:

- rejects an EOL or known-affected embedded OpenSSL version;
- verifies the exact libdatachannel and submodule commits;
- reruns the complete direct/STUN/TURN, pressure, shutdown, reconnect, and
  revocation evidence on native Linux x64/arm64 and packaged Desktop targets;
- produces and signs archive checksums, a native SBOM, source manifest, and
  provenance attestation;
- includes reviewed third-party notices and MPL source availability;
- prohibits install-time source-build/network fallback in the packaged
  product; and
- defines an owner and response window for recurring native CVE and upstream
  release review.

This finding is a candidate blocker, not a reason to weaken the WebRTC or
supported-platform requirements.

## Primary sources

- node-datachannel package metadata and tarball:
  `https://registry.npmjs.org/node-datachannel/0.32.3`
- node-datachannel `v0.32.3` source and release:
  `https://github.com/murat-dogan/node-datachannel/tree/v0.32.3`
  and
  `https://github.com/murat-dogan/node-datachannel/releases/tag/v0.32.3`
- tagged native build workflows:
  `https://github.com/murat-dogan/node-datachannel/tree/v0.32.3/.github/workflows`
- libdatachannel `v0.24.2` source:
  `https://github.com/paullouisageneau/libdatachannel/tree/v0.24.2`
- libdatachannel later release notes:
  `https://github.com/paullouisageneau/libdatachannel/releases/tag/v0.24.3`,
  `https://github.com/paullouisageneau/libdatachannel/releases/tag/v0.24.4`,
  and
  `https://github.com/paullouisageneau/libdatachannel/releases/tag/v0.24.5`
- OpenSSL `1.1.1` vulnerability list:
  `https://www.openssl-library.org/news/vulnerabilities-1.1.1/`
- OpenSSL release-support policy:
  `https://www.openssl-library.org/policies/releasestrat/`
- NVD CVE-2019-20503:
  `https://nvd.nist.gov/vuln/detail/CVE-2019-20503`
- NVD high-severity OpenSSL record:
  `https://nvd.nist.gov/vuln/detail/CVE-2026-45447`
