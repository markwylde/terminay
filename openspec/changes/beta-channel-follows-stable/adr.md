# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-21
- Reviewer: Claude (for Mark Wylde)
- Change: beta-channel-follows-stable

## In-Force ADR Context Reviewed

- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md -
  defines both feeds (§2 stable, §3 beta) and the rule that metadata and
  payloads come over HTTPS from this project's GitHub releases and are digest-
  and signature-checked. This change reads both feeds it defines and changes
  neither; verification and install are untouched.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md -
  the rolling `main-latest` channel keeps one non-version tag, which is why
  electron-updater's tag-based prerelease selection is not used.
- openspec/adr/0011-security-trust-boundary-model.md - source selection stays in
  the privileged main process and chooses between two fixed feed
  configurations; nothing fetched supplies a URL, path, or version.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the
  updater is a host capability; status shape and host protocol are unchanged.
- openspec/adr/0022-watch-do-not-poll.md - no new timer; the probe rides the
  existing hourly check.

Reviewed and not relevant to this change: ADR-0001 through ADR-0006, ADR-0010,
ADR-0012, ADR-0013, ADR-0015, ADR-0017, ADR-0019 through ADR-0021, ADR-0023,
ADR-0025, ADR-0026.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017), ADR-0014 and ADR-0024 (by ADR-0025).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

"Beta is stable plus prereleases" is a product rule and lives in the capability
spec. How the host picks between the two feeds is a tactical detail of
`electron/appUpdater.ts`, recorded in design.md. ADR-0027 is not revisited: it
says what each feed is, not that a channel reads only one.
