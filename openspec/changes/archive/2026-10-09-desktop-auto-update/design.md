## Context

Terminay Desktop checks for updates in `electron/main.ts`
(`fetchAppUpdateStatus`). It requests `releases/latest`, follows the redirect,
and reads the tag out of the final URL. The server-bundled UI reaches that
check through the host protocol action `updater.check`, which is gated on the
`updater` host capability. It renders an **Update Now** button that opens the
release page. Releases are cut by `.github/workflows/trigger-release.yml` on the
GitHub mirror. The macOS job builds a signed and notarized DMG and the Linux
job builds an AppImage. Each is attached with a SHA-256 sidecar, and the AI
release notes are written to the release body by the final
`publish-release-notes` job. Until then the body reads "Release in progress."
`.github/workflows/main-prerelease.yml` keeps a rolling `main-latest`
prerelease, which today holds only the standalone server archives
(ADR-0016).

Decisions already taken with the user are recorded in
`questionnaires/scope.yaml`: background download, install on quit, the full
changelog since the installed version, notify-and-link for builds that cannot
update themselves, and an opt-in beta channel.

## Goals / Non-Goals

**Goals:**

- In-place, integrity-checked updates for packaged macOS builds and Linux
  AppImage builds.
- No client ever sees an update whose metadata or release notes are
  incomplete.
- A readable changelog covering every release the user is skipping.
- An opt-in Beta channel that follows `main`.

**Non-Goals:**

- Windows. No Windows build is published today. `electron-updater` supports
  NSIS, so adding Windows later only means publishing `latest.yml`.
- Updating `.deb`/`.rpm` installs or the standalone server. Server upgrades
  belong to the CLI installer under ADR-0016.
- Staged rollouts, downgrades, and delta updates on the Beta channel.

## Decisions

### 1. `electron-updater`, not Electron's built-in `autoUpdater`

Electron's `autoUpdater` needs an update server (for example
`update.electronjs.org`), doesn't support Linux, and gives us no hook for
release notes. `electron-updater` is maintained with the `electron-builder` we
already use. It reads `latest-*.yml` straight from GitHub releases, verifies
SHA-512, handles AppImage, and on macOS delegates to Squirrel.Mac, which
enforces that the new bundle satisfies the running app's designated code
requirement. The only alternative we considered was a hand-rolled downloader,
and it would reimplement all of this.

**Boundary crossed:** network access and installation stay in the privileged
main process (`electron/appUpdater.ts`). The renderer gets status data and one
new semantic action, `updater.install`, gated on the existing `updater`
capability. It never supplies a URL, path, or version to install. Browser and
PWA hosts don't have the capability, so nothing changes for them.

### 2. Stable uses the GitHub provider, Beta uses a generic provider on `main-latest`

For Stable, `electron-updater`'s GitHub provider with
`allowPrerelease: false` resolves `releases/latest`. That already ignores the
`main-latest` prerelease.

For Beta, the feed is set at runtime with `setFeedURL({ provider: 'generic',
url: 'https://github.com/markwylde/terminay/releases/download/main-latest/',
channel: 'beta' })`. The client then reads `beta-mac.yml` / `beta-linux.yml`
from the rolling release. Beta versions are
`<next stable version>-beta.<workflow run number>`: the next version comes from
`scripts/release-utils.mjs`'s `getNextVersion` over the commits since the last
tag, and the run number keeps them monotonic. With the GitHub publish provider, `electron-builder` does not derive the
channel from the prerelease component. The beta build therefore passes
`-c.publish.channel=beta`, so it writes `beta-*.yml` (checked with a local
build). That also embeds `channel: beta` in the beta app's `app-update.yml`, so
the updater always sets its feed explicitly for both channels instead of
relying on the embedded file. `allowDowngrade` stays false, which
gives us the "switching back to Stable never installs a lower version" rule
for free.

We rejected the alternative of one GitHub prerelease per `main` commit because
it floods the release list. The rolling release already exists and ADR-0016
already treats it as a channel.

### 3. Update metadata is published last

- **Tagged release:** the build jobs upload the payloads (`dmg`, `zip`,
  `AppImage`, their `.blockmap`s, and SHA-256 sidecars), plus the generated
  `latest-*.yml` as a *workflow artifact* only. `publish-release-notes` sets
  the release body first and then attaches `latest-mac.yml` and
  `latest-linux.yml`. A client can only see an update once those files exist,
  so it can never see one that has only the "Release in progress." body.
- **`main-latest`:** the desktop payloads join the existing
  upload-as-`.incoming`-then-rename flow. The `beta-*.yml` files are renamed
  into place last. They reference fixed asset names
  (`terminay-desktop-main-mac.zip`, `terminay-desktop-main-linux-x86_64.AppImage`),
  so replaced payloads never accumulate. Beta disables differential download
  because the previous blockmap is overwritten on every run.

### 4. Release notes are fetched by the main process from the GitHub REST API

