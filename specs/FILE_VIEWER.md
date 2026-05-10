# File Viewer Specification

## Summary

Terminay opens files from the file explorer into dockable file tabs. File tabs live in the same Dockview workspace as terminal and folder tabs, support splits/popouts, and provide four viewing modes:

- Preview
- Text
- HEX
- Diff

The default mode is Preview.

This feature must work well for both normal files and very large files. For files larger than 100 MB, Terminay asks the user whether to open the file in `Performant` mode or `Monaco` mode anywhere Monaco would otherwise be used.

The implementation should favor reusable, well-scoped components and services over a single monolithic file panel.

## Goals

- Open files from the file explorer by double-clicking a file.
- Reuse the existing Dockview workspace and tab behavior.
- Provide rich editing and viewing for common file types.
- Support large files without freezing the UI.
- Keep clean files synced with disk changes.
- Preserve unsaved edits with clear dirty/conflict states.
- Use Monaco for normal text editing and built-in syntax highlighting.
- Use custom virtualized renderers where Monaco is not a good fit.

## Non-Goals

- This spec does not include a full file tree redesign.
- This spec does not include collaborative editing.
- This spec does not include language servers or IDE features beyond Monaco's built-in capabilities.
- This spec does not require editing inside Diff mode.
- This spec does not require remembering the large-file open choice between file opens.

## Product Decisions

### Opening Behavior

- Double-clicking a file in the file explorer opens a file tab.
- Double-clicking a directory continues to expand or collapse it.
- If the same file is already open, Terminay focuses the existing tab instead of opening a duplicate.
- File tabs use Dockview like terminal and folder tabs and support drag, split, reorder, and popout.

### Modes

- Available modes are Preview, Text, HEX, and Diff.
- Default mode is Preview.
- The mode switcher remains visible even when the current mode falls back to another mode.
- Preview should automatically fall back to Text or HEX when preview is unsupported or unsafe.

### Editing

- Text mode is editable.
- HEX mode is editable.
- Diff mode is read-only.
- Preview mode is read-only.
- Save is triggered from the File menu and keyboard shortcut handling, not by clicking a dirty indicator.

### Dirty State

- Dirty tabs show a VS Code-style dirty symbol in the tab.
- Clean tabs watch the file on disk and update live when the file changes externally.
- Dirty tabs do not auto-reload when the file changes externally.
- If a dirty file changes on disk, show a conflict banner with actions to reload from disk or keep local edits.

### Large Files

- 100 MB is the large-file threshold.
- For files larger than 100 MB, show a choice each time the file is opened when Monaco is relevant:
  - Performant
  - Monaco
- Do not remember the choice between file opens.
- Users can switch from Performant to Monaco later inside the tab where applicable.
- No extra warning modal is required when choosing Monaco for a large file.

### Diff

- Diff should be implemented as a custom HTML-based diff renderer, not Monaco diff.
- Diff should support side-by-side and unified layouts.
- The default diff layout is a global user preference, not per-file.
- When the user changes the diff layout, Terminay should remember that preference globally for future diff tabs.
- The diff renderer should be lazy and virtualized.

### Preview

- Preview should support safe built-in previews wherever practical.
- Initial required preview support:
  - Markdown
  - Images
  - PDF
- Markdown relative assets and links resolve relative to the markdown file's folder.
- Unsupported preview formats should fall back automatically.

## Functional Requirements

- Open a file tab from the file explorer on double-click.
- Close, focus, split, drag, and pop out file tabs using the same workspace behavior as terminals.
- Show the active mode and allow mode switching.
- Read file metadata and contents through Electron IPC.
- Detect whether a file is text-like, binary-like, previewable, diffable, and large.
- Watch open clean files for external disk changes.
- Support save, reload, revert-to-disk, and conflict resolution.
- Surface git diff data when the file belongs to a git repository.
- Keep Text and HEX edits in sync through a shared draft model.

## Performance Requirements

