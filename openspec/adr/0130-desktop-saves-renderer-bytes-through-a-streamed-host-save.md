# ADR-0130: Desktop saves renderer bytes through a streamed host save

Status: accepted
Date: 2026-11-16

## Context

Desktop runs its packaged workspace bundle (ADR-0047) in sandboxed sessions that cancel every browser-initiated download (ADR-0005). Saving bytes therefore needs a host action. The existing ones, `preview.download` and `import-export.bundle.save`, carry the whole payload in one message and are capped at 16 MiB and 4 MiB. Downloading from a bot's home (issue #593) needs files up to 1 GiB and unbounded folder archives, and the blob anchor the view used was silently dropped.

## Decision

1. Renderer bytes that do not fit a single bounded payload reach the local filesystem only through a streamed host save: `file.save.open` (native save dialog for a suggested name, returns an opaque token or a cancellation), `file.save.write` (≤ 1 MiB decoded per chunk, one at a time), and `file.save.close` (commit or abort), under the `osIntegration` capability.
2. The host writes to a temporary file beside the chosen destination and renames it into place only on commit. Abort, a failure, 5 minutes without a write, or the end of the owning document removes it.
3. A save belongs to the server UI document that opened it, at most 4 at a time. The renderer never receives the destination path, and errors it receives are generic.
4. Browser-initiated downloads stay denied in Desktop sessions. Browser hosts use their own download flow.

## Rejected alternatives

- **Allow `will-download` for `blob:` URLs.** Reopens the download surface ADR-0005 closes and hands destination choice to Chromium.
- **Raise the single-payload limit.** Puts gigabytes through one IPC message and the renderer heap.

## Consequences

- Workspace downloads of any size use one renderer helper that works in Desktop and in browsers.
- An abandoned save can hold a hidden temporary file in the user's chosen directory for up to 5 minutes, or until its document ends; a main-process crash can leave one behind.
- A renderer can make the user's disk fill only to the extent the user picked a destination; per-document limits bound open saves and queued data.
- The single-payload save actions remain for their bounded uses.
