## Context

The Macros window (`src/components/MacrosWindow.tsx`, 1,018 lines) edits a macro as a list of step rows inside the shared settings shell. The server owns macro state (`packages/server-core/src/macroService/`): a revisioned list of `MacroDefinition`, each an ordered `MacroStep[]` plus fields. The client mirrors the types in `packages/client-core/src/macros.ts` and saves with a `replace` command.

A working prototype of the redesign exists and was reviewed by the product owner: `https://claude.ai/artifact/Be2shYjDcf8uQZkRXAMv3F`. It is a static page with example macros. It settles the interaction, not the implementation.

What the code shows about secrets today:

- The `secret` step exists in the server, client-core, and renderer step unions.
- On a server, `ServerRuntime.createMacroSecretResolver` hands the runner `vault.withSecret(secretId, …)` for whatever id the macro step names. The macro definition is renderer-authored content, so a macro can ask for any vault entry by id and have it written to a PTY.
- On Desktop, `electron/main.ts` keeps user-entered macro secrets in `secrets.json` under the application data directory, encrypted with `safeStorage`, behind four `secrets:*` IPC handlers. No preload exposes those channels any more. The only `MacroSettingsClient` secret methods that exist are the browser adapter's, which throw "unavailable". The Secrets Manager in the window therefore cannot save a secret on any current host.
- `normalizeStep` throws `invalid_macro` for an unknown step type, so taking `secret` out of the union without further work would make a stored library that contains one fail to load.

In-force ADRs that constrain this design: ADR-0003 (server secrets live in a vault read through privileged server callbacks), ADR-0011 (the renderer is untrusted at every privileged boundary), ADR-0047 (a window is bound to one server), and ADR-0053 (in-page windows share one modal frame). ADR-0023 (server-owned clipboard scratch) is the reason the `paste` step is rejected and is not revisited.

Decisions already made by the product owner, not open here: one script editor with no Prompt/Sequence modes and no end-of-macro switches; explicit user-managed categories; no server selector; secrets removed entirely; existing `secrets.json` left on disk; a macro with a secret step fails to run as invalid rather than having the step dropped; the Command Bar groups macros by category; all of it in one change.

## Goals / Non-Goals

**Goals:**

- A macro that is only a prompt is created by naming it, typing, and saving.
- Multi-step macros are edited in the same place, with step order visible as document order.
- The user can see what a macro will ask and type before running it.
- Macros can be organised and found: categories, filter, drag.
- No path remains by which a macro reads the vault or writes a secret to a PTY.
- Saved macros keep working without conversion, except those that hold a secret step.

**Non-Goals:**

- Changing how macros run: the queue, cancellation, limits, just-in-time rendering, the launching-client policy, and the data-only Eta subset are untouched.
- A new stored format for macro steps. The script is a view of `MacroStep[]`.
- Any change to the vault or to its other users (AI credentials, extension secrets, connected MCP servers, dictation).
- A replacement for secrets. Keeping a credential away from an agent is a different feature and is not designed here.
- Enabling the `paste` step.
- Nested categories, per-category settings, or sharing categories across servers.
- Deleting or migrating `secrets.json`.

## Decisions

### 1. The script is a projection of `MacroStep[]`, not a new format

The editor holds a list of blocks: text blocks and token blocks. Saving maps blocks to steps; loading maps steps to blocks.

- Text block → one `type` step. An empty text block produces no step.
- Token → one `key`, `wait_time`, `wait_inactivity`, or `select_line` step, or the preserved unsupported step.
- Loading: consecutive `type` steps become one text block, concatenated with nothing between them, which types the same bytes. A text block always exists at the start, at the end, and between two tokens, so the cursor has somewhere to go; empty ones between tokens are drawn collapsed.
- A token occupies its own line in the editor. That line break is presentation only: it is not part of the text before or after it. Newlines inside a text block are part of the typed text.
- When the user removes a token, the text before and after it are joined with a newline, because they were on separate lines on screen.

*Why not a script grammar stored as text* (for example `[[enter]]` markers in one string)? It would need a parser and an escape rule on the server, a migration of every saved macro, and a second representation that the runner, the protocol tests, and client-core would all have to learn. The projection needs none of that and round-trips exactly.

*Why no end-of-macro switches* (the prototype briefly had "Press Enter" and "Wait until quiet first")? They were a second way to state what a token already states. The compatibility field `submitMode` remains derived from the step list by normalisation, as it is today.

The mapping lives in one pure module (`src/macroScript.ts`) with unit tests for round-trips. No boundary is crossed: this is renderer-side presentation of data the server still normalises.

### 2. The editor is plain textareas with a highlight underlay, not Monaco

Each text block is an auto-sizing `<textarea>` over a `<pre>` that renders the same text with placeholders and Eta tags marked. Tokens are ordinary React elements between them. The `/` menu is positioned from a marker in the underlay.

*Alternatives:* Monaco with inline widgets or decorations for tokens; a `contenteditable` document. Monaco makes atomic, focusable, form-bearing tokens hard, and its screen-reader mode does not expose embedded controls well. `contenteditable` gives up native undo, selection, and IME behaviour. Textareas keep all three, and the tokens are real form controls with real labels.

