# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: hosted-ui-archive-delivery

## In-Force ADR Context Reviewed

- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - the archive is meant to be self-contained; shipping a UI bundle the server cannot serve is a violation of that, and this change adds the check that enforces it
- openspec/adr/0011-security-trust-boundary-model.md - the UI archive crosses the device boundary already; this changes which bundle is sent, not who may receive it
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - approval is unaffected; the defect appeared after approval succeeded
- openspec/adr/0001-pinned-node-runtime-baseline.md - no runtime change

ADR-0002, 0003, 0004, 0005, 0006, 0008, 0009, 0010, 0012, 0014, and 0015 are in
force but do not constrain this change.

## Repository-Level ADRs Created

- None. Staging the correct bundle and naming a variable consistently are
  corrections, not decisions. The durable rule they imply — that an artifact is
  verified against what its consumer will ask of it, not merely against its own
  manifest — already follows from ADR-0016's self-contained artifact principle,
  and is enforced here rather than restated.

## Notes

The defect is worth recording in the change rather than an ADR: two settings
that share a value were given one name, and a build staged a bundle nobody
checked against its consumer. Both failures were invisible because each had a
plausible-looking success signal — `uiBundleConfigured: true`, and an archive
whose own manifest validated.
