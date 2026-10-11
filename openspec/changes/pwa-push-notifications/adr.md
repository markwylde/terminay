# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-11
- Reviewer: Claude (for Mark Wylde)
- Change: pwa-push-notifications

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - hosted services are untrusted for confidentiality and integrity, and a new boundary must join the model before it ships; ADR-0060 adds two.
- openspec/adr/0012-pwa-framed-session-host.md - the manager is the top-level origin, holds a fixed small host surface, and reads no workspace content; push widens that surface by a bounded amount.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - credentials travel only the authenticated channel and belong to a device; enrolment follows the same rule.
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - a browser cannot use direct signaling, so push is a hosted feature.
- openspec/adr/0028-no-polling-without-owner-approval.md - rules out the PWA polling saved servers for a count.
- openspec/adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md - Terminay runs no data path for application content; the hosted push service carries only sealed, fixed-length ciphertext.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - one framed server at a time, no background connections, and an open item for an activity summary of servers no window shows.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - enrolment and revocation are the device's; a window's visibility report carries no authority.
- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md - terminal-derived titles are sanitised display text; a banner shows them as plain text and they select nothing.
- Remaining in-force ADRs (0002, 0003, 0005, 0006, 0010, 0016, 0017, 0019-0021, 0023, 0025-0027, 0029, 0031, 0033, 0035-0046, 0049-0055, 0057, 0059) checked against the index by title and scope; none constrains push delivery and none is touched by this change.

## Repository-Level ADRs Created

- openspec/adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md - a push is sealed with a per-pairing key and verified on the device, the server's name is device-held, and the hosted push service reads nothing and stores nothing that identifies an installation; extends ADR-0011's boundary table and supersedes nothing.

## Notes

- ADR-0011, ADR-0012, and ADR-0047 are left untouched. ADR-0060 extends the first, narrows the second's "no workspace content" consequence by one bounded exception, and closes the third's open item for the PWA.
- ADR-0060 carries two open items that the spike in tasks group 1 answers; its evidence file is added under `openspec/adr/evidence/` when the spike is run.
- The index in `openspec/adr/README.md` has a row for ADR-0060.