- Do not render more than the visible region plus a small overscan for large text, preview, hex, or diff surfaces.
- Do not load multi-gigabyte files into a single in-memory string for performant mode.
- Use ranged reads and paging for large-file access.
- Avoid rendering a DOM node per byte or per line for giant files.
- Avoid full-document markdown or diff computation for files that exceed safe thresholds.
- Keep tab switches responsive even when a file is large.

## UX Requirements

- File tabs should feel native to the existing app rather than like a separate tool window.
- Mode switches should be fast and not lose local draft state.
- Dirty/conflict states must be obvious.
- Fallback decisions should be explicit in the UI.
- The app should gracefully explain when a mode is unavailable for the current file.

## Architecture

The feature should be split into reusable layers with clear ownership.

### 1. File Workspace Integration

Responsible for integrating file tabs into Dockview and the existing project workspace.

Suggested responsibilities:

- register a new `file` panel component
- register a new `fileTab` header component
- maintain open-file lookup by absolute path
- route file explorer double-click into file open requests
- wire file tabs into active panel, close, popout, and menu command handling

This layer should not parse markdown, compute diffs, or implement file IO directly.

### 2. File Session Model

Responsible for file-tab state and lifecycle.

Suggested responsibilities:

- canonical file identity by absolute path
- current mode
- current large-file engine choice
- dirty state
- conflict state
- file capabilities
- current view state per mode
- watch subscription lifecycle

This should be the shared state boundary between the UI shell and the underlying services.

### 3. File System Gateway

Responsible for IPC and Electron-side file operations.

Suggested renderer API responsibilities:

- get file info
- read text window
- read byte range
- write file
- watch file
- stop watching file
- resolve preview source
- query git repo status
- read git diff payload

Suggested main-process responsibilities:

- safe path normalization
- `fs.stat`
- ranged reads using file descriptors
- incremental decoding for text windows
- atomic save via temp file + replace
- file watching and event fanout
- git command execution

This layer should not know about Dockview or React components.

### 4. Draft Buffer Layer

Responsible for unsaved edits independent of any specific renderer.

This is the most important reusable abstraction in the design.

Suggested responsibilities:

- represent the current draft on top of on-disk content
- expose edits as text edits and byte edits
- track whether the draft differs from disk
- support reload from disk
- support keep-local-edits on conflict
- provide save payloads to the File System Gateway
- provide windowed reads over the draft, not just over disk

Text mode and HEX mode should both read from and write to this shared draft model.

### 5. Capability Detection Layer

Responsible for deciding what the file can do.

Suggested capabilities:

- isTextLike
- isBinaryLike
- canPreview
- canUseMonaco
- canUseHex
- canDiff
- shouldPromptForLargeFileChoice
- preferredFallbackMode

This logic should be reusable by all mode switchers and open flows.

### 6. Viewer Shell Components

Responsible for the common file tab chrome.

Suggested reusable components:

- `FilePanel`
- `FileToolbar`
- `FileModeSwitcher`
- `FileStatusBar`
- `FileConflictBanner`
- `LargeFileOpenChooser`
- `UnsupportedModeState`

These components should compose mode-specific viewers rather than contain all mode logic directly.

### 7. Mode-Specific Viewers

Each mode should be isolated behind a dedicated component boundary.

Suggested components:

- `PreviewViewer`
- `TextViewer`
- `HexViewer`
- `DiffViewer`

Each viewer should accept abstract data providers and callbacks rather than talking directly to IPC whenever possible.

## Mode Strategies

### Preview Mode

Preview is the default mode.

Required preview types:

- markdown
- images
- pdf

Recommended preview strategy:

- images: native image preview with fit controls
- pdf: PDF.js-based viewer with lazy page rendering
- markdown:
  - normal files: full markdown render
  - large files: degrade gracefully to a safer preview path or text fallback

Preview mode should use virtualization or incremental rendering when content is large enough to make full render unsafe.

### Text Mode

Text mode has two engines:

- Monaco engine for normal files and when the user explicitly chooses Monaco
- Performant engine for large files and lazy access

#### Monaco Text Engine

Use Monaco for:

