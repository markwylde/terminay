# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: bot-chat-accepts-any-file

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - durable, bounded attachments that outlive executions; it does not restrict attachments to images, so opaque files fit the same store and bounds.
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - host-owned native launch; native image input is unchanged and other files reach the agent only as container files.
- openspec/adr/0130-desktop-saves-renderer-bytes-through-a-streamed-host-save.md - sent files are downloaded through the same host save as the Files tab.
- openspec/adr/0109-terminay-reports-execution-failures-as-facts-and-the-bot-judges-them.md - a failed attachment copy fails the execution with the copy error as its reason.
- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - same-bot executions share the container and UID, so per-execution attachment copies are scoped by briefing and cleanup, not isolation.
- openspec/adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md - app-window attachments are a separate mechanism and are unaffected.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Treating unrecognised content as opaque, download-only bytes is a design choice within ADR-0093's attachment model, recorded in design.md.
