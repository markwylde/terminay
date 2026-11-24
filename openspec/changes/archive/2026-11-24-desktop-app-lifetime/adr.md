# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-04
- Reviewer: Codex
- Change: desktop-app-lifetime

## In-Force ADR Context Reviewed

- `openspec/adr/0028-no-polling-without-owner-approval.md`: event-driven readiness and lifecycle.
- `openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md`: current native CLI/container boundary; reaffirms ADR-0093 execution/work ownership and ADR-0094 engine attribution, superseding their ACP choices only.
- `openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md`: terminal-agent policy remains unchanged; bot-specific exception is carried forward by the native-driver ADR.

## Repository-Level ADRs Created

- `openspec/adr/0098-bot-desktop-owns-graphical-applications.md`: accepted desktop ownership of graphical application processes; accepted records are unchanged.

## Notes

All existing ADR files were read and their Supersedes fields reviewed. Partial supersessions preserve the expressly reaffirmed commitments. Existing duplicate sequence 0096 files are distinguished by filename; the new sequence is greater than the highest number present. Proposed records do not override accepted records.


Implementation gates were verified on 2026-11-04; see [verification.md](verification.md).
