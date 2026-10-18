# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-18
- Reviewer: Claude (for Mark Wylde)
- Change: terminal-input-survives-attachment-handoff

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the presentation lease stays server-enforced on every `terminal.input`; the renderer only decides when to send.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md - a move between projects retires the identity and remounts the panel; it is not an attachment handoff and keeps its own lifecycle.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - a rebind onto a replacement connection is one of the handoffs; authority still comes from the device's connection, not from the queue.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change is a product-contract addition to `terminal-workspace`, enforced in the renderer's existing per-panel input queue.
