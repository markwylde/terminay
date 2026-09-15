## Context

Desktop paste already prefers copied paths, then text, then an image-only
clipboard that Electron writes to `app.getPath('temp')/terminay-clipboard/` and
inserts as a shell-escaped path. The browser client only calls
`navigator.clipboard.readText()`. The mobile accessory Paste button, the
terminal `paste` listener (skipped unless Desktop owns the clipboard), and the
context-menu paste all share that text path. A screenshot on iOS Safari is an
image, so those controls do nothing.

Browser file drop is the nearest existing upload: bounded bytes go through
`files.create` into the selected **project root**, and the resulting project
path is typed into the terminal. That is the wrong destination for a
screenshot — it dirties the repo — and `files.create` cannot write `/tmp`
because catalog paths are project-scoped (ADR-0011, ADR-0020).

iOS Safari is the motivating client. WebKit grants `clipboard.read()` for
`image/png` after a user gesture, and otherwise shows a paste callout; the
call must be made inside that activation, not after an await that spends it
(the same Safari trap already fixed for `writeClipboardText`). Image
`clipboard.read()` is still flaky on some iOS versions, while the trusted
`paste` event's `clipboardData.files` remains the reliable long-press path.
Android Chrome reads images through `clipboard.read()` more consistently.
HTTPS (or localhost) is required.

```
+------------------+     user gesture      +------------------+
| iOS Safari       | --------------------> | workspace UI     |
| screenshot on    |  Paste button, or     | read image blob  |
| the clipboard    |  long-press paste     | inside activation|
+------------------+                       +--------+---------+
                                                    |
                                                    v
                                           +--------+---------+
                                           | Terminay Server  |
                                           | scratch write    |
                                           | /tmp/terminay-   |
                                           | clipboard/*.png  |
                                           +--------+---------+
                                                    |
                                                    v
                                           +--------+---------+
                                           | PTY input        |
                                           | '/tmp/...png'    |
                                           +------------------+
```

In-force ADRs that constrain this: ADR-0005 (sandboxed origin-bound hosts;
clipboard is an explicit permission, not a secret boundary), ADR-0011
(filesystem services stay project-scoped; this change must not punch a general
hole through `files.create`), ADR-0017 (the path must exist on the server that
owns the PTY), ADR-0018 (shared workspace bundle; host-neutral), ADR-0020
(no client-supplied path, no cached root games).

## Goals / Non-Goals

**Goals:**

- Paste an image from a browser clipboard, especially an iOS Safari
  screenshot, into the focused terminal as a path the shell can open.
- Keep the file on the server that owns the session, outside the project.
- Use one paste pipeline for the accessory Paste control, the native paste
  event, and the terminal context menu.
- Preserve today's text paste and all Desktop image-paste behaviour.

**Non-Goals:**

- Changing Electron's local clipboard materialisation.
- A general browser write to arbitrary server paths, including a client-chosen
  `/tmp` location.
- Pasting images into the file viewer, chat, or agent prompt.
- Cross-device clipboard sync. The phone clipboard is read locally and the
  bytes are uploaded.
- Guaranteeing `navigator.clipboard.read()` on every iOS version; the paste
  event is a required fallback, not a nice-to-have.

## Decisions

### 1. Server-owned scratch directory, not the project and not a client path

The server writes under `join(os.tmpdir(), 'terminay-clipboard')` with a name
it generates (`clipboard-<uuid>.<ext>`). On typical Unix that is
`/tmp/terminay-clipboard/`. The client sends bytes and a MIME type; it never
sends a destination path. The command returns the absolute server path, which
the existing paste path then inserts, shell-escaped, the same way Desktop and
drops already do.

This crosses the **server filesystem boundary**. It is a new, narrow write
that is not a project-catalog mutation. ADR-0011 stays in force for
`files.create` and friends.

Alternatives rejected:

