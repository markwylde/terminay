## 1. Server-core panel state

- [x] 1.1 Add optional `note` and `metadataRevision` to `TerminalPanel` and to workspace state validation, with `note` bounded to 1200 characters and no NUL. Verified by a server-core unit test that stored state without the fields still loads and that an oversized note fails validation.
- [x] 1.2 Make the `panel.update` reducer advance `metadataRevision` only when `title` or `note` changes value, accept `note: null` to remove a note, and reject a patch containing `metadataRevision`. Verified by unit tests covering title change, note change, colour-only change (no advance), no-op title (no advance), note removal, and the rejected patch.
- [x] 1.3 Bound `note` for every `panel.update`, including those arriving through the workspace protocol. The protocol layer does not validate panel patches itself, so the bound lives in the reducer that every path commits through. Verified by a `workspace.command` test in `packages/server-core/test/terminal-panel-metadata.test.mjs` for a valid note, an oversized note, and a non-string note.

## 2. Shared AI target authority

- [x] 2.1 Add a workspace-backed AI target authority factory in `packages/server-core/src/aiService/` providing `getTarget` (real title, note, and `metadataRevision`), `authorize`, and `applyMetadata`, where `applyMetadata` checks the expected revision and issues `panel.update` in one `WorkspaceStore.apply` call. Verified by unit tests: title applied, note applied, stale revision yields `revision_conflict` with state unchanged, unknown or foreign-project target rejected.
- [x] 2.2 Cover the end-to-end `AiService.generate` sequence against the new authority with a fake provider: success mutates the panel and returns the new revision; a `panel.update` title edit issued while the provider is pending produces `revision_conflict` and keeps the manual title; a colour edit while pending does not conflict. Verified by those unit tests passing.

## 3. Standalone server

- [x] 3.1 Replace `standaloneAiTarget` in `apps/terminay-server/src/cli.ts` with the shared authority so `applyMetadata` is available. The standalone composition is built inside the CLI with real provider CLIs and has no injectable-provider harness, so this is verified in two parts: a protocol-level test that a client's `ai.metadata.generate` against the shared authority changes the canonical panel title (`terminal-panel-metadata.test.mjs`), and `scripts/ai-metadata-shared-authority.test.mjs` proving `cli.ts` composes that authority and no host-local resolver.

## 4. Embedded server

- [x] 4.1 Construct the embedded `AiService` whenever dictation or a metadata provider is configured, using the shared authority, and wrap `options.aiMetadata` as the `codex` / `claude-code` provider adapter. Verified by a `scripts/` Node test that generation with the mocked host provider mutates the canonical panel title and note.
- [x] 4.2 Register the server-core `ai.metadata.generate` operation and remove `generateAiMetadata`, `aiTargetState`, and the bespoke registration; keep model listing working. Verified by the existing `scripts/ai-metadata-test-seam.test.mjs`, `scripts/task15-renderer-ai-path.test.mjs`, and `scripts/task54-ai-dictation-authority.test.mjs` passing, updated where they assert the removed handler.
- [x] 4.3 Preserve the bounded provider failure message through the adapter. Verified by the existing e2e assertion that the error banner contains "Codex test failure".

## 5. Client-core

- [x] 5.1 Let `updatePanel` accept a bounded `note` (string or `null`) and expose the panel `note` on the workspace snapshot panel type. Verified by client-core unit tests for the accepted and rejected patches.

## 6. Renderer

- [x] 6.1 In `runAiTabMetadata`, stop writing the generated title and note to the panel; set and clear a transient `aiTitlePending` parameter instead of setting the title to "Generating...", and drop the `previousTitle` restore. Verified by `e2e/ai-tab-metadata.spec.ts` "keeps a generated title after the workspace reconciles with the server" passing.
- [x] 6.2 Render the pending state in `TerminalTab` in place of the title while `aiTitlePending` is set. Verified by an e2e assertion that the tab shows "Generating..." while the mocked provider is held and the canonical title afterwards.
- [x] 6.3 Surface `revision_conflict` as a clear, dismissible error. Verified by an e2e test that renames the tab while the mocked provider is held and asserts the manual title remains and a conflict message is shown.
- [x] 6.4 Apply `canonical.note` to `terminalNote` in `reconcileServerPanels`, skipping a note editor that has focus in this client. Verified by an e2e test that a generated note appears, and that typing in the note is not rewound by a reconcile.
- [x] 6.5 Send manual note edits through a debounced `workspaceStore.updatePanel({ note })`, flushing any pending edit before a note generation starts. Verified by an e2e test that a typed note survives a window reload.
- [x] 6.6 Adopt a client-local note upward once when the canonical note is absent. Verified by a unit test of the adoption decision (local note + absent canonical → one update; canonical present → no update).

## 7. Test seam and e2e coverage

- [x] 7.1 Extend the `TERMINAY_TEST` AI mock so a test can hold a generation pending and release it. Verified by `scripts/ai-metadata-test-seam.test.mjs` still proving the seam is inert outside `TERMINAY_TEST`, and by tasks 6.2 and 6.3 using it.
- [x] 7.2 Add an e2e test that a generated title and note are still shown after the window reloads. Verified by the test passing through `npm run test:e2e`.

## 8. Verification

- [x] 8.1 `npm run lint`, typecheck, the Node test suites, and `openspec validate --all` pass. Verified by command output.
- [x] 8.2 `npm run test:e2e -- e2e/ai-tab-metadata.spec.ts` passes in Docker, including the reproduction test. Verified by command output.
- [ ] 8.3 Open the pull request on `origin` (Gitea) and read back every commit status on the head SHA as `success` or `skipped`. Verified by the status list.
