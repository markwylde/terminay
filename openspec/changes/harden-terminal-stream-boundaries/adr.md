# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-01
- Reviewer: Codex, with independent read-only Claude review requested by the owner.
- Change: harden-terminal-stream-boundaries

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — input authorization remains server-owned.
- openspec/adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md — control admission preserves sleep-aware liveness.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md — queues retain exact terminal identities and retire with them.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md — holder retention cost does not grow with retained chunk count.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md — deduplication and pending request admission remain connection-scoped.
- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md — output changes do not introduce workspace commits.
- openspec/adr/0086-a-windows-pipe-admits-only-the-users-principals-and-a-peer-that-proves-the-credential.md — holder lifetime, bounded output retention, authentication and frozen generations remain unchanged.

## Repository-Level ADRs Created

- None: this implements and clarifies existing boundaries without introducing a new durable architectural commitment. Presentation continuity across server replacement requires a separate design and superseding ADR; it is not implemented here.

## Notes

The completed unarchived handoff change intentionally accepted uncertain-write continuation. Its active proposal, design and delta are amended to preserve confirmed/refused handoff behavior and explicitly resolve the uncertain case in favor of the existing input-safety contract. The owner authorized proposal and implementation together; both remain reviewable in a worktree without writing or merging the main clone.