For Stable, `electron-updater`'s `fullChangelog` walks the releases Atom feed,
and that feed contains the non-semver `main-latest` entry. Instead, the main
process calls `GET /repos/markwylde/terminay/releases?per_page=100` once per
newly available version. It keeps non-draft, non-prerelease tags that satisfy
`installed < v <= available`, sorts them newest first, and returns
`{ version, url, body }[]` with each body capped at 64 KiB. Unauthenticated
requests (60 per hour) are ample at that frequency.

For Beta, the notes are the `releaseNotes` field of `beta-*.yml`. The workflow
generates it with
`electron-builder -c.releaseInfo.releaseNotesFile=<file>` from
`git log --format='- %s' <last tag>..HEAD`.

The renderer turns Markdown into HTML with the `markdown-it` it already bundles
(`src/appUpdateNotes.ts`). With `html: false`, raw HTML is escaped rather than
passed through, so no element or attribute can come from the notes. The
`image` rule is disabled, so no remote resource is ever loaded, and
markdown-it's link validator rejects `javascript:`, `vbscript:`, `file:` and
`data:` URLs. A click on a link is intercepted, and only `http(s)` targets are
opened, through `openExternalUrl`. A separate DOMPurify pass would have nothing
left to remove. `dompurify` is only a transitive override here, not a direct
dependency, so we don't add it.

The notes are untrusted text either way, since they come from a network
response, and are treated like any other untrusted document content.

### 5. Install capability is detected, not assumed

`canInstallInPlace` is true when:

- the app is packaged on macOS, or
- on Linux, `process.env.APPIMAGE` names a file that exists and both that file
  and its directory are writable.

Everything else keeps the `releaseUrl` notify-and-link path. Those builds never
load `electron-updater`, which refuses to run outside an AppImage. Instead
they read the `version:` line of the channel's `latest-*.yml` or `beta-*.yml`,
the same file an installable build would use, and compare it with their own. An error during a
download or install on a capable build also falls back to notify-and-link for
that version. That covers macOS App Translocation, an app bundle the user
can't write to, and a signature mismatch.

### 6. Restart and quit go through the existing graceful quit path

`autoInstallOnAppQuit` stays true. `createGracefulQuitHandler` lets the
second `quit` through after shutdown settles, which is when `electron-updater`
installs. For **Restart to update**, `updater.install` sets a restart flag and
calls `app.quit()`. That triggers the usual running-terminal confirmation and
the graceful shutdown. Its final quit then calls
`autoUpdater.quitAndInstall(false, true)` instead of `app.quit()`, so the
server, PTYs, and diagnostics shut down cleanly before the app is replaced. If
the user cancels the confirmation, the flag is cleared.

### 7. Channel is a device setting

`updateChannel: 'stable' | 'beta'` is added to `TerminalSettings` and is not in
`SERVER_OWNED_TERMINAL_SETTING_KEYS`. That makes it a connection-host setting,
persisted by Desktop and never written to a server. It is inherently
device-specific, because it decides which binary this machine runs. The
`device.settings.update` handler calls `appUpdater.setChannel()`, which
reconfigures the feed and starts a check right away.

### 8. Status shape

`AppUpdateStatus` becomes:

```ts
{
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'available' | 'error';
  channel: 'stable' | 'beta';
  currentVersion: string;
  latestVersion: string | null;
  canInstallInPlace: boolean;
  downloadPercent: number | null;
  releaseUrl: string | null;
  releaseNotes: { version: string; url: string | null; markdown: string }[] | null;
  releaseNotesError: string | null;
  checkedAt: string | null;
  errorMessage: string | null;
  hasUpdate: boolean;
}
```

`hasUpdate` is true for `ready`, or for `available` when
`canInstallInPlace === false`. The desktop presentation's
`DesktopUpdaterState` already includes `ready`. The renderer keeps polling
`updater.check` hourly, which returns the cached status without forcing
network traffic. Main pushes nothing new over IPC.

## Risks / Trade-offs

- **Every merge to `main` pays for a macOS signing and notarization run.** →
  Beta builds run in their own job, so a notarization outage doesn't block the
  server archives: those still publish and the previous desktop set stays in
  place. A dry run builds and notarizes the beta too, which proves the signing
  path, but publishes nothing.
- **An existing install built before this change has no updater.** → It keeps
  opening the release page, and the user installs this release by hand one last
  time. Every release after that updates in place.
- **Squirrel.Mac rejects the update if the signing identity changes.** →
  Rotating the certificate within the same Team ID keeps the designated
  requirement satisfied. A Team ID change would need a manual reinstall, which
  is the property we want.
- **GitHub API rate limit.** → Notes are fetched once per new version and
  cached in memory. On failure the dialog links out (see the spec scenario).
- **The release-contract tests pin exact asset sets and workflow text.** →
  Update them in the same change, and keep the "exactly one DMG / one AppImage"
  assertions, extended with the zip and yml files.

## Migration Plan

This is additive. The first release after merge publishes `latest-*.yml`, and
older installs keep showing their link-out button. To roll back, stop
publishing the `yml` files. Clients then find no update metadata, report
nothing, and the next check retries.

## Open Questions

None. ADR-0016 still holds. This change extends its rolling `main` channel
with desktop payloads without altering its server-archive rules.
