## 1. Floor declaration and static check

- [x] 1.1 Add `scripts/linux-glibc-floor.mjs`: the floor (`GLIBC` 2.31, `GLIBCXX` 3.4.28, `CXXABI` 1.3.12), the digest-pinned build and runtime images, an ELF `SHT_GNU_verneed` reader for 32- and 64-bit files in either byte order, a scanner that skips symlinks and foreign-machine files, and a `check` CLI that accepts a directory, an `.AppImage`, or a `.tar.gz`. Verified by `scripts/linux-glibc-floor.test.mjs` passing under `node --test`, with synthetic ELF files covering pass, violation, foreign machine, `GLIBC_PRIVATE`, `GLIBCXX`, ELF32, big-endian, symlink, and non-ELF cases.
- [x] 1.2 Run the check against the shipped 6.3.0 AppImage. Verified by it failing on exactly `pty.node` (needing `GLIBC_2.32`, `GLIBC_2.34`, and `GLIBC_2.42`), skipping the 9 foreign `koffi` builds, and passing the other 23 files.

## 2. Floor build image

- [x] 2.1 Add `Dockerfile.linux-floor` (pinned `node:24.15.0-bullseye` digest, npm 12.2.0, manifests, `npm ci`, then source) and `scripts/run-in-linux-floor.sh` (`--input`, `--output`, `--env`, then the command, run through `docker build`/`create`/`cp` with no bind mount). Verified by a contract test asserting that the Dockerfile's `FROM` matches the declared build image, that the manifest list matches `Dockerfile.e2e-base`, and that the runner has no `--volume`.
- [x] 2.2 Add `scripts/build-linux-standalone-archive.sh <target> <channel> <revision> <output-dir>`, holding the archive steps the release lanes repeated inline. Verified by running it in the floor image for `linux-x64` and getting one archive.
- [x] 2.3 Build the AppImage and the x64 archive locally in the floor image. Verified by the floor check passing on both.

## 3. Runtime probe

- [x] 3.1 Add `Dockerfile.linux-floor-runtime` (pinned `debian:bullseye-slim` digest plus Electron's shared libraries, with no Node or compiler), `scripts/probe-linux-glibc-floor.sh <appimage|server-archive> <file>`, and `scripts/linux-glibc-floor-probe.mjs`, which runs a shell through the packaged `node-pty` and starts the packaged holder until it is ready. Verified by a contract test pinning the image and the holder environment names to `SESSION_HOLDER_ENV`.
- [x] 3.2 Probe the 6.3.0 AppImage, and a floor-built AppImage carrying 6.3.0's `pty.node`. Verified by both failing on the glibc 2.31 host, the second with the holder's own report: `` version `GLIBC_2.34' not found `` for that `pty.node`.
- [x] 3.3 Probe the locally built floor AppImage and x64 archive. Verified by both passing.

## 4. Holder start-up failure reporting

- [x] 4.1 In `packages/server-core/src/sessionHolder/process.ts`, add `describeNativeModuleLoadFailure` and `reportSessionHolderStartupFailure`, which writes a bounded reason to the readiness descriptor. In `factory.ts`, have `launchSessionHolder` keep up to 2 KiB from that descriptor and, when the holder exits before it is ready, wait for the descriptor to close and append the reason to the error. Verified by new tests in `packages/server-core/test/session-holder-launch.test.mjs` failing before the change and passing after it.
- [x] 4.2 In `apps/terminay-server/src/sessionHolderEntry.ts`, load `node-pty` under the entry's control before anything else, and report load and start-up failures through 4.1. Verified by 3.2 showing the real loader error, and by the server-core suite (1572 tests) and `scripts/local-desktop-diagnostics-session-holder.test.mjs` passing.

## 5. CI and release lanes

- [x] 5.1 Add the Gitea `linux-glibc-floor` job: build the AppImage and the x64 archive in the floor image, then run the check and the probe on both. Verified by `scripts/provider-portable-ci.test.mjs` asserting the job, and by the job's status on the pull request.
- [x] 5.2 Route `trigger-release.yml`'s Linux desktop lane and archive lanes, and `main-prerelease.yml`'s archive and beta desktop lanes, through the floor image, then run the check and the probe before checksum, signature, or upload. Verified by a contract test that fails if any Linux lane runs `build:linux`, `electron-builder --linux`, or `build-standalone-server-artifact.mjs` outside `run-in-linux-floor.sh`, or publishes without the check and the probe.

## 6. Delivery

- [x] 6.1 Run `npm run lint`, `npm run test:release-evidence`, the affected workflow contract tests, the server-core suite, and `openspec validate linux-glibc-floor --strict` plus `openspec validate --all`. Verified by all exiting zero.
- [ ] 6.2 Open the pull request on `origin` with `tea`, and read back every commit status on the head SHA. Verified by each being `success` or `skipped`.
