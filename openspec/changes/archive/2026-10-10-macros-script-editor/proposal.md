## Why

The Macros window is hard to navigate and hard to create a macro in. The library is a flat list of bare names with no search or grouping. A prompt, which is what most macros are, is squeezed into a one-line box, with the multi-line editor hidden behind a small icon. Steps are added through a dropdown that resets itself, inputs are five unlabelled boxes that need a manual "Sync from Steps", nothing shows what a macro will actually type, and "Save Changes" sits in one macro's header while saving every macro.

Macro secrets do not deliver what they promise. The intent was a place to keep credentials that an agent never sees. A secret step pastes the value into the terminal, where the agent in that terminal reads it like any other input. A feature that looks like protection and gives none is worse than no feature, so it goes.

Technically, the editor edits a list of step rows when a macro is better understood as one script; categories do not exist in macro state; and the secret path leaves a server-side resolver that can read a vault entry by id on behalf of a macro, plus dead Desktop IPC handlers and client methods that no host can reach.

## What Changes

- **Script editor.** A macro is edited as one document. Text is typed into the terminal as written. Key presses, waits, wait-until-quiet and select-line are tokens placed in the text, inserted by typing `/` at the start of a line or from a row of insert controls. Their order in the document is the order they run. There is no separate step list, no "Add Step" dropdown, no multi-line editor modal, and no submit setting: a final Enter is a key-press token like any other.
- **Inputs fill themselves.** Mentioning `{{name}}` in the script adds an input to a labelled table (name, label, type, default, required). "Sync from Steps" is removed. An input that is no longer mentioned stays, marked unused, until the user removes it.
- **Live preview.** A pane beside the editor shows the form the user will be asked and the text that will be typed, updating as the macro and the sample values change. It never writes to a terminal.
- **File inputs take a dropped file, a pasted file or path, or a typed path**, in the run form and in the preview.
- **Categories.** Macros are grouped into user-managed categories that the server owns: create, rename, remove, assign a macro from the editor or by dragging it, and reorder macros by dragging. The Macros window library and the Command Bar both group macros by category. The library also has a filter.
- **One save for the window.** A save bar states how many macros have unsaved changes, with Save and Discard. Unsaved macros are marked in the library.
- **BREAKING: macro secrets are removed.** The secret step, the Secrets Manager, the macro secret resolver on the server, the Desktop `secrets:*` IPC handlers, and the secret methods on the macro settings client all go. Nothing a macro does reads the vault.
- **BREAKING: a macro that contains a step Terminay does not execute cannot run.** A saved macro that still holds a secret step keeps loading and stays editable; the editor shows that step as unsupported and removable, and launching the macro fails as invalid before anything is written to the terminal. Steps are not silently dropped.
- Secrets already saved by Desktop in `secrets.json` are left on disk untouched. Nothing reads the file after this change.
- The Macros window has no server selector. It presents the macros of the window's server, as the `one-window-one-server` change already specifies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `macros`: the editor becomes a script editor; inputs are detected continuously; a live preview, file-input methods, categories, library filter, window-level save, and Command Bar category grouping are added; secret interpolation and the secret step are removed; a macro holding an unsupported step is preserved and never run.
- `settings-shortcuts-and-desktop-integration`: the server-authoritative macro settings requirement no longer covers secret actions or a host secret capability.
- `server-owned-workspace-state`: the secret exposure requirement no longer has macros resolving secret placeholders.

## Impact

- **Renderer**: `src/components/MacrosWindow.tsx` is rewritten; `src/shared/SharedMacroRouteBody.tsx`, `src/shared/SharedMacroLibraryPane.tsx`, `packages/shared-ui/src/components/MacroLibraryPanel.mjs` and `MacroEditorRoutePanel.mjs` change shape; `src/settings.css` gains the editor styles and loses the step-row and secrets styles; `src/workspace/CommandBar.tsx` groups macros by category; the run form's file field in `src/App.tsx` accepts drop and paste; `src/workspace/useMacroRunController.ts` loses its secret branch; `src/hooks/useMacroSettings.ts`, `src/web/browserRendererHostAdapters.ts` and `src/types/macros.ts` lose the secret surface.
- **Server**: `packages/server-core/src/macroService/` (types, normalize, repository, protocol, runner) gains categories and the unsupported-step rule and loses the secret step; `packages/server-core/src/runtime.ts` loses `createMacroSecretResolver`. Macro state moves to schema version 2.
- **Client core**: `packages/client-core/src/macros.ts` mirrors the state and step changes.
- **Desktop main**: `electron/main.ts` loses the `secrets:*` handlers, `readSecrets`/`writeSecrets`, and the macro `resolveSecret` hook.
- **Protocol**: the macro state and `replace` command carry categories. A client and server on different sides of this change must still interoperate: an older client's `replace` without categories keeps the server's categories.
- **Tests**: `e2e/macros.spec.ts`, the macro unit and protocol tests, `scripts/task14-settings-client-path.test.mjs`, `scripts/browser-app-capability-boundary.test.mjs`, and `packages/server-core/test/runtime.test.mjs` change.
- **Ordering**: this change assumes `one-window-one-server` is applied first, because that change removes the "Macros surface selects a server" requirement. This change does not touch that requirement.
- **Not affected**: the server vault and every other user of it (AI provider credentials, extension secrets, connected MCP server credentials, dictation), the macro run queue, the launching-client disconnect policy, and the data-only Eta template subset.
