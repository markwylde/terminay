# ADR-0143: The workspace plays server-typed audio as well as video

Status: accepted, supersedes ADR-0139 in part
Date: 2026-11-26
Supersedes: ADR-0139 (decision 2 only: which server-derived types may be given to a media element; decisions 1 and 3 continue unchanged)

## Context

ADR-0139 admitted `blob:` media so Chat could play MP4 and WebM attachments, and limited media elements to content the server typed as `video/mp4` or `video/webm`. Users and bots also attach songs, voice notes and sound effects, which today can only be downloaded. The policy itself already admits `blob:` audio; only the rule about what content reaches a media element needs to widen. ADR-0005 and ADR-0011 still treat renderer content as untrusted.

## Decision

1. Only content the server has typed from its bytes as `video/mp4` or `video/webm` is given to a `<video>` element, and only content it has typed as `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/flac` or `audio/mp4` is given to an `<audio>` element. The renderer rechecks the server-derived type returned with the bytes before creating the `blob:` URL. Names, recorded types and client-claimed types never select a player.
2. Audio types are recognised from at most the first 64 bytes, by the same bounded check as video. Recognition does not prove the content is playable; a decode failure falls back to a download.
3. The UI-bundle policy is unchanged: `media-src 'self' blob:` (ADR-0139 decision 1).

## Consequences

- Chat can play audio attachments without a new server route, origin or policy change.
- Browser audio decoders now parse attachment content, so they join video decoders in the renderer's threat model. The renderer gains no privilege.
- Adding another playable type, or another element that receives attachment `blob:` URLs, needs a new ADR.
