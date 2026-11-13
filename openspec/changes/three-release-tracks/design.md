## Context

Releases run on the GitHub mirror, in two workflows.

- **Stable**: `.github/workflows/trigger-release.yml`, dispatched by hand. It smoke-tests, tags `vX.Y.Z`, builds signed and notarized desktop binaries and signed server archives, publishes the CLI to npm, and the image workflow publishes `X.Y.Z` and `latest`. Desktop reads `latest*.yml` from `/releases/latest/download/`.
- **Beta**: `.github/workflows/main-prerelease.yml`, on every push to `main`. One run builds the server archives (`terminay-server-main-linux-<arch>.tar.gz`) and the desktop payloads (`terminay-desktop-main-*`, macOS signed and notarized), versions them `<next>-beta.<run number>` (`scripts/main-beta-version.mjs`), swaps them into the single rolling release `main-latest` with `beta*.yml` moved last, then dispatches `server-image.yml` to publish `<version>` and `beta`.

Consumers of the beta build:

- `electron/appUpdater.ts`: `AppUpdateChannel = 'stable' | 'beta'`. Beta reads `main-latest/beta*.yml` through the generic provider and also probes stable, taking the higher version.
- `src/terminalSettings.ts`: `updateChannel`, normalised to `stable` unless it is exactly `beta`.
- `src/shared/serverInstallCommands.ts`: classifies the client version with a `-beta.N` regex and emits the image at that version and `daemon install main`.
- `apps/terminay-cli`: `main` resolves `main-latest`; `ReleaseChannel = 'tag' | 'main' | 'source'`; a `main` install upgrades by manifest revision. `imageReference.ts` accepts `X.Y.Z` and `X.Y.Z-beta.N` tags.
- The standalone server's release check (change `remote-server-in-app-upgrade`) follows its own channel.

