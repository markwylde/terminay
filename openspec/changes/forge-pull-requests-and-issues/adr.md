# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude (Opus 5.5), with the repository owner's design approval of 2026-11-11
- Change: forge-pull-requests-and-issues

## In-Force ADR Context Reviewed

- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - forge queries spawn nothing; tokens follow ADR-0063
- openspec/adr/0028-no-polling-without-owner-approval.md - lists and badges refresh on demand only; no unapproved poll
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - forge items follow the same host-owned typed-fact model
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - worktree creation chooses its path server-side
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - initial prompts are a new owner-approved exception
- openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md - a launch-line prompt is terminal input like any typed command; ADR-0104 says so
- openspec/adr/0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md - account discovery and tokens obey it
- openspec/adr/0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md - superseded by ADR-0104

## Repository-Level ADRs Created

- openspec/adr/0104-a-launcher-may-start-an-agent-with-a-user-confirmed-initial-prompt.md - a launcher may receive a user-confirmed initial prompt as one host-quoted argument; supersedes ADR-0081
- openspec/adr/0105-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md - pull-based forge sources, host-owned joins and presentation, on-demand freshness, narrowing authority

## Notes

- After the Codex review, ADR-0104 (not yet merged) was narrowed before acceptance: prompts are not kept in Terminay's terminal state, but may appear in shell history and recordings; leading-dash and `cmd.exe` prompts are rejected.
- The explored Settings mockup's "Check for changes every N minutes" was dropped, because it would be a poll that needs owner approval under ADR-0028.
