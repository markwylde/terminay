# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (for Mark Wylde)
- Change: add-trigger-sessions-link

## In-Force ADR Context Reviewed

The supersession graph was rebuilt from the `Status` and `Supersedes` fields of every file in `openspec/adr/` (0001–0098). The highest sequence number in use is 0098. One ADR is `proposed`, not accepted: `0096-bot-trigger-sources-execute-in-the-owning-container.md`. The rest are accepted, and those named by a later `Supersedes` field are superseded wholly or in part. The in-force decisions this change engages are listed below, with their Decision sections read in full.

- openspec/adr/0011-security-trust-boundary-model.md - accepted. Copied ids and renderer requests cannot widen a capability. The renderer supplies a bot id and a trigger id. The server lists that bot's own records only, so the trigger id selects within the bot and grants nothing.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - accepted; it supersedes ADR-0089 in part and is itself superseded in part by ADR-0096 (native CLI drivers) for ACP only. Sessions remain server-owned execution records. This change adds a read filter and no mutation.
- openspec/adr/0028-no-polling-without-owner-approval.md - accepted; it supersedes ADR-0022. The Sessions panel re-queries only on filter changes and on its existing projection updates. No poll is added.

Proposed and not treated as a constraint:

- openspec/adr/0096-bot-trigger-sources-execute-in-the-owning-container.md - proposed. Trigger execution is untouched by this change either way.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It adds an optional filter to an existing server read and a navigation action between two panels of the bot tab.

## Notes

None.
