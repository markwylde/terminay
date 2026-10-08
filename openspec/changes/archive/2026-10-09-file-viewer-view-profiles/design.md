## Context

The server publishes a bounded capability snapshot per file (`previewKind`,
`preferredMode`, `isBinary`, `safePreview`, `canEditText`, `canEditHex`).
`detectFileCapabilities` in the client turns that into a default view and a
`fallbackMode`. Two things there produce HEX for text:

- `fallbackMode` is `canEditHex ? 'hex' : defaultMode`. HEX is available for
  every regular file, so any unavailable view — in practice Diff, requested by
  the Git pane for a file with no diff — resolves to HEX.
- The catalog classifies valid UTF-8 with no recognised extension as
  `previewKind: 'unsupported'` and maps that to `preferredMode: 'hex'`, although
  the same snapshot says `canEditText: true`.

The switcher always renders Preview, Text, HEX, Diff and disables what is
unavailable. `FileStatusBar` renders path, size, engine, and "Synced" inside
the panel while the window status bar below it keeps describing the last
focused terminal.

Decisions settled with the owner before implementation are recorded in
`questionnaires/view-defaults.yaml`: Text is the default for source and text
files; relevant views are tabs and the rest sit under a menu; Diff stays
visible but disabled, with a reason, when there is nothing to compare.

In-force ADRs that constrain this: ADR-0011 (the renderer is untrusted and
infers no authority), ADR-0018 (hosts are protocol-blind; the workspace bundle
owns presentation), ADR-0020 (per-operation canonical roots), ADR-0028 (no
polling).

## Goals / Non-Goals

**Goals:**

- No text file opens in HEX unless the user asks for HEX.
- The switcher offers what is useful for the file's type and nothing that
  cannot work.
- Panel chrome that reads as part of Terminay; Text and Preview look like the
  same file.
- File size and unsaved state in the window status bar; no status bar in the
  panel.

**Non-Goals:**

- Per-view preferences remembered per file or per type beyond the existing
  custom-extension setting.
- Changing how Diff is generated, or making Diff available for files in a
  worktree other than the project root.
- Restyling the HEX grid, the Diff viewer, or the Documentation editor.
- A new protocol field. The profile is derived from the existing snapshot.

## Decisions

**The server names the preferred view from its classification; the client
derives the tab set from the same snapshot.** `preferredMode` becomes: binary
data → Preview when it is a safe image or PDF, otherwise HEX; Markdown →
Preview when safe; all other text → Text. This crosses no boundary: the server
still owns classification (file-viewer "Published capability detection"), the
client still infers nothing from the filename when a snapshot is present.
Alternative considered: a new `views` array in the snapshot. Rejected — it is a
protocol change for something fully determined by fields already published,
and older servers would need a client-side derivation anyway.

**Fallback is the default view.** `fallbackMode = defaultMode`. A requested
view that cannot be shown should degrade to how the file would have opened, so
"open the diff" on a file with no diff shows the file. HEX remains the default,
and so the fallback, only for binary data with no safe preview.

**Primary and secondary views.** For text: Text, Preview (when safe), Diff as
tabs; HEX in the menu. For Markdown: Preview, Tasks, Text, Diff; HEX in the
menu. For a previewable binary: Preview, HEX. For other binary data: HEX. A
view selected from the menu is drawn as a tab while it is selected, so the
active view is always visible in the row. Alternative considered: always four
tabs, reordered — rejected by the owner; a permanently disabled Text tab on an
image is noise.

**Diff is the one view shown disabled.** Whether a diff exists is a fact about
the working tree, not about the file's type, and it changes as the user edits.
Hiding and showing the tab would move the others around; a disabled tab with
its reason in the tooltip, plus an inline notice when Diff was the requested
view, satisfies "explain why a requested mode is unavailable".

**Status lives in the window status bar, fed from panel parameters.** The file
panel already writes `fileInfo`, `isDirty`, and `isFocused` to its Dockview
parameters. `useFocusedFileStatus` reads the active panel's parameters on
Dockview's own events and `onDidParametersChange` — no timer, no new request
(ADR-0028). When the active panel is a file, its summary replaces the focused
terminal's; otherwise behaviour is unchanged. The project/window and
terminal-session boundaries are untouched: only the active project renders
into the slot, as it does today.

**The engine name is not displayed.** "Monaco" and "Performant" are
implementation names. The large-file chooser still asks, and the Performant
viewer keeps its own "switch to Monaco" control; the panel exposes
`data-engine` and `data-dirty` for tests.

**One appearance for Preview and Text.** The Monaco theme takes the panel
surface colour and the Preview token palette, and the editor takes Preview's
font family, size, and line height. Alternative considered: restyling Preview
to Monaco's defaults — rejected, Preview is the surface the owner is happy
with.

## Risks / Trade-offs

- **Opening in an editor makes accidental edits easier than opening in a
  read-only Preview.** → Nothing is written until save, the tab and the status
  bar show unsaved state, and the custom-extension setting can still pin
  Preview for an extension.
- **HEX is one click further for text files.** → Intended; it stays reachable
  from every text file through the menu.
- **The status bar can be hidden, and is off by default in compact chrome.**
  → Unsaved state is also on the dock tab; file size is then not shown, the
  same as every other status-bar fact in that layout.
- **Tests keyed on "Synced".** → Replaced by `data-dirty` on the panel root.

## Migration Plan

Presentation and classification only; no persisted state or protocol version
changes. An older server that still prefers Preview for text is honoured — the
file opens in Preview with the new tab set. Rollback is reverting the change.

## Open Questions

- A changed file in a secondary worktree, opened from the Git pane, reports no
  diff. This change makes that land in Text instead of HEX; why the diff is
  unavailable there is a separate defect.