Cost accepted: highlighting inside Eta tags drops from the Monaco tokenizer's keyword, string, and number colours to marking the tag as a whole. The spec delta states the reduced contract. Undo is per text block; structural edits (insert or remove a token) are not on the native undo stack, so Discard is the recovery path. The Macros window no longer loads Monaco.

Keyboard contract: Arrow Up at the start of a text block and Arrow Down at its end move to the neighbouring text block; Tab reaches each token's control; Backspace at the start of a text block removes the token before it; the slash menu follows the WAI-ARIA listbox pattern with `aria-activedescendant`.

### 3. The slash menu only claims a line while it matches a step

Users write lines that begin with `/` on purpose: `/opsx:apply`, `/clear`. The menu opens only when `/` is the first character of a line and the cursor is at the end of that line, filters by word-prefix on step names, and closes the moment nothing matches or on Escape, leaving the text alone. Enter confirms only while the menu is open.

Residual risk: a literal line that is a prefix of a step word (`/wait`, `/press`, `/select`) keeps the menu open, and Enter would insert a token. Escape before Enter keeps the text. The insert controls beside the editor mean nobody has to use `/` at all.

### 4. Categories are names in macro state

`MacroState` gains `categories: readonly string[]` and `MacroDefinition` gains `category: string` (empty for none). `MACRO_SCHEMA_VERSION` becomes 2.

- Names are trimmed, 1–64 characters, free of control characters, unique ignoring case, at most 64 categories. Normalisation drops invalid or duplicate names and clears a macro's `category` when it is not in the list.
- `replace` gains an optional `categories`. Absent means "keep what you have", so a client that predates this change cannot wipe categories. `upsert` and `remove` do not touch the list. `reset` restores the default macros and an empty list.
- A rename is the client sending the new list and the macros with the new name in one `replace`; the server needs no rename command.

*Alternative:* categories as entities with ids. Ids make rename a one-field change and survive name collisions, but need their own commands, their own conflict rules, and id plumbing through client-core and the Command Bar. With a single window-level save sending the whole state, names are enough.

*Alternative:* derive groups from the `prefix:` in macro names, as the first mock did. Rejected by the product owner: it gives no way to create or assign a category.

Reading schema version 1 state: categories start empty and every macro has none, with one exception made for existing libraries. When version 1 state is first normalised, a `prefix:` shared by two or more macro names becomes a category holding those macros. This runs once, on the server, at the version step, and is an assumption of this design rather than something the product owner asked for; it is easy to delete if unwanted.

Boundary: macro state is server-owned and revisioned. Categories ride the existing macro command path and its `expectedRevision` check; they add no new authority.

### 5. A step the server does not execute is preserved and blocks the run

`normalizeStep` stops throwing for an unrecognised type. It returns `{ id, type: 'unsupported', sourceType }`, with `sourceType` bounded to 32 characters and no other field carried over, so a stored `secretId` is not kept. `secret` is removed from every step union and becomes one such unrecognised type.

`MacroRunner` checks the whole step list before the first write and rejects with `invalid_macro` if any step is `unsupported`. This is the authority: the server decides, before any PTY write, on the exact target it has already authorised. The renderer also refuses to launch such a macro and says why, but that is a courtesy; a stale or hostile client gets the same answer from the server.

`paste` keeps its own rule and its own error, per ADR-0023.

*Alternative:* drop secret steps on load. Rejected by the product owner. A macro that typed `sudo …`, pasted a password, and pressed Enter would silently become one that types `sudo …` and presses Enter on an empty password prompt.

*Alternative:* refuse to load or save a library containing one. That turns one stale step into a window that will not open.

### 6. Secrets are removed at every layer, and the vault path from macros is closed

Removed: the `secret` step type; `MacroRunEnvironment.resolveSecret`; `ServerRuntime.createMacroSecretResolver` and its callers in both server compositions; the four `secrets:*` IPC handlers, `readSecrets`, `writeSecrets`, `getSecretsPath`, and the macro `resolveSecret` hook in `electron/main.ts`; `getSecrets`, `getDecryptedSecret`, `saveSecret`, `deleteSecret` on `MacroSettingsClient` and the browser adapter; `SecretDefinition`; the Secrets Manager component and its styles; the `getDecryptedSecret` option and `secret` branch in `useMacroRunController`.

Boundary: this closes a crossing of the vault boundary (ADR-0003). Before, renderer-authored macro content chose a vault id and the server wrote that entry to a PTY, where the program on the other side, often an agent, received it. After, nothing a macro contains causes a vault read. ADR-0057 records the rule so that a later change does not reintroduce it in another form.

`secrets.json` is left where it is, as decided. After this change no code path opens it. `DICTATION_OPENAI_SECRET_ID` stays if anything outside the removed handlers still references it; the task that deletes the handlers checks.

### 7. The preview renders in the client and is not authoritative

