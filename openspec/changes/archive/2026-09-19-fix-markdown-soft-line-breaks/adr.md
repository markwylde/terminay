# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-19
- Reviewer: Mark Wylde
- Change: fix-markdown-soft-line-breaks

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the fix
  ships in the one workspace bundle and is presentation only, so it needs no
  per-connection negotiation.
- openspec/adr/0011-security-trust-boundary-model.md - the change stays inside
  untrusted renderer presentation and crosses no trust boundary.
- Remaining in-force ADRs (0001-0006, 0010, 0012, 0013, 0015-0017,
  0019-0023, 0025-0027) were reviewed and bear on server runtime, distribution,
  security, or agent concerns that this change does not touch. ADR-0007,
  ADR-0008, ADR-0009, ADR-0014, and ADR-0024 are superseded and were read as
  history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The decision to correct rendering presentationally rather than rewriting the
document model is a local one about a single editing surface. It sets no pattern
future changes must follow and is reverted by deleting one CSS rule, so it stays
in design.md.
