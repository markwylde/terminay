# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: drop-in-browser-language-services

## In-Force ADR Context Reviewed

- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the bundle this change shrinks is the server-bundled workspace UI; how it is delivered is unchanged
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - records the client-runs-no-language-service rule that this change implements first; the ADR is created by the `language-server-extensions` change in the same pull request

Every other in-force ADR does not constrain this change.

## Repository-Level ADRs Created

- None: the durable decision, that the client runs no language service, is recorded in ADR-0019 alongside the server-side half of it rather than split across two records.

## Notes

This change is the first half of ADR-0019 and can ship on its own. Its only
product effect is that fake diagnostics stop and the bundle shrinks.