The preview uses the renderer's existing `renderMacroTemplate` and `renderMacroDurationMs` (`src/macroSettings.ts`) with the values in the preview form. It shows `type` steps rendered, and other steps as descriptions. It calls nothing on the server and writes to no terminal.

The server still renders each `type` step just in time under the data-only Eta subset. Where the client renderer and the server disagree, the server wins and the preview is wrong; the existing shared test vectors for template rendering are extended to cover the preview's inputs so that drift fails a test.

A template that the client renderer cannot render is shown in the preview as its raw text with a short notice, never as an exception.

### 8. One pending change set, saved with one `replace`

The window keeps a draft of all macros and the category list and the last saved copy. Dirty state is the difference between them, per macro for the library markers and overall for the save bar. Save sends one `replace` with `expectedRevision`. A stale revision, an invalid select input, or any server rejection leaves the draft in place and shows the reason in the save bar.

When the server broadcasts a newer macro state while the draft is dirty, the window keeps the draft and the next save is rejected as stale; the bar then offers Discard to pick up the server's state. That is today's behaviour made visible. Merging is not attempted.

Delete is a two-step control inside the window, since the in-page frame has no native `confirm`. "Reset all" moves into an overflow menu with the same two-step confirmation.

### 9. File fields reuse the terminal's drop resolution

`src/components/terminalDropInteraction.ts` already turns a drag into a path: Terminay's own `terminay/path` data, a portable path in `text/plain`, or a host-resolved path for a dropped `File` (Desktop's `webUtils.getPathForFile` through the server-UI preload). The file field calls the same resolution without the shell escaping, since the value is a field value, not terminal input. Paste handles `clipboardData.files` the same way and converts a `file:` URL to a path. Typing is unchanged.

Boundary: no file is read and no filesystem authority is added. The host-resolved path is a client-machine path. "Macro writes follow the terminal's server" already says a path is never read from a filesystem other than the terminal's server; a client path typed into a terminal on a remote server is simply a wrong path there, exactly as when a file is dropped on that terminal. A browser host cannot resolve a path for a dropped file and the field says so.

The existing server-side file search on the field stays.

### 10. Layout

Three regions inside the existing in-page window frame (ADR-0053) and settings shell: library, editor, preview. Below roughly 1,100 px of window width the preview moves under the editor; in the narrow layout the library and editor remain the existing two-step route. All colour, type, radius, and control styles come from the tokens and classes already in `src/settings.css`.

Reordering by drag needs a keyboard path. The library keeps the existing Alt+Arrow reordering, and the editor's category control is the keyboard way to move a macro between categories.

### 11. Command Bar grouping

A macro's Command Bar group becomes its category name; uncategorised macros keep the group "Macros". Macro groups are ordered by the category list and placed where the single Macros group is today, before places. Group identity for macro groups is namespaced internally so a category named "Commands" or "Projects" cannot merge with a built-in group.

## Risks / Trade-offs

- **A macro that relied on a secret step stops working** → It fails loudly as invalid, names itself, and the editor shows the unsupported token to remove. The proposal marks this breaking.
- **`secrets.json` stays on disk holding encrypted values nothing can use** → Chosen by the product owner. The removed-requirement migration note tells the user where it is and that it can be deleted by hand.
- **Slash menu swallows an intended literal** → Decision 3; Escape and the insert controls.
- **Client preview drifts from server rendering** → Shared test vectors; the preview is labelled as a preview and never drives a write.
- **Reduced Eta highlighting** → Accepted in Decision 2 and stated in the spec delta.
- **No structural undo** → Discard restores the last save; unsaved markers show what would be lost.
- **Mixed client and server versions** → An older client's `replace` omits `categories` and the server keeps them. A newer client against an older server sends `categories` and `category`; the task for the protocol confirms the older normaliser ignores unknown fields rather than rejecting, and gates the category UI on the server's schema version if it does not.
- **Prefix-derived categories surprise a user** → It happens once and every result is editable; it can be dropped from the change without affecting anything else.
- **A large rewrite of one window** → The script mapping, category normalisation, and unsupported-step rule are pure and unit-tested first; the window is rebuilt on top of them; `e2e/macros.spec.ts` is rewritten against the new surface.

## Migration Plan

1. Server first: schema version 2, categories, unsupported-step normalisation and run rejection, secret resolver removed. A version 1 state file is read, normalised, and written back as version 2 on the first macro commit; the repository's existing `backup` hook keeps the version 1 copy.
2. Client core and renderer: types, script mapping, the new window, Command Bar grouping, file field.
3. Desktop main: delete the secrets handlers and helpers.
4. Rollback: an older build reads version 2 state through its own normaliser. Categories are lost on its first write. A macro with an `unsupported` step makes the older normaliser throw, so before rolling back, remove unsupported steps or restore the version 1 backup.

Apply after `one-window-one-server`, which removes the server-selector requirement this window no longer meets.

## Open Questions

- Whether to keep the one-time prefix-to-category derivation (Decision 4). It is in the tasks as its own item so it can be struck.
- No in-force ADR needs revisiting. ADR-0003 stands: the vault is unchanged, and this change removes one of its consumers.
