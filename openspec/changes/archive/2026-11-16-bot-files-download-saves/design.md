## Context

Environment › Files (`src/workspace/bots/BotFilesView.tsx`) downloads by collecting the whole file or folder tar from the bot's Files helper (`files.read` / `files.downloadFolder` in `@terminay/client-core`), wrapping it in a `Blob` and clicking a `blob:` anchor with `download`. That works in a browser host. In Desktop, the workspace bundle runs in a sandboxed server UI window whose session cancels every `will-download` (`electron/sessionSecurity.ts`, `electron/serverUiHost.ts`), as ADR-0005 and "Remote code containment in Electron" require. The anchor click is dropped without error, and the view reports success because `save()` returns synchronously.

Desktop already has two host-mediated saves, `preview.download` (≤ 16 MiB) and `import-export.bundle.save` (≤ 4 MiB). Both send the whole payload base64-encoded in one action and write through a temporary file beside the destination. Bot files can be much larger: uploads go up to 1 GiB and a folder tar is unbounded, so a single-payload action does not fit.

Desktop runs its own packaged workspace bundle for every connection (ADR-0047), so the renderer and host bridge always ship together; no version skew between them needs handling.

## Goals / Non-Goals

**Goals:**
- Download from Environment › Files saves a real file to a user-chosen destination in Desktop, for files and folders, including dotfiles and empty files.
- In Desktop, large downloads stream: neither the renderer nor the host holds the whole file, and no action carries more than 1 MiB.
- A Desktop save is whole or absent; an existing file is replaced only on success; cancelling writes nothing; failures are visible and path-free.
- Browser hosts keep the browser's own download flow (still buffered into a `Blob`; the browser owns destination and completion).

**Non-Goals:**
- Redesigning the row actions or adding a context menu (issue #592).
- Allowing browser-initiated downloads in Desktop sessions.
- Migrating `preview.download` or `import-export.bundle.save`.
- Progress percentages; the existing "Downloading <name>…" line stays.

## Decisions

### 1. A three-action streamed host save under `osIntegration`

- `file.save.open { filename }` → `{ canceled: true } | { canceled: false, token }`.
- `file.save.write { token, bytesBase64 }`, decoded size 1 byte to 1 MiB, checked exactly from the base64 length and padding.
- `file.save.close { token, commit }` → `{ saved: boolean }`.

The parser accepts any suggested name of 1–255 characters without `/`, `\`, NUL or control characters that is not `.` or `..`; leading dots are allowed. The renderer helper makes the suggestion safe first (replacing characters Windows forbids and truncating), so a source name is never a reason to refuse a download. The token is 32 base64url characters from `randomBytes(24)`.

*Boundary:* renderer → privileged Electron. The renderer supplies a name and bytes; the destination comes from the dialog and is never returned. Errors crossing back are fixed strings ("The file could not be saved.", "This save has ended."), because Electron forwards `Error.message` to the renderer and filesystem errors carry paths.

*Alternatives:* allowing `will-download` for `blob:` URLs reopens the surface ADR-0005 closes and hands destination choice to Chromium. Raising the single-payload limit puts gigabytes through one IPC message and the renderer heap.

### 2. A per-document registry with an explicit state machine

`electron/hostFileSaves.ts` exports `HostFileSaves`, constructed with injected `showSaveDialog`, filesystem functions, clock/timers and limits so it is testable against a real temporary directory without Electron.

Each save moves through `choosing → open → (committing | aborting) → ended`. Actions on one token never overlap: a save is marked busy for the duration of a write or close, and any other action on it meanwhile is refused (the helper always awaits), which bounds held buffers to one chunk per save. The open-save reservation is held from the dialog until the save is registered or has failed. `dispose()` marks the registry closed, ends every save (removing temporary files) and makes any dialog that later resolves discard its result. A save in `choosing` counts towards the limit of 4. Each write re-arms a 5-minute idle timer; expiry aborts. The temporary file is `.terminay-<uuid>.download` in the destination directory, created with `wx`; commit closes the handle and `rename`s over the destination, which is atomic on one filesystem, so an existing file is replaced only on success. Any failure ends the save and removes the temporary file.

The dialog uses `showOverwriteConfirmation` (Linux) — macOS and Windows confirm replacement natively — so replacing a file is always confirmed. A file created at the destination after the dialog is replaced on commit; the user chose that path.

### 3. The registry lives with the server UI binding

`electron/serverUiHost.ts` creates one `HostFileSaves` per `bindServerUiWindow` binding, with the dialog parented to that window, and registers `dispose` on the binding's `DesktopDocumentLifecycle`. That lifecycle is released on server switch, failed launch, window close and quit. A reload or a lost renderer keeps the binding, so a main-frame cross-document navigation (`did-start-navigation`) or `render-process-gone` swaps in a fresh registry and disposes the old one. Saves are therefore scoped to one document. The request-action IPC handler routes `file.save.*` to the binding's registry after the existing capability check, and never reaches `main.ts`'s `onHostAction`.

*Boundary:* preserves the project/window boundary — tokens resolve only in the binding that created them.

### 4. One renderer helper, `saveDownload`, with a browser fallback

`src/host/nativeActions.ts` gains `saveDownload({ filename, chunks: () => AsyncIterable<Uint8Array> })` returning `Promise<boolean>`. With a host bridge it opens the save first; on cancel it returns `false` without starting the source. Otherwise it reads the source, re-chunks to ≤ 1 MiB, awaits each write, then commits. If the source, a write or commit throws, it calls the iterator's `return()`, best-effort aborts (ignoring abort errors), and rethrows the original error. Without a bridge it collects the source into a `Blob` and clicks an anchor, returning `true`.

### 5. Minimal edits to `BotFilesView.tsx`

Only `save()` and the `download` handler change: `download` hands a factory for `files.read` / `files.downloadFolder` to `saveDownload` inside the existing `run(...)` progress/error wrapper. Row markup and the Download button are untouched, so the parallel #592 menu calls the same `download(entry)` and the two changes merge cleanly.

### 6. Verification through the real bridge

Besides unit tests, an Electron e2e (run with `npm run test:e2e`) stubs `dialog.showSaveDialog` in the main process to return a path in the test's temp directory, drives `file.save.*` from the real workspace renderer through `window.terminayHost.requestAction`, and checks the file on disk, a cancelled save, and refusal of a token after close. Driving a real bot's Files helper is out of reach of the e2e engine fixture; the view wiring is covered by typecheck and the helper's unit test.

## Risks / Trade-offs

- [The renderer never finishes a save] → the 5-minute idle timer and document release end it and remove the temporary file.
- [A crash of the main process mid-save] → a hidden `.download` file may remain beside the destination; nothing is ever left at the destination itself.
- [Base64 inflates IPC traffic by a third] → acceptable at 1 MiB chunks; matches the existing actions.
- [Browser downloads still buffer in memory] → unchanged from today; the browser owns that flow.

## Migration Plan

None. The change is additive; rollback removes the actions and restores the anchor.

## Open Questions

None.
