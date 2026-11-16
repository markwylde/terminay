## 1. Protocol

- [ ] 1.1 Add `file.save.open`, `file.save.write` and `file.save.close` to `TerminayHostAction` in `packages/protocol/src/host.ts`: suggested name 1–255 chars without separators, NUL or control characters and not `.`/`..` (leading dots allowed); 32-char base64url token; base64 with an exact decoded size of 1 byte to 1 MiB; boolean `commit`; capability `osIntegration`. Verified by new cases in `packages/protocol/test/host.test.mjs` accepting `.env` and valid chunks, and rejecting paths, `..`, oversized decoded chunks, bad tokens and extra keys.

## 2. Desktop host

- [ ] 2.1 Add `electron/hostFileSaves.ts`: `HostFileSaves` with injected dialog, filesystem and timers; per-token serialised state machine (`choosing → open → committing/aborting → ended`); `wx` temporary file beside the destination; atomic rename on commit; one pending write per save; at most 4 saves; 5-minute idle abort; `dispose()` that ends every save and discards dialogs that resolve later; generic, path-free errors. Verified by `electron/hostFileSaves.test.ts` against a real temporary directory: save whole, an empty file committed with no writes, cancel, abort, replace keeps original on failure, injected write and rename failures with path-free messages, unknown/ended token refusal, limit of 4, idle expiry, dispose during dialog.
- [ ] 2.2 In `electron/serverUiHost.ts`, create one registry per binding with the dialog parented to its window and `showOverwriteConfirmation`, dispose it on the binding's lifecycle release, and route `file.save.*` to it after the capability check. Verified by typecheck and the e2e in 4.1.

## 3. Workspace UI

- [ ] 3.1 Add `saveDownload({ filename, chunks })` to `src/host/nativeActions.ts` with safe name suggestion, open-before-read, ≤ 1 MiB awaited writes, commit, and on any failure iterator `return()`, best-effort abort and rethrow of the original error; browser `blob:` fallback. Verified by `src/host/saveDownload.test.ts` with a fake bridge: commit with re-chunking, cancel never starts the source, source error aborts and rethrows, write error aborts, abort error does not mask the original, and the browser fallback clicks an anchor.
- [ ] 3.2 Make `BotFilesView`'s `download` handler pass a `files.read` / `files.downloadFolder` factory to `saveDownload`, saving a folder as `<name>.tar`; leave row markup untouched. Verified by typecheck, lint and a diff showing only the handler and `save` changed.
- [ ] 3.3 Add the two new unit tests to the `smoke` script. Verified by `npm run smoke`'s node test list containing them.

## 4. Verification

- [ ] 4.1 Add an Electron e2e that stubs `dialog.showSaveDialog`, saves through `window.terminayHost.requestAction` from the workspace renderer, and checks the file on disk, a cancelled save, and a refused token after close. Verified by `npm run test:e2e -- <spec>` passing in Docker.
- [ ] 4.2 Run typecheck, lint, the protocol tests and the new unit tests (bounded with `--test-force-exit --test-timeout`). Verified by their passing output.
- [ ] 4.3 Run `openspec validate --all`. Verified by this change validating clean.
