# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: bot-desktop-paste-bridge

## In-Force ADR Context Reviewed

- openspec/adr/0129-a-bot-desktop-shares-the-clipboard-only-while-the-user-controls-it.md: decision 2 limits host-to-bot text to the native paste event. This change supersedes that decision in Desktop and keeps every other decision.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md: ambient clipboard-read stays denied. The read here goes through the existing user-gesture terminal paste bridge, not `navigator.clipboard`.

## Repository-Level ADRs Created

- openspec/adr/0132-desktop-pastes-into-a-bot-desktop-through-the-terminal-paste-bridge.md: Desktop reads bot-desktop paste text through the terminal paste bridge, and browsers keep the native paste.
