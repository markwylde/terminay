# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-30
- Reviewer: Claude (for Mark Wylde)
- Change: linux-glibc-floor

## In-Force ADR Context Reviewed

Depth of review: every ADR that mentions glibc, the distribution matrix, native
modules, release lanes, or CI was read in full and checked for supersession. The
rest were screened by title.

- openspec/adr/0035-detached-session-holder-owns-ptys.md - restates the glibc
  2.36 matrix in decision 6. This change lowers the floor and makes it a build
  input, so 0035 is superseded by 0077, which restates decisions 1–5 unchanged.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - already
  superseded by 0035. It is the origin of the matrix.
- openspec/adr/0007-deterministic-pty-runtime-archives.md - superseded by 0008.
  Its open item on producer-environment glibc is the gap this change closes.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - the
  archive contents, signing, and channels are unchanged. Only where the archive
  is built moves into the floor image.
- openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md - extension
  prebuilds (`koffi`, `@napi-rs/canvas`) are now covered by the floor check, and
  foreign-architecture prebuilds are skipped by ELF machine.
- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md (which
  supersedes 0010) - the new PR job runs on Gitea through a provider-neutral Docker
  script, with no bind mount and no provider-specific action.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md - the floor image is pinned
  to the same Node 24.15.0.
- openspec/adr/0011-security-trust-boundary-model.md - no trust boundary moves.
  The holder's readiness descriptor is local to one launch from the same build.

## Repository-Level ADRs Created

- openspec/adr/0077-linux-artifacts-are-built-and-verified-at-a-declared-glibc-floor.md
  - supersedes ADR-0035. It declares a glibc 2.31 floor for every GNU/Linux
  target, makes the floor a build input through one pinned image, and gates
  merge and publication on a static ELF check and a clean-floor runtime probe.