ADRs in force that this touches: ADR-0016 (server archives on `tag` and rolling `main` channels), ADR-0027 (Desktop updates from GitHub release metadata; beta is `main-latest`), ADR-0062 (a server upgrades itself to its own channel's newest signed release), ADR-0079 (macOS floor in update metadata).

Decisions already made with the owner: stable stays a fresh build on dispatch; nightly replaces beta everywhere, including `daemon install main` and the `beta` image tag; canary publishes its own server archives and image as well as desktop; versions are `<next>-main.<commit count>.<track>`; the legacy beta feed is served for 90 days.

## Goals / Non-Goals

**Goals:**

- Three tracks, with canary costing no Apple notarization.
- Every installed Beta build reaches Nightly without the user doing anything.
- Switching between tracks never installs older code and never strands an installation.
- A client's install commands always name a server built from the same track.

**Non-Goals:**

- Promoting a nightly binary to stable. The version is compiled into the signed app, so a stable release would have to be rebuilt and re-signed anyway. Stable keeps its own build.
- Extra test suites gating nightly. Nightly runs the same build probes the beta workflow runs today. Pull-request CI on Gitea is unchanged.
- Changing Windows or Linux signing. Only the macOS canary build changes.
- Moving releases off GitHub. The Gitea release workflow is untouched.
- Pruning old canary image tags from the registries.

## Decisions

### 1. One reusable build workflow, two callers

`main-prerelease.yml` becomes a reusable workflow (`on: workflow_call`) taking `track` (`nightly` or `canary`). Two thin callers own the triggers:

- `canary.yml`: `on: push` to `main`, plus the existing dry-run dispatch. Concurrency group `canary`, `cancel-in-progress: false`, so runs publish in order and GitHub keeps only the newest pending run.
- `nightly.yml`: `on: schedule` at `23 2 * * *` (02:23 UTC, off the hour so GitHub does not drop it under top-of-hour load), plus dispatch. Concurrency group `nightly`.

The track decides the rolling release, asset names, metadata channel, notarization, and image tags. Everything else (floor image, Windows probe, checksum and signature verification, swap-then-verify publication) is shared.

*Alternative:* copy the 700-line workflow. Rejected: the two would drift, and every probe added later would have to be added twice.

### 2. Track layout

| | Nightly | Canary |
| --- | --- | --- |
| Rolling release | `main-latest` | `canary-latest` |
| Desktop payloads | `terminay-desktop-main-*` | `terminay-desktop-canary-*` |
| Update metadata | `nightly-mac.yml`, `nightly-linux.yml`, `nightly.yml` | `canary-mac.yml`, `canary-linux.yml`, `canary.yml` |
| Server archives | `terminay-server-main-linux-<arch>.tar.gz` | `terminay-server-canary-linux-<arch>.tar.gz` |
| Manifest channel | `main` | `canary` |
| Image tags | `<version>`, `nightly` | `<version>`, `canary` |
| macOS | signed, notarized, stapled | signed only |

Nightly keeps the `main-latest` tag, the `main` archive names and the `main` manifest channel. Installed betas, installed `main` servers and published CLIs all read those names, so they move to nightly with no client change. Renaming them would need a second copy of every nightly asset for as long as any old client exists.

*Alternative:* a new `nightly-latest` release with `main-latest` as a temporary alias. Rejected: the CLI's `main` reference is a permanent public name, so the alias could never be retired.

Each rolling release also carries `build.json` (`{ "commit", "version" }`), moved last, after the update metadata.

### 3. Nightly skip

`nightly.yml` starts with a job that downloads `main-latest/build.json` and compares its `commit` with `github.sha`. Equal: the build jobs are skipped and the run succeeds. Missing or unreadable `build.json`: build. Because `build.json` moves last, a nightly that failed before publication leaves the old commit in place and the next night retries.

*Alternative:* compare against the release's `target_commitish`. Rejected: a rolling release is created once and its target never moves.

### 4. Versions order by commit, not by track name

`<next>-main.<count>.<track>`, with `<count>` from `git rev-list --count HEAD` (the workflows already fetch full history and tags). `scripts/main-beta-version.mjs` becomes `scripts/prerelease-version.mjs --track <track>`.

Semver compares prerelease identifiers left to right, so `main` ties, `<count>` compares as a number, and only on the same commit does the track name decide (`nightly` above `canary`). That gives the rules the updater needs for free:

- Nightly to Canary: the newest canary is a later commit, so it is offered.
- Canary to Nightly: nothing is offered until nightly reaches that commit. A nightly of the same commit is offered, which swaps in the notarized build of the same code.
- Any old `-beta.N` build sorts below every new build on the same base version (`beta` < `main`), and below any higher base version.

The Windows update probe builds "this version plus one"; it increments `<count>`.

A re-run of the same commit now yields the same version, where the run number used to make each run distinct. That is intended: the same commit is the same build, and an installation already on it is not asked to update.

*Alternative:* `<next>-nightly.<date>` and `<next>-canary.<sha>` (the original plan). Rejected: a sha has no order, and `nightly` sorts above `canary` for every build of a base version, so a Nightly user who switched to Canary would be offered nothing until the next stable release.

*Alternative:* keep per-track counters and make the updater compare tracks itself. Rejected: electron-updater decides "newer" with semver internally; overriding it means `allowDowngrade`, which is the one switch that must stay off.

### 5. Canary is signed, not notarized

The canary caller passes no `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` or `APPLE_TEAM_ID` notarization credentials to the build, and the build passes `-c.mac.notarize=false`. The signing certificate is still imported, and a missing certificate still fails the macOS job. Verification for canary keeps `codesign --verify --deep --strict` and the `TeamIdentifier` check, adds a check that the hardened-runtime flag is set, and drops `spctl --assess` and `stapler validate`, which only pass for notarized apps. Nightly keeps all of them.

**Boundary crossed: the update trust boundary (ADR-0027).** It does not move. An update is installed when its SHA-512 matches the metadata fetched over HTTPS from the project's GitHub releases and, on macOS, when Squirrel.Mac confirms the bundle satisfies the running app's designated requirement. Notarization was never part of that check. What canary gives up is Apple's malware scan as a second opinion on the build; the Developer ID key stays the trust anchor. The canary job also holds fewer secrets than the beta job did.

An update the app downloads itself carries no quarantine flag, so Gatekeeper does not assess it. A canary payload downloaded in a browser is quarantined and blocked, which is why no canary payload is linked anywhere, and why the canary macOS payload stays a zip with no DMG.

### 6. Updater: one prerelease source per channel, plus stable

`AppUpdateChannel = 'stable' | 'nightly' | 'canary'`. `UpdateSource` stays the same type. The beta branch of `sourceMetadataUrl`, `releasePageUrl`, `configureFeed`, `loadNotes` and `selectSource` is parameterised by the prerelease source:

- nightly: feed `…/download/main-latest/`, channel `nightly`
- canary: feed `…/download/canary-latest/`, channel `canary`

`selectSource` probes the channel's own prerelease and stable, as today. Canary does not probe nightly: every nightly commit was already pushed, so canary has already offered it or something newer.

**Boundary: the renderer/main boundary.** Unchanged. The renderer still only reads status and asks for a restart. Feed URLs are constants in the main process, chosen by the device setting; the renderer names no URL.

### 7. Moving Beta users to Nightly

Two parts, both transitional and so absent from the main specs.

1. **Setting.** `normalizeTerminalSettings` maps a stored `beta` to `nightly`. Any other unknown value still becomes `stable`.
2. **Feed.** For 90 days the nightly workflow also publishes `beta-mac.yml`, `beta-linux.yml` and `beta.yml` on `main-latest`: byte copies of the nightly metadata under the old names, verified by the same script and moved in the same swap. They name the same `terminay-desktop-main-*` payloads, which is why nightly keeps those names. An installed beta sees a higher version, installs it, and on first launch its setting becomes Nightly. The nightly image is also tagged `beta` for the same period.

The end date is the merge date plus 90 days, written as a constant in the workflow with a comment naming the follow-up. A follow-up change (`retire-beta-feed`) deletes the three legacy metadata files, the `beta` tag publication, and the `beta` to `nightly` mapping. After that, an installation still on a beta build gets a 404 on its beta feed, falls back to its stable source ("one source unreachable"), and reaches the next stable release, where an unknown channel reads as Stable.

Beta users land on a slower track than they had. That is the owner's choice: canary is opt-in.

### 8. Server artifacts per track

- `scripts/build-standalone-*`/the archive job take the manifest channel from the track (`main` or `canary`).
- CLI: a `ROLLING` table replaces the two constants: `main` to `{ tag: 'main-latest', asset: 'main' }`, `canary` to `{ tag: 'canary-latest', asset: 'canary' }`. `ReleaseChannel` gains `'canary'`. `stagedName` already names rolling installs `<channel>-<revision>`. `plan.ts` follows the installed channel for both rolling channels. `imageReference.ts` accepts `X.Y.Z-main.N.(nightly|canary)`.
- Server release check: a canary install reads `canary-latest`.
- `server-image.yml`: the version input accepts `^X.Y.Z-main\.[1-9][0-9]*\.(nightly|canary)$`; the mode is the track; tags are `<version>`, `sha-<commit>`, and the track name (plus `beta` for nightly during the transition).
- `serverInstallCommands.ts`: `ServerInstallChannel = 'stable' | 'nightly' | 'canary' | 'unknown'`; the Linux command is `daemon install main` for nightly and `daemon install canary` for canary. A `-beta.N` version becomes `unknown`, which names the untagged image.

**Boundary: the release signing key (ADR-0016).** Unchanged. Canary archives are signed with the same Ed25519 key in the same job the beta archives were; installers verify the signature before unpacking.

**Boundary: ADR-0062.** A server still upgrades only to its own channel's newest signed release. Canary is one more channel under that rule.

The CLI is published to npm only with stable releases, so `daemon install canary` works once a stable release carrying it is out. Until then a canary Desktop's Linux command fails with the CLI's "unknown ref builds from source" path. The rollout order below avoids that.

### 9. Settings and dialogs

The select offers Stable, Nightly, Canary. Description: "Stable follows tagged releases. Nightly is built once a night from main. Canary is built on every push to main and is the least tested. Switching never installs an older version." `AppUpdateDialog` titles a prerelease build with its track in place of "(beta)". `describeManualCheck` names the three channels.

## Risks / Trade-offs

- **Gatekeeper rejects an un-notarized canary update on some macOS version** → Before canary is announced, test on a clean Apple Silicon Mac and a clean Intel Mac: install notarized stable, switch to Canary, confirm the update installs and launches with no prompt. Canary is opt-in, and switching back to Nightly or Stable recovers.
- **A canary user re-downloads the app zip by hand and is blocked** → No download links; the setting's description and the docs say Canary is reached from inside the app.
- **`git rev-list --count` goes down after a force-push or history rewrite of `main`** → `main` is protected; the version script fails if the count is below the count in the published `build.json` of its track.
- **Scheduled workflows run late or are skipped by GitHub under load** → Dispatch is available, and the next night builds whatever is unbuilt.
- **Two workflows share `server-image.yml` and the registries** → Its concurrency group already includes the version, and versions differ by track.
- **Three in-flight changes own requirements this one modifies** → Archive them first; task 9.1 checks.
- **The main specs say `beta` is not published while it still is, for 90 days** → The transition is written here and in tasks, with a dated follow-up.
- **Docker Hub and GHCR keep one canary image per push** → Same volume as beta today. Not addressed here.

## Migration Plan

1. Land the code with the workflows. The first canary run creates `canary-latest`. The first nightly run publishes to `main-latest` with both `nightly*.yml` and `beta*.yml`.
2. Installed betas update to the first nightly and become Nightly.
3. Cut a stable release soon after, so the npm CLI knows `canary` and stable users see the three-way setting.
4. Run the clean-Mac canary test (task 8.2) before telling anyone about Canary.
5. After 90 days, propose `retire-beta-feed`.

Rollback: revert the workflows. `main-latest` and `beta*.yml` are still there, so reverting restores per-push beta publication on the same feed; versions from the old scheme (`-beta.N`) sort below builds already installed on the same base version, so those installations wait for the next base version or stable release. `canary-latest` can be deleted by hand.

## Open Questions

- None blocking. ADR-0016 decision 3 and ADR-0027 decision 3 are revisited; the adr step records the supersession.
