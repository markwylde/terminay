# ADR-0117: Installing a channel's latest build may move backwards, but only on an explicit request

Status: accepted, supersedes ADR-0062 and ADR-0110 in part
Date: 2026-11-14
Supersedes: ADR-0062 (decision 1, "never to an older one"), ADR-0110 (decision 5, "Desktop never enables downgrades to move between tracks")

## Context

ADR-0062 decision 1 says a server upgrades only to its channel's newest release
"and never to an older one". ADR-0110 decision 5 says Desktop never enables
downgrades to move between tracks. Together they leave no in-app way off a build
that is ahead of its channel. That happens to a Desktop moved from Nightly or
Canary back to Stable, and to a server whose prerelease build misbehaves. The
only remedy was waiting for the channel to overtake the build, or running
`terminay daemon upgrade --allow-downgrade` on the host.

The no-downgrade rule exists because automatic movement must never surprise
anyone. It does not need to bind a user who asks for the move.

## Decision

1. **Every automatic path stays forward-only.** Scheduled and manual checks,
   update notices, the upgrade indication, and changing the channel never
   install or offer an older build.
2. **One explicit action may move backwards.** "Install latest on <channel>"
   installs the latest build that the updater's own check resolved on its own
   channel, whether it orders newer or older than the running build. It needs a
   confirmation that names both versions and, for an older target, warns that
   state may not carry over.
3. **The target is never client-chosen.** A server request adds only the
   boolean `allowOlder` to the mode. Desktop's renderer passes only the version
   it displayed, as a consistency check. The updater refuses when its own
   resolution differs. Signature and digest verification are unchanged.
4. **Root crosses on a second fixed trigger.** A system-scope server asks for
   the backward-capable install through a separate root-owned path unit and
   oneshot. That oneshot's command line is fixed and includes
   `--allow-downgrade`. Its request file is never read, as in ADR-0062
   decision 3.
5. **A container's image is its floor.** A container cannot install a release
   older than the one built into its image (ADR-0062 decision 4), and the
   action reports that instead.

## Consequences

- A paired device, or a system-scope run-as account, can move a server back to
  its channel's newest signed release. It still cannot choose any other
  release.
- An older build may meet settings or state written by a newer one. Terminay
  warns and does not attempt a backward migration.
- System-scope installs need a second helper unit pair, which installs from
  before this decision get at their next `daemon upgrade`.
- Reinstalling the identical build is not offered. electron-updater cannot do
  it, and a same-version server upgrade is a no-op.
