## Context

Desktop updates in place through electron-updater (`electron/appUpdater.ts`).
`configureFeed` sets `allowDowngrade = false` on every check, and `selectSource`
already resolves the channel's latest version: the higher of the channel's
prerelease and stable on Nightly or Canary, or stable alone on Stable. The
resolved version is used only when it is newer. ADR-0110 decision 5 states that
Desktop never enables downgrades.

A remote server upgrades through `terminay daemon upgrade`, run by the
upgrader shipped in its release (`apps/terminay-server/src/releaseUpgrader.ts`).
The client request carries only the mode. `upgradeArguments` derives the argv
from the environment and mode alone. A system-scope server triggers a
root-owned oneshot by touching a request file that is never read. The CLI
already supports `--allow-downgrade`. `daemon upgrade --check` reports
`available` only when the latest release is newer. ADR-0062 decision 1 states
that a server never moves to an older release.

The changes `three-release-tracks`, `remote-server-in-app-upgrade` and
`settings-server-rail` introduce the requirements this change builds on and are
not yet archived.

## Goals / Non-Goals

**Goals:**
- One explicit, confirmed action per updater that installs the channel's latest
  build regardless of order.
- A client still never names a version. The target is always what the updater's
  own check resolved on its own channel.
- Every non-explicit path keeps its no-downgrade guarantee.

**Non-Goals:**
- Choosing an arbitrary older version, or pinning a version.
- Reinstalling the identical build. electron-updater treats an equal version as
  "no update" even with `allowDowngrade`, and a same-version server upgrade is a
  no-op. The action is shown disabled in that case.
- Changing a remote server's channel from a client.
- Migrating settings or state backwards. The confirmation warns instead.

## Decisions

1. **Desktop: a separate `installLatest()` operation, not a flag on `check`.**
   It runs under the same generation guard as checks, takes the source and
   version from `selectSource`, configures that feed, then sets
   `allowDowngrade = true` for that one `checkForUpdates` call. It refuses when
   the resolved version equals the running one, or differs from the version the
   user confirmed, because the channel may have moved. On `update-downloaded` it
   goes through the existing restart-to-update path (`requestRestartToUpdate` →
   graceful quit → `quitAndInstall`). `configureFeed` resets
   `allowDowngrade = false` for every other check. Alternative considered:
   toggling `allowDowngrade` from the channel setting, which is what
   electron-updater's `channel` setter does. Rejected, because it would make an
   implicit channel change downgrade.
   *Boundary:* renderer → main IPC. The preload exposes
   `installLatestUpdate(expectedVersion)`. The renderer passes only the version
   it showed, as a consistency check. Main never downloads from a URL or version
   the renderer supplies.

2. **Desktop status gains `channelLatest: { version, source } | null`.** It is
   filled from every `selectSource` result, including one that is not newer, so
   the page can label the action without another probe. It is null for a
   development build, on a platform that cannot update in place, and before the
   first successful check.

3. **Server: `allowOlder` is a boolean on the existing request, not a version.**
   The server maps it to `--allow-downgrade` in `upgradeArguments` (user scope
   and container) or to the second request file (system scope). The target stays
   whatever the upgrader's own resolution finds on the installed channel, so
   ADR-0062's "a client only asks" holds. Release integrity is unchanged:
   digest, Ed25519 signature, and the side-by-side switch with rollback.
   *Boundary:* client → server protocol (`server.upgrade`). The schema stays
   strict, and the only new input is a boolean.

4. **System scope: a second fixed path/oneshot pair.** The pair is
   `terminay-upgrade-latest.path` and `terminay-upgrade-latest.service`. Its
   command line is fixed as `daemon upgrade --system --allow-downgrade`. Its
   request file is separate and, like the first, is never read. Alternative
   considered: reading a flag from the existing request file. Rejected because
   it would turn a write-only trigger into an input that root parses.
   *Boundary:* the run-as account → root. The account can now cause a move to
   the channel's latest signed release in either direction, but still cannot
   choose which release. Installs from before this change lack the pair until
   their next `daemon upgrade`. The status reports that, with the host command.

5. **Check report gains `latest` with an `order`.** `daemon upgrade --check`
   adds `latest: { version, revision?, publishedAt?, order: 'newer' | 'same' |
   'older' } | null`, and `available` is unchanged. `parseUpgradeCheckOutput`
   accepts `latest` as optional, so a newer server can read an older upgrader's
   report. The server marks install-latest unavailable when `latest` is absent.

6. **Container floor.** The entrypoint runs the newest of the image's release
   and the staged release (ADR-0062 decision 4), so staging a release below the
   image's release does nothing. The check compares `latest` with the image's
   release and reports install-latest as unavailable below it, with the reason.
   Recreate is not offered for this, because it would pull the same tag.

7. **UI.** The Desktop Updates page adds a row under VERSIONS, after "Latest on
   <channel>", with the **Install latest on <channel>** button. The server
   Updates page and `ServerUpgradeDialog` reuse one confirmation component with
   a `downgrade` flag that adds the warning. `updatesPageModel.ts` computes
   the label, enabled state, and reason for both pages, so the logic is
   unit-tested once.

## Risks / Trade-offs

- [An older build cannot read settings or state written by a newer one] →
  The confirmation warns. Durable state files are versioned (`durable-state-files`),
  and the older build's existing handling of unknown newer state applies. No
  backward migration is attempted.
- [A paired device could push a server back to an older release] → The target
  is still the newest signed release on that channel, never an arbitrary old
  one, and the action needs the same pairing an upgrade does.
- [The channel moves between confirmation and download] → `installLatest`
  refuses when the resolved version differs from the version the user saw,
  and the page refreshes.
- [A background check interleaves with installLatest and reconfigures the feed]
  → Both run under the updater's single in-flight guard and generation counter,
  and `installLatest` waits for any running check.
- [A system-scope install from before this change] → The action is disabled,
  with the one-line host command, until the next `daemon upgrade`.

## Migration Plan

No data migration. The server protocol change is additive. An older server
rejects `allowOlder` as an unknown field, but clients send it only when the
status names an older `latest`, which only a newer server reports. Rollback
means reverting the release. Installs keep working without the new units.

## Open Questions

- ADR-0062 decision 1 ("never to an older one") and ADR-0110 decision 5
  ("Desktop never enables downgrades to move between tracks") need a
  superseding record. The adr step records it.
