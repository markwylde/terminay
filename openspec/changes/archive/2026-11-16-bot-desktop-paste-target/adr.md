# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: bot-desktop-paste-target

## In-Force ADR Context Reviewed

- openspec/adr/0129-a-bot-desktop-shares-the-clipboard-only-while-the-user-controls-it.md: host text reaches the bot only through the native paste of the user's shortcut. This change gives that paste a reliable target. The rule itself is unchanged.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md: ambient clipboard-read stays denied. This change adds no programmatic read.

## Repository-Level ADRs Created

None. The change implements ADR-0129 as written.
