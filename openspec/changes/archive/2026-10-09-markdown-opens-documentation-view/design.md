## Context

`openFile` in `src/App.tsx` owns one canonical Dockview panel per file path. Each panel has a `presentation` parameter (`file-viewer | documentation`) stored as server-owned workspace state. Only the Documentation tree and Documentation link events pass `presentation: 'documentation'`. Every other caller passes nothing and gets `file-viewer`: Explorer (`FileExplorerTree`), Folder tabs, drag-to-tab, and the `terminay-open-file` event (Markdown preview links, go-to-definition, Git changes, task cards). The Documentation presentation hides the File Viewer toolbar, so once a panel is in Documentation there is no way back to Text, HEX, Diff, or Tasks except reopening it from Explorer.

## Goals / Non-Goals

**Goals:**
- One rule, applied in one place, decides the default presentation from the file type, whichever caller opened the file.
- Opens that name a File Viewer mode keep working exactly as they do today.
- Users can move between the two presentations on the same panel without reopening it.

**Non-Goals:**
- A user setting to turn the default off. Add one only if users ask for it.
- Remembering a per-file presentation choice across panel closes.
- Any server, protocol, or persistence change.

## Decisions

**Resolve the default inside `openFile`, not at each caller.** When `options.presentation` and `options.initialMode` are both unset, a new panel gets `documentation` if the path matches `/\.mdx?$/i` and `file-viewer` otherwise. `initialMode` set with no presentation means `file-viewer`. Changing every caller was the alternative. It would scatter the rule across Explorer, Folder tabs, drag, and several event dispatchers, and any caller added later would reintroduce the bug. The predicate lives in a small pure helper, `resolveOpenPresentation(path, options, existing?)`, so it can be unit-tested.

**A request with no preference never flips an existing panel.** If a panel already exists and the request names neither presentation nor mode, `openFile` only focuses it. Otherwise, if someone chose View source and then clicked the file in Explorer, the panel would jump back to Documentation and undo their choice. A named presentation or mode still switches the panel, using the existing flush-before-leaving-Documentation path. That flush now also runs when leaving Documentation because `initialMode` is set, not only when `presentation: 'file-viewer'` is set.

**The toggle is a panel parameter update, not a reopen.** View source (Documentation toolbar) and Open as document (File Viewer toolbar, Markdown and MDX only) call `api.updateParameters({ presentation })` on the same panel. View source first awaits the registered documentation save handler and aborts if it throws, just as `openFile` does. The file session and draft stay put because the panel id and `filePath` do not change. Opening a second panel was rejected because it would break the canonical-identity requirement.

**Boundary.** Nothing here crosses a privileged boundary. Presentation is renderer-side UI state that the server persists as an opaque panel parameter. File authority, path validation, and session ownership stay server-side and unchanged.

## Risks / Trade-offs

- [Users who relied on Explorer opening raw Markdown] → View source is one click away. Git Diff and go-to-definition still land in the File Viewer.
- [The Documentation editor normalizes content that users expect to stay byte-exact] → The existing "reading a document never rewrites it" and lossless-source requirements already cover this. Opening a file is not a write.
- [Very large Markdown files may be slow in the rich editor] → The Documentation surface already has its own bounds and failure states. This change does not widen them, and View source provides the performant engine.
- [Source-matching unit tests (`openFilePresentation.test.ts`) assert the old literal shapes] → Update them together with the helper and test the helper directly.

## Migration Plan

Behaviour-only renderer change, shipped in a normal release. Panels already saved with `presentation: 'file-viewer'` keep it, because a request with no preference never flips an existing panel. Rollback is a revert.

## Open Questions

None. No in-force ADR is affected.
