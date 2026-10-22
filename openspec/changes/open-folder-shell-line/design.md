## Context

`RootFolderBrowser` (`src/workspace/RootFolderBrowser.tsx`) holds two independent sources of truth:

- `RootFolderNavigator` lists the "current folder". This drives the read-only `__current` line, the entry list, the parent button and **Open this folder**.
- `RootFolderCompleter` lists the parent of whatever is typed and shows an 8-item suggestion dropdown under the field. Tab and Enter accept a suggestion, and the field only becomes the current folder after **Go**.

The duplicate path comes from these two models. The fix is one model: the field is the state, and everything else is derived from it.

The behaviour to build is concept 1, "Shell line", from the approved prototype (`https://claude.ai/artifact/4tvS2okgFJS8cafiHr2f9X`). Its engine (`createCore`) was exercised against a mock filesystem and is the reference for the semantics below.

Constraints:

- **ADR-0066.** Folders come only from the server's directory-names-only browse query, with root-change authority. The canonical path is revalidated when it is submitted as a root.
- **ADR-0053.** The dialog stays inside the in-page window frame in every host.
- Listing is asynchronous and can be slow over a remote or phone connection. The server already expands `~`, sorts entries and caps them at `MAX_BROWSE_ROOT_FOLDER_ENTRIES` (1000) with a `truncated` flag. It returns hidden directories, and does not filter by prefix.
- Paths may be POSIX or Windows (`C:\…`); `splitTypedFolderPath` already handles both separators.

## Goals / Non-Goals

**Goals:**

- One editable path field as the only place the path appears, with live filtering, zsh-style Tab, fish-style ghost text, and the key map in the spec.
- Pure, unit-tested completion logic, kept separate from React and from transport.
- The same visual language as the prototype, built from the app's existing in-page-window and project-edit styles.

**Non-Goals:**

- Fuzzy matching, recents inside the dialog (the chooser already shows recents), column or breadcrumb views.
- Any change to the browse query, its limits or its authority. Listing files is out of scope.
- Showing hidden folders without typing `.`, or adding a preference for it.

## Decisions

### 1. The field is the only state; the listing is derived

The component keeps `value` (the field text), `highlight` (index or -1), `cycle` (`{ base, items, index, original, segment } | null`), and `message`. `splitTypedFolderPath(value)` gives `{ parent, segment }`. The listing is `entries(parent)` filtered by `segment`. The folder shown in the meta line and the open target are derived on each render.

`RootFolderNavigator` and the separate current-folder concept are removed. The `RootFolderCompleter` request/latest-wins pattern is kept and widened so that it caches every parent it has listed, using an LRU of about 16 entries. This lets Backspace, ⌘↑ and cycling back to a seen folder render immediately. It also no longer truncates to 8: it returns all filtered entries, and the list scrolls.

*Alternative:* keep the navigator for the "current folder" and the completer for typing. This was rejected because two models are the bug.

### 2. Completion is a pure module

`rootFolderCompletion.ts` exports pure functions over `(value, listing | undefined)`:

- `visibleEntries(entries, segment)`: prefix match ignoring case, hiding names that start with `.` unless the segment does.
- `longestCommonPrefix(names)`: compares ignoring case and keeps the first match's casing.
- `tabStep(state, listing, backwards)` returns the next `{ value, cycle, message }`. The order is: an active cycle advances; otherwise a highlighted entry is accepted; otherwise a single match is completed; otherwise the field extends to the longest common prefix; otherwise a cycle starts.
- `ghostText(state, listing)`.
- `openTarget(state, listing)`: the highlighted entry, else the field's own folder if the field ends in a separator or names a listed child exactly, else the only partial match, else `null`.
- `deleteSegment(value)` and `parentValue(value)`, which keep the user's `~` or absolute style and both separator kinds.

These mirror `createCore` in the prototype, so unit tests can use the prototype's mock tree as fixtures.

### 3. Tab before the listing lands

Typing stays debounced (150 ms). Tab, ↑/↓, → and Enter flush the pending request immediately. If the listing for the current parent is not cached yet, the key is recorded as pending against the current `value`. When that listing lands, the key is applied only if `value` has not changed. Tab therefore never moves focus and never acts on a stale folder.

### 4. Enter revalidates through the server before choosing

Enter, double-click and the primary button resolve `openTarget`, then call `browse(target)` and choose the result's canonical `path`. A refusal or error goes into `message`. This keeps ADR-0066's rule that a client path is never trusted, and gives `onChoose` the canonical path. The submitted root is still validated again by `setRoot`.

### 5. Key map and focus

All keys are handled on the input's `keydown`. Tab, Shift+Tab, ↑, ↓, Enter, Esc, the segment-delete chords and the parent chord call `preventDefault`. → calls it only when it actually accepted something.

Pointer events on rows use `onPointerDown` with `preventDefault`, so the input never blurs. The row list is a `role="listbox"`, and the field is a `role="combobox"` with `aria-activedescendant`.

Platform chords come from `navigator.platform`, as the settings and terminal code read it: ⌥⌫, ⌃W and ⌘↑ on macOS; Ctrl+Backspace and Alt+↑ elsewhere. Ctrl+W is not taken off macOS because it is the app's `close-active` shortcut (`CmdOrCtrl+W`), which wins before the field sees the key.

Esc is handled by the field and not by `InPageWindow`. It calls `stopPropagation` only when it undid something, so the window's own Esc-to-close still works when there is nothing to undo.

### 6. Ghost text is an overlay

An absolutely positioned, `aria-hidden` mirror sits behind a transparent-background input. It uses the same font and padding and renders the field text invisibly, followed by the ghost text. It is hidden when the caret is not at the end, when the field is not focused, or when the text overflows the field's width. This avoids measuring text and works with IME composition: the ghost is hidden while `isComposing`.

### 7. Truncated listings

When `truncated` is set and the typed segment filters to nothing, the meta line says the folder holds more folders than can be listed and that typing the full name still works. Enter on a typed path that is not in the listing still calls `browse(path)` (Decision 4), so unlisted folders can still be opened.

### Boundaries

No decision crosses a security boundary. The dialog stays in the renderer and gets folders only through `browse` (the existing protocol query under root-change authority). Choosing still goes through the existing set-root path, which revalidates it on the server. No new IPC, preload or MCP surface is added.

## Risks / Trade-offs

- [Hidden folders sort first and could fill the 1000-entry cap in a dot-heavy home] → Rare in practice. The truncation message covers it, and typing a full name always works through Enter.
- [Slow remote listings make Tab feel late] → The parent cache and the pending-key replay (Decision 3) keep the field correct. A tiny spinner glyph sits in the meta line while a listing is in flight.
- [⌥⌫ overrides the native word-delete inside the field] → This is intended: path segments are the "words" here. Plain Backspace is unchanged.
- [E2E helpers rely on the **Go** button and the current-folder hook] → They are updated in the same change. `browseToFolder` types the path with a trailing separator and asserts that the primary button names the folder.

## Migration Plan

UI only. The change ships in one PR, with nothing to migrate and no persisted state. Rollback is reverting the PR.

Archive order: `new-project-start-chooser` must be archived before this change, because this change modifies a requirement that change introduces.

## Open Questions

None. In-force ADRs 0053 and 0066 are unaffected.
