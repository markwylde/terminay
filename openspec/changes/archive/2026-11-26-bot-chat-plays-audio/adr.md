# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-26
- Reviewer: Claude (Opus 5.5)
- Change: bot-chat-plays-audio

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - renderer content is untrusted; audio plays only inside the sandboxed workspace.
- openspec/adr/0011-security-trust-boundary-model.md - provider and renderer trust boundaries; no privilege is added to the renderer.
- openspec/adr/0130-desktop-saves-renderer-bytes-through-a-streamed-host-save.md - attachment downloads go through the host save flow; the audio player's download button reuses it.
- openspec/adr/0137-the-workspace-admits-terminay-com-as-its-only-hosted-content-origin.md - no hosted origin is added to the workspace policy.
- openspec/adr/0139-the-workspace-plays-media-only-from-its-own-origin-and-blob-urls.md - `media-src 'self' blob:` and video-only media elements; decision 2 is superseded in part.

## Repository-Level ADRs Created

- openspec/adr/0143-the-workspace-plays-server-typed-audio-as-well-as-video.md - server-typed audio may be given to `<audio>` from a `blob:` URL; the policy is unchanged. Supersedes ADR-0139 decision 2.

## Notes

ADR-0139 is not edited; the README index row notes the partial supersession.
