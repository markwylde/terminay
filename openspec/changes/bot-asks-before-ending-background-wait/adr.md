# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-28
- Reviewer: Claude Code
- Change: bot-asks-before-ending-background-wait

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - the 5-minute check is a repeating timer the owner approved in ticket 680
- openspec/adr/0138-a-permitted-bot-reads-other-bots-through-allowlisted-runtime-tools.md - `sessions_get` scope is unchanged
- openspec/adr/0140-bot-sessions-have-no-time-limit-and-are-watched-by-check-ins.md - superseded by this change

## Repository-Level ADRs Created

- openspec/adr/0149-a-bot-session-waiting-on-background-work-is-asked-whether-it-is-done.md - supersedes ADR-0140; a waiting session is asked whether it is done

## Notes

Evidence: openspec/adr/evidence/claude-code-background-wait.md