- built-in language detection from file extension/path
- syntax highlighting
- standard editing ergonomics for normal files

Do not rely on Monaco as the large-file engine. Monaco requires a full string-backed model and should therefore be treated as the rich editor path, not the paging path.

#### Performant Text Engine

Use a custom virtualized text viewer/editor for large files.

Requirements:

- only render visible lines plus overscan
- support text selection
- support cursor movement and editing
- support scrolling through large files without full load
- support line number gutter
- support draft edits through the shared Draft Buffer Layer

This should be designed as an abstract text surface so it can evolve independently from the rest of the file tab shell.

### HEX Mode

HEX mode should use a custom virtualized hex editor.

Requirements:

- virtualized rows
- configurable bytes per row
- offset column
- hex byte column
- ascii column
- selection support
- byte editing
- shared dirty state via the Draft Buffer Layer
- only render visible rows plus overscan

HEX mode should be the default fallback for binary data when preview and text are not suitable.

### Diff Mode

Diff mode should use a custom HTML-based diff viewer.

Requirements:

- read-only
- lazy and virtualized
- support side-by-side and unified layouts
- global preferred default layout
- diff data comes from git when available
- automatic unavailable state when file is not diffable

Suggested data model:

- compute or retrieve diff hunks
- normalize hunks into virtualized render rows
- render rows through a shared diff row component model

Diff mode should not be implemented as a special-case text viewer.

## Large-File Strategy

Large files need explicit engine selection.

### Threshold

- Files larger than 100 MB are considered large.

### Choice Prompt

When opening a file larger than 100 MB and a Monaco-backed path is relevant, show a chooser:

- Performant
- Monaco

This applies where Monaco would matter, including Text mode and any other Monaco-backed experience.

### Engine Behavior

- Performant mode uses ranged reads and virtualized rendering.
- Monaco mode reads the file into a Monaco-backed editing model.
- Users may switch from Performant to Monaco later inside the tab.
- The app asks every time rather than remembering the choice.

## Save, Watch, and Conflict Strategy

### Save

- Save should be available from the File menu.
- Keyboard save handling should route to the active file tab when appropriate.
- Saving should use atomic write semantics: write to a temp file, then replace the original.

### Watching

- Open clean files should be watched for external changes.
- When a clean file changes on disk, refresh the file tab automatically.
- Watch subscriptions should be started and stopped with panel lifecycle.

### Conflict Handling

- If the file changes on disk while the tab is dirty, stop auto-refresh.
- Show a conflict banner.
- Required conflict actions:
  - Reload from disk
  - Keep local edits

## Git Integration

Git integration should be isolated from the main file viewers behind a small service boundary.

Responsibilities:

- determine whether the path belongs to a git repository
- determine whether diff is available for the path
- retrieve the current working tree vs `HEAD` diff payload
- handle missing git or non-repo paths gracefully

The renderer should consume normalized diff data rather than raw git command output whenever possible.

## Reusable Components and Services

The implementation should favor these reusable abstractions:

- `FileSessionStore`
- `FileCapabilities`
- `FileBufferService`
- `FileDraftBuffer`
- `FileWatchService`
- `GitDiffService`
- `ModeSwitcher`
- `ConflictBanner`
- `LargeFileChooser`

## Suggested File Layout

The exact paths can change, but the implementation should stay modular.

Suggested areas:

- `src/components/file-viewer/`
- `src/components/file-viewer/shell/`
- `src/components/file-viewer/modes/`
- `src/components/file-viewer/virtualization/`
- `src/services/fileViewer/`
- `src/types/fileViewer.ts`
- `electron/fileViewer/`

## Implementation Checklist

### Workspace and Tab Integration

- [x] Create `specs/FILE_VIEWER.md`
- [x] Add shared file-viewer types for sessions, modes, capabilities, conflicts, and large-file engine choice
- [x] Register a Dockview `file` panel component
- [x] Register a Dockview `fileTab` header component
- [x] Add file tab open/focus-by-path behavior
- [x] Add file explorer double-click handling for files
- [x] Preserve existing directory toggle behavior
- [x] Integrate file tabs with existing close, split, drag, and popout behavior

