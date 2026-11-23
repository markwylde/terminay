# ADR-0138: The workspace plays media only from its own origin and blob URLs

Status: accepted
Date: 2026-11-23

## Context

Bots and users can attach MP4 and WebM files to chat messages, and Chat plays them inline. Attachment bytes reach the renderer through the authorized attachment operation, so the player needs a `blob:` URL. The workspace UI policy (`DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY`) has no `media-src`, so media falls back to `default-src 'self'` and blob playback is blocked. ADR-0005 and ADR-0011 treat renderer content as untrusted, and ADR-0137 keeps hosted origins out of the policy except for one named frame and connection origin.

## Decision

1. The UI-bundle policy adds exactly `media-src 'self' blob:`. It admits no remote, `data:` or wildcard media source.
2. Only content the server has typed as `video/mp4` or `video/webm` from its bytes is given to a `<video>` element. Names and client-claimed types never select a player.
3. Bundles carrying an earlier policy are accepted and served with the current one. Any other supplied policy is refused.

## Consequences

- Chat can play attachments without a new server route or a remote origin.
- Any script already running in the workspace could play a blob it created. That adds no data access, because `script-src 'self'` still governs what runs.
- Browser media decoders now parse attachment content, so decoder bugs are in the renderer's threat model. The renderer has no added privilege.
- A future remote media source needs a new ADR.
