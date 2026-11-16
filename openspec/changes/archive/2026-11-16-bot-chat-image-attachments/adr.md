# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (Opus 5.5)
- Change: bot-chat-image-attachments

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - durable, bounded message attachments that outlive executions; user images use the same store and limits.
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - host-owned native CLI launch and container-only execution; image input is added to the host-built Codex arguments and the Claude stream-json turn, and the images are copied only into the owning container.
- openspec/adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md - app-window attachments are a separate mechanism, unaffected; bot attachments stay bounded and durable rather than streamed scratch writes.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the composer is a renderer feature that reaches the server only over the connection transport.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Upload-then-post staging and native image delivery are implementation choices within ADR-0093's attachment model and ADR-0096's host-owned launch, recorded in design.md.