### Electron and IPC

- [x] Add file metadata IPC
- [x] Add ranged byte-read IPC
- [x] Add ranged text-read IPC
- [x] Add atomic file-save IPC
- [x] Add file watch IPC
- [x] Add file unwatch IPC
- [x] Add preview-source IPC where needed
- [x] Add git repository detection IPC
- [x] Add git diff IPC

### Shared Services and Models

- [x] Implement `FileCapabilities`
- [x] Implement `FileSessionStore`
- [x] Implement `FileBufferService`
- [x] Implement `FileDraftBuffer`
- [x] Implement `FileWatchService`
- [x] Implement `GitDiffService`
- [ ] Implement reusable file error and unavailable-state models

### Shared Shell UI

- [x] Build `FilePanel`
- [x] Build `FileToolbar`
- [x] Build `FileModeSwitcher`
- [x] Build `FileStatusBar`
- [x] Build `FileConflictBanner`
- [x] Build `LargeFileOpenChooser`
- [x] Build `UnsupportedModeState`
- [x] Add dirty tab indicator support

### Preview Mode

- [x] Build image preview viewer
- [x] Build PDF preview viewer with PDF.js
- [x] Build markdown preview viewer
- [x] Add markdown relative asset/link resolution
- [x] Add preview fallback logic
- [x] Add preview virtualization or degradation strategy for large content

### Text Mode

- [x] Add Monaco integration for normal files
- [x] Add language detection from path/extension for Monaco
- [ ] Build the performant virtualized text viewer/editor
- [ ] Add text selection and editing support in the performant engine
- [x] Connect both text engines to the shared draft buffer
- [x] Add >100 MB open chooser flow for Monaco-relevant paths
- [x] Allow switching from Performant to Monaco inside the tab

### HEX Mode

- [x] Build the virtualized hex editor shell
- [x] Add offset, hex, and ascii columns
- [x] Add row virtualization
- [ ] Add selection handling
- [x] Add byte editing
- [x] Connect HEX edits to the shared draft buffer
- [x] Add save support from shared draft state

### Diff Mode

- [x] Design normalized diff row data structures
- [ ] Build diff row virtualization
- [x] Build side-by-side layout
- [ ] Build unified layout
- [ ] Add global default layout preference
- [ ] Add layout toggle UI
- [x] Add git-backed diff loading
- [x] Add unavailable states for non-diffable files

### Save, Watch, and Conflict Handling

- [x] Route File menu Save to the active file tab
- [x] Add keyboard save handling for file tabs
- [x] Auto-refresh clean watched files on disk change
- [x] Detect dirty-file external changes
- [x] Show conflict banner with reload/keep-local actions
- [x] Support reload-from-disk flow
- [x] Support keep-local-edits flow

### Styling and UX Polish

- [x] Style file tabs to match the existing workspace
- [x] Style each viewer mode coherently
- [ ] Add loading, empty, unsupported, and error states
- [ ] Preserve per-mode view state inside a tab where appropriate
- [x] Ensure popout windows work for file tabs too

### Validation

- [ ] Test normal text files
- [ ] Test binary files
- [ ] Test markdown preview with relative assets
- [ ] Test image preview
- [ ] Test PDF preview
- [ ] Test git repo and non-git repo paths
- [ ] Test dirty/save/conflict flows
- [ ] Test large-file chooser behavior above 100 MB
- [ ] Test performant text scrolling on very large files
- [ ] Test HEX virtualization on very large files
- [ ] Test diff virtualization on large diffs

## Open Implementation Notes

- The Draft Buffer Layer is the highest-risk part of the feature and should be implemented before polishing mode-specific UIs.
- The performant text engine should be treated as a first-class editor surface, not a temporary fallback.
- Virtualization should be abstracted once and reused across Text, HEX, Diff, and preview surfaces where practical.
- Monaco should remain the high-quality editor for normal files, not the only editor architecture.