- **`files.create` into the project root** (today's drop path). A screenshot
  would show up in `git status`. The user asked for `/tmp`.
- **Client-supplied absolute path.** Renderer-chosen paths are not authority
  (ADR-0011). A remote client writing `/etc/cron.d/...` is the failure mode.
- **Materialise in the browser and only paste a blob URL.** The PTY cannot
  open `blob:` or a phone-local file.

### 2. A dedicated binary command, not `files.create`

Add `terminal.materialize-clipboard-image` (name bikesheddable) as a
`commandWithBody` operation: JSON envelope `{ projectId, sessionId, mimeType }`
plus raw image bytes. Authorize it the same way browser file drop authorizes
`files.create` — authenticated transport, project of the focused terminal —
then ignore any path the client might try to smuggle. Cap the body at 8 MiB
(iOS screenshots routinely exceed the 4 MiB drop/`files.create` cap). Accept
`image/png`, `image/jpeg`, `image/webp`, `image/gif`; map MIME to a safe
extension; reject anything else. Do not decode or re-encode; Desktop converts
to PNG because Electron's `nativeImage` already did. The server has no image
codec in this path and should not grow one.

This crosses the **application protocol boundary**. Binary upload already
exists for dictation and extension packages; reuse that envelope rather than
base64 in JSON.

### 3. Read the clipboard inside the gesture; keep the paste event as a peer

Preference, matching Desktop: non-empty text wins; otherwise the first image.

On the accessory Paste click and the context-menu paste:

1. Call `navigator.clipboard.read()` synchronously from the click handler
   (no Desktop-bridge await first — same Safari rule as `writeClipboardText`).
2. Walk `ClipboardItem` types for an accepted image MIME, else `text/plain`.
3. If `read()` is missing, throws `NotAllowedError`, or returns neither, stop
   without inserting a path. Do not fall through to a late `readText()` after
   the activation is spent.

On a trusted `paste` event targeting the terminal, including long-press Paste
on iOS: take `clipboardData.files` / `items` of image type first, else
`text/plain`. Today the panel's capture listener bails unless Desktop owns
the clipboard so xterm can consume the event; browser image paste must claim
that event when it contains an image, `preventDefault`, and run the upload.

WebKit's documented iOS behaviour for a Paste **button** is a one-item paste
callout; the user taps Paste and `read()` resolves. The long-press path does
not depend on that API.

This crosses the **browser clipboard permission boundary** (ADR-0005). Reads
stay exact-origin and user-initiated. They are not elevated through the
Desktop host. Framed session hosts already delegate `clipboard-read`; same-
origin local UI does not disable clipboard in `Permissions-Policy`.

### 4. Insert the path through the existing terminal input queue

Once the server returns a path, reuse `pasteTerminalText` / the panel input
queue so bracketed paste, chunking, and the presentation lease still apply.
The upload is not itself a PTY write. A failed upload writes the same class of
inline error the browser drop path already uses; a denied clipboard read is
silent and refocuses, like today's text-paste failure.

## Risks / Trade-offs

- [iOS `clipboard.read()` of images is unreliable] → Treat the paste event as
  a required peer, not a fallback of last resort. The accessory button still
  tries `read()` so a successful callout works in one tap.
- [Safari spends user activation on any prior await] → The image read is the
  first clipboard call in the click handler, mirroring `writeClipboardText`.
- [Scratch files accumulate under `/tmp`] → Unique names, 8 MiB cap, no
  reaper in this change. The OS tmp cleaner is the retention policy, same as
  Desktop's `terminay-clipboard` files. A later change can add a bounded
  reaper if operators want one.
- [Remote session writes the **server** `/tmp`, not the phone] → That is the
  point: the path has to be valid in the PTY. Call it out in failure copy if
  the upload itself fails.
- [8 MiB vs 4 MiB drop limit] → Screenshots need the extra headroom; this
  command does not relax `files.create`.
- [Docker E2E cannot drive the iOS paste callout] → Prove preference order,
  size/type rejection, and Chromium paste-event upload in unit/Playwright.
  Real-device iOS remains a manual check.

## Migration Plan

No migration. New command, new client branch, existing Desktop path untouched.
A server that does not yet advertise the command leaves browser paste on
text-only; the client detects that the same way it detects a missing binary
upload transport.

## Open Questions

- None that block implementation. A durable ADR is warranted for the
  server-owned clipboard scratch directory, because it is a filesystem write
  outside the project root that future paste/media features will reuse. It
  complements ADR-0011 rather than superseding it.
