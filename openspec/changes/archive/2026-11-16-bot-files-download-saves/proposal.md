## Why

In Terminay Desktop, choosing Download on a file or folder in a bot's Environment › Files does nothing: no save dialog opens and no file appears on disk (issue #593, "Can't download files in the bot files tab"). The view reads the bytes from the bot's Files helper, then clicks a `blob:` anchor with a `download` attribute. Desktop denies every browser-initiated download in its sessions (`will-download` is cancelled by design, ADR-0005), so the anchor is silently dropped and the view still reports success. The browser host works; only Desktop is broken.

## What Changes

- Add a streamed host save to the Desktop host bridge. The renderer asks the host to open a save for a suggested name; the host shows a native save dialog, receives the bytes in chunks of at most 1 MiB, writes them to a temporary file beside the chosen destination, and moves it into place only when the renderer finishes. Cancelling writes nothing. A failed or abandoned save leaves nothing new behind and leaves an existing file it would have replaced untouched. Errors never reveal a path.
- Saves belong to the document that opened them and end when it reloads, switches server, or closes, or after a period without activity.
- The workspace UI gains one `saveDownload` helper: the host save when a host bridge exists, the browser's own download flow otherwise.
- Environment › Files downloads through that helper: a file under its own name, a folder as `<name>.tar`. In Desktop the user picks the destination before the transfer starts and the bytes stream from the Files helper instead of being buffered whole. Download failures show in the view.
- Desktop's denial of browser-initiated downloads stays.
- Row markup and row action UI are not redesigned here (issue #592 owns that); only the download handler and save path change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: a new Files downloads requirement states how Download saves a file or a folder, in Desktop and in a browser, and that failures are visible.
- `connections-and-client-hosts`: a new requirement for host-mediated file saves — destination chosen only in a native save dialog, bounded chunks and resources, whole-or-nothing writes, path-free errors, and saves owned by the document that opened them.

## Impact

- `packages/protocol/src/host.ts`: host actions `file.save.open`, `file.save.write`, `file.save.close` under `osIntegration`, strictly parsed and bounded.
- `electron/hostFileSaves.ts` (new): the save registry and state machine. `electron/serverUiHost.ts`: one registry per server UI binding, handling the three actions and released with the binding's lifecycle.
- `src/host/nativeActions.ts`: the `saveDownload` helper.
- `src/workspace/bots/BotFilesView.tsx`: the `download` handler and `save` function only.
- Tests: protocol parsing, the registry against a real temporary directory, the renderer helper, and an Electron e2e that saves through the real bridge.
