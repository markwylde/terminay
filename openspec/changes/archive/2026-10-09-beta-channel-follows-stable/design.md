## Context

`electron/appUpdater.ts` maps the channel setting to exactly one feed:

- Stable: electron-updater's `github` provider, `releaseType: 'release'`, which
  reads `latest-{mac,linux}.yml` from the latest tagged release.
- Beta: the `generic` provider at
  `releases/download/main-latest/`, channel `beta`, which reads
  `beta-{mac,linux}.yml` from the rolling prerelease (ADR-0016, ADR-0027).

Builds that cannot install in place do not load electron-updater. They fetch the
same metadata file over HTTPS, read its `version:` line, and only notify.

Beta versions are `<next stable>-beta.<run>` (ADR-0027 §3), so the first `main`
build after a stable release is always newer than that release. The gap this
change closes is the window between tagging a stable release and the next push
to `main`, during which the rolling prerelease is older than stable.

In-force ADRs that constrain this design: ADR-0011 (renderer is untrusted; the
updater stays in the main process), ADR-0016 (release channels), ADR-0027
(metadata and payloads come over HTTPS from this project's GitHub releases only;
SHA-512 and macOS signature checks). Superseded and not in force: 0007, 0008,
0009, 0014, 0024.

## Goals / Non-Goals

**Goals**

- A Beta check offers the higher of the rolling prerelease and the latest stable
  release, on both in-place and notice-only builds.
- Release notes and the release link describe the version actually offered.
- One unreachable source does not fail the check.

**Non-Goals**

- No release-pipeline or published-asset change.
- No host-protocol, renderer, or settings change. `AppUpdateStatus.channel`
  keeps reporting the selected channel, `beta`.
- No change to Stable. Stable never looks at the rolling prerelease.
- No change to the verification or install path.

## Decisions

### 1. Probe both metadata files, then point the updater at the winner

Before a Beta check, the host fetches the `version:` of both
`main-latest/beta-<platform>.yml` and `latest/download/latest-<platform>.yml`,
compares them with the existing `compareVersions`, and picks a **source**:
`beta` or `stable`. In-place builds then configure electron-updater with that
source's existing feed configuration and run `checkForUpdates()` as today.
Notice-only builds use the winning version directly.

The probe reuses the fetch, URL constants, and `version:` parsing that the
notice path already has, so both build kinds share one selection function.

Boundary: this stays entirely in the privileged main process. Both URLs are
compile-time constants under this project's GitHub releases, fetched over HTTPS,
which is the boundary ADR-0027 draws. The probe result only selects between two
fixed feed configurations; it never supplies a URL, path, or version to
electron-updater, so a tampered probe response can at worst pick the other
legitimate feed, whose payload is still digest- and signature-checked.

Alternatives considered:

- *electron-updater's `github` provider with `allowPrerelease: true`.* This is
  how most projects get "stable plus prereleases", but it derives the version
  from the release tag, and the rolling prerelease's tag is `main-latest`, not a
  version. It would need per-build beta tags, which ADR-0016 deliberately avoids.
- *Have the release pipeline overwrite `beta-*.yml` on `main-latest` when a
  stable release ships.* Keeps the client untouched, but the metadata would
  point across releases, the stable job would race the `main` job for the same
  asset, and every already-installed client would still depend on the pipeline
  doing it. A client-side rule also fixes the gap for the release that is
  already out.
- *Check the beta feed with electron-updater, then the stable feed if nothing
  was found.* Two full updater checks per cycle, and it gets the 5.8.0 case
  wrong: beta.15 *is* newer than beta.14, so the first check succeeds and
  downloads the wrong build.

### 2. Ties and failures prefer the beta source

If the two versions compare equal, or the stable probe fails, the source is
`beta` — identical to today's behaviour. If the beta probe fails, the source is
`stable`. If both fail, the check fails through the existing error path
(`state: 'error'`, retried after `MIN_RECHECK_MS`). A probe that succeeds but
names no valid version counts as failed.

In the in-place path a probe failure therefore never blocks the updater check:
electron-updater still performs its own fetch of the chosen feed and reports its
own errors.

### 3. Notes and release link follow the source, not the channel

`loadNotes` and `releasePageUrl` currently branch on `channel === 'beta'`. They
branch on the source of the offered version instead: a `stable` source uses
`fetchStableReleaseNotes(installed, available)` and `/releases/tag/v<version>`;
a `beta` source uses the notes embedded in the update metadata and
`/releases/tag/main-latest`. On the Stable channel the source is always
`stable`, so its behaviour is unchanged.

`fetchStableReleaseNotes` already filters to `installed < version <= available`
with semantic-version precedence, so a Beta install on 5.8.0-beta.14 offered
5.8.0 gets exactly the 5.8.0 notes.

The source is remembered with the offered version so that a status read between
checks (renderers poll) keeps rendering the right link, and is reset with the
rest of the found-update state when the channel changes.

### 4. Feed configuration is per source

`configureFeed` takes the source. A `stable` source uses the Stable channel's
configuration unchanged (`github` provider, `allowPrerelease: false`,
differential download on). `allowDowngrade` stays `false` in every case, which
is what guarantees "never older than what runs" even if the probe and the
updater disagree.

A pending downloaded beta is replaced when the stable source offers something
newer, exactly as it is today when a channel change finds something newer.

## Risks / Trade-offs

- [Two extra HTTPS requests per Beta check] → They are small static release
  assets, fetched in parallel, at most hourly plus manual checks. They do not
  touch the rate-limited GitHub API.
- [Probe and updater disagree because a release lands between them] → The
  updater's own comparison and `allowDowngrade: false` decide what installs; the
  worst case is that the higher version is found one check later.
- [Differential download from a beta build to a stable payload has no matching
  blockmap] → electron-updater falls back to a full download on its own. Same
  cost as the first stable update after any beta.
- [Linux arm64 publishes `latest-linux-arm64.yml`, which the platform-only file
  name does not match] → The stable probe fails, so the source is `beta`: today's
  behaviour. The existing notice path has the same file-name limit; fixing it is
  out of scope.

## Migration Plan

Ships in a normal release. Beta installs older than this change keep the
single-feed behaviour until they update once through the rolling prerelease.
Rollback is reverting the commit; no persisted state or published asset changes.

## Open Questions

None. No in-force ADR needs revisiting: ADR-0027 §3 defines what the beta feed
*is*, and this change only adds that a Beta check also reads the stable feed
ADR-0027 §2 already defines.
