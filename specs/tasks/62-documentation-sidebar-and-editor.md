# Documentation sidebar and editor

## Goal

Add a watched Markdown/MDX document tree to every project sidebar and open each
document in a rich MDXEditor presentation with frontmatter titles, one-second
debounced autosave, and Task 61's live sandboxed preview.

## Governing specifications

- [Documentation sidebar and editor](../features/documentation-sidebar-and-editor.md)
- [MDX browser runtime](../features/mdx-browser-runtime.md)
- [File explorer and folder tabs](../features/file-explorer-and-folder-tabs.md)
- [File viewer](../features/file-viewer.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)

Depends on: [Task 61 — MDX browser runtime](./61-mdx-browser-runtime.md).
Milestones 1–4 below can use a non-executable placeholder preview, but the task
is not complete until milestone 6 uses the real runtime.

## Read these implementation anchors first

- `packages/server-core/src/fileService/catalog.ts`, `catalogAdapter.ts`, and
  `tasks.ts` — bounded recursive traversal, ignore handling, typed protocol
  errors, and binary aggregate response patterns.
- `packages/server-core/src/fileService/observationAdapter.ts` and
  `watchRegistry.ts` — server-owned watch subscription, overflow, and resync.
- `packages/server-core/src/fileService/adapter.ts` and `fileSession.ts` — the
  only draft/edit/save/conflict authority. Documentation must reuse it.
- `packages/client-core/src/fileViewer.ts` and `fileObservation.ts` — client
  facade patterns and existing file operations.
- `src/workspace/useFileExplorerController.ts` and `FileExplorerTree.tsx` —
  directory loading/watch refresh patterns. Reuse concepts, not Explorer state.
- `src/types/settings.ts`, `src/terminalSettings.ts`,
  `src/workspace/projectTabModel.ts`, and `useProjectCollection.ts` — every place
  sidebar defaults and restored project state are normalized.
- `src/components/sidebar/SidebarPanelStack.tsx` and `src/App.tsx` around
  `sidebarPanelItemsById` — pane registration, resize, collapse, and reorder.
- `src/App.tsx` around `openFile`, `dockviewComponents`, and
  `dockviewTabComponents`; `src/components/file-viewer/FilePanel.tsx` — canonical
  file-panel identity and current viewer presentation.
- `src/components/file-viewer/FilePanelSaveRegistry.tsx` and
  `modes/sharedDraftTransition.ts` — active-panel save routing and shared draft
  transitions.
- `e2e/file-explorer-sidebar.spec.ts`, `file-viewer-core.spec.ts`, and
  `file-viewer-conflicts-large-files.spec.ts` — fixtures and assertions to extend.

## Fixed architecture

1. Documentation is a fourth `SidebarPanelId`, not a second standalone sidebar.
2. The server returns a bounded document catalog. The renderer must not walk the
   filesystem by repeatedly expanding every Explorer directory.
3. Add a `DocumentationClient` in `packages/client-core` and construct it in the
   shared renderer server-client context. Do not add Desktop-only filesystem IPC.
4. A canonical project path has one file session and one Dockview file panel.
   Explorer and Documentation select different presentations on that panel; they
   do not create separate editors or drafts.
5. MDXEditor edits the server file session's complete bounded UTF-8 draft.
   Oversized/binary/invalid UTF-8 documents show a clear unsupported state and
   can still open in the normal File Viewer.
6. Documentation autosave is an ordered controller around existing `files.edit`
   and `files.save`. Do not add a second save implementation.
7. Executable preview is Task 61's runtime. Never evaluate imports in MDXEditor,
   React renderer code, or Markdown preview HTML.

## Protocol contract to add

Add `docs.catalog` as a binary query owned by the server:

- Input: `projectId`, optional known catalog revision, and bounded paging/cursor
  options.
- Metadata: catalog revision, scanned entry/file counts, partial reason, next
  cursor if any, and root observation capability.
- Binary body: a bounded structured list of folder/document records. A document
  record contains project-relative path, extension (`md` or `mdx`), display
  title, title source (`frontmatter` or `filename`), and bounded metadata
  diagnostic if title parsing failed.

Use the existing `files.observe` root subscription for invalidation. A watch
event schedules one coalesced `docs.catalog` refresh; overflow/resync discards
incremental assumptions and fetches a fresh catalog. Do not invent a second host
watcher unless the existing observation contract cannot represent a required
state and that limitation is documented with a test.

## Delivery milestones

Implement and verify these in order.

### 1. Server document catalog

- Add a focused catalog service under `packages/server-core/src/fileService` or
  a sibling `documentation` module. Keep traversal separate from UI types.
- Recursively traverse the exact project storage using the existing canonical
  resolver. Include `.md` and `.mdx`; do not follow symlinks.
- Apply the same configured ignored-directory rules as folder Markdown tasks,
  plus the specified default hidden/dependency/generated directories. Put the
  shared ignore parser in one reusable module instead of copying string logic.
- Add a direct YAML parser dependency rather than relying on a transitive package
  or writing a parser. Read only a named, bounded prefix for YAML frontmatter.
  Accept `title` only when it is a non-empty string. Preserve no rewritten
  content. A malformed, non-string, or truncated title produces a bounded
  diagnostic and filename fallback. Configure parsing so aliases or hostile
  structures cannot create unbounded work.
- Implement and unit-test one title-casing function for separator and common
  camel-case splitting. Keep canonical filename/path separate from display text.
- Return only folders that lead to at least one included document. Sort folders
  before documents, then by display title and canonical relative-path tie-break.
- Enforce constants for traversal depth, entries, files, inspected bytes,
  result bytes, duration, and cancellation. Mark partial results explicitly.
- Register `docs.catalog` with authenticated project authorization in local and
  extension-backed environment composition.

Milestone gate: server tests cover nested `.md`/`.mdx`, empty-folder pruning,
ignore rules, title/fallback cases, symlink escape, partial limits,
cancellation, local/remote adapter parity, and cross-project rejection.

### 2. Client and watched tree

- Add `DocumentationClient` with strict metadata/body validation, cancellation,
  pagination, and tests in `packages/client-core`.
- Construct it beside `FileViewerClient` in `src/shared/rendererServerClient.ts`
  and expose it through the existing shared context used by Desktop and web.
- Add `useDocumentationController` under `src/workspace`. It owns catalog state,
  expanded folder ids, selection, loading/error/partial state, and one coalesced
  refresh timer.
- Subscribe to the project root with `FileObservationClient`. On ordinary watch
  events refresh without clearing the last good tree. On overflow/resync fetch a
  fresh catalog. Cancel subscriptions/timers when project, root, server, or
  component changes.
- Build a separate accessible `DocumentationTree`; do not overload
  `FileExplorerTree`. Folder rows only toggle. Document rows open the canonical
  path in Documentation presentation. Include accessible relative-path context
  when title and filename differ.

Milestone gate: component/controller tests prove initial load, refresh
coalescing, add/remove/retitle, overflow/resync, retained expansion/selection,
partial results, stale-request rejection, recovery after failure, and cleanup.

### 3. Sidebar persistence

- Add `documentation` to `SIDEBAR_PANEL_IDS` and add explicit settings fields for
  default collapsed state and default pane height.
- Update defaults, input normalization, old-settings normalization, settings UI
  if sidebar defaults are user-editable there, project creation, restored
  project normalization, and server workspace serialization/hydration as
  required by the existing state owner.
- Old settings/project snapshots that lack Documentation must normalize to one
  collapsed pane appended exactly once; they must not reorder existing panes.
- Register the pane in `sidebarPanelItemsById`, height/change commit branches,
  reorder handling, and feature-unavailable rendering. Add Refresh and document
  count where consistent with existing pane chrome.
- Persist folder expansion per project using the same state ownership model as
  existing expanded agent entries. Do not write it into project files.

Milestone gate: settings/project tests and E2E prove default collapse, toggle,
resize, reorder, restart/hydration, old-state normalization, and independence
between two projects.

### 4. Canonical Documentation presentation and MDXEditor

- Extend the file panel parameters with a presentation discriminator such as
  `presentation: 'file-viewer' | 'documentation'`. Do not add a second panel map.
- Change `openFile` to find the canonical panel by project-relative identity,
  set the requested presentation, activate it, and preserve session/draft/panel
  identity. Update server-owned workspace panel serialization so moves,
  reconnects, and native windows preserve the presentation.
- Add a Documentation surface inside `FilePanel` or a small component selected
  by it. It must use the existing `FileViewerClient` session opened by the panel.
- Load the complete bounded UTF-8 document through existing session reads before
  mounting MDXEditor. Show actionable states for too large, binary, invalid
  encoding, disappeared path, unavailable authority, and parser failure.
- Install and configure MDXEditor and its CSS once. Enable the first-party
  plugins required by the feature spec: headings, formatting, lists, quotes,
  thematic breaks, links, images, tables, code blocks, frontmatter,
  directives/admonitions, JSX, search/replace, shortcuts, source/diff, undo/redo,
  and Sandpack-style blocks. Keep plugin setup in one module, not per render.
- Preserve unsupported constructs losslessly via source mode or structured
  placeholders. Use MDXEditor's error callback; never silently normalize away
  source that cannot round-trip.
- Add the responsive toolbar and editor/preview layout. This milestone may use a
  non-executable preview placeholder until Task 61 is available.
- Recompute tree/tab title only after the relevant draft/save revision is
  authoritative. Do not rename the underlying file when its title changes.
- Project `.md`/`.mdx` links request Documentation presentation; Explorer
  requests normal File Viewer presentation. External links use existing host
  policy.

Milestone gate: tests prove one panel/session across both entry points,
presentation persistence, complete draft preservation across presentation/source
switches, supported toolbar operations, frontmatter tab title, and unsupported
file states.

### 5. Ordered one-second autosave

Implement autosave as a small independently tested controller/hook, not ad-hoc
timeouts inside toolbar callbacks.

- On each real MDXEditor change, store the newest text/revision and reset one
  1000 ms debounce. Ignore MDXEditor's initial normalization callback unless the
  user made a real edit.
- When the timer fires, call `files.edit` with UTF-8 bytes and the expected draft
  revision, then call `files.save` with the returned draft revision and current
  disk revision.
- Permit only one edit/save pipeline at a time. If text changes while saving,
  keep only the newest pending text and immediately run it after the current
  pipeline settles. An older completion cannot set the newer draft to `Saved`.
- Expose deterministic `idle`, `dirty`, `saving`, `saved`, `conflict`, and
  `failed` states. Show `Saving…`, `Saved`, `Conflict`, or `Save failed` in the
  document surface and keep error details/retry accessible.
- On blur, presentation switch, or close, cancel the debounce and start an
  immediate flush. The close path waits for the bounded in-flight flush. On
  failure/conflict it preserves the server draft and offers the feature-spec
  choice; it never silently discards or overwrites.
- Use the existing conflict reload/keep-local actions. A stale disk or draft
  revision must stop automatic saving until the user resolves it.
- Cancel timers and prevent state updates after unmount, but do not close or
  discard the shared server file session merely because the presentation
  changed.
- Keep normal Preview/Text/HEX/Diff explicit-save behaviour unchanged. Add a
  regression test that types in normal Text mode, waits longer than one second,
  and confirms disk content did not change.

Use fake timers for controller tests. Required cases: one quiet-period save,
debounce reset, edit-during-save serialization, stale completion, blur flush,
close flush, conflict, failed-save retry, unmount, and initial normalization.

Milestone gate: all autosave cases pass against both a fake client and the real
server file-session adapter; the normal File Viewer regression passes.

### 6. Real preview integration and end-to-end acceptance

- Replace the placeholder with Task 61's preview host. Pass compiled bytes and
  opaque resource callbacks only; never pass a host path.
- Keep editor and preview lifecycles separate. Compile/network/runtime failure
  leaves editing and autosave working and exposes diagnostics/restart.
- Dependency watch invalidation refreshes preview without remounting MDXEditor
  or resetting selection/draft.
- Wire validated preview `open-document`, external-link, resize, diagnostic, and
  download messages to the host actions defined by Task 61.
- Add one representative fixture project containing nested Markdown, YAML
  titles, MDX importing `Components/Alert.tsx`, an external asset/network call,
  an interactive prevented form, and an ignored directory.

Milestone gate: Docker E2E completes the full user journey and the runtime
security assertions from Task 61 still pass when embedded in Documentation.

## Required tests and commands

Add focused files with clear ownership:

- `packages/server-core/test/documentation-catalog.test.mjs`
- `packages/server-core/test/documentation-protocol.test.mjs`
- `packages/client-core/test/documentation-client.test.mjs`
- `src/workspace/useDocumentationController.test.ts`
- autosave/controller tests beside the new controller
- component tests beside `DocumentationTree` and the editor surface
- `e2e/documentation-sidebar-editor.spec.ts`

Run during development:

```sh
npm run test --workspace @terminay/client-core
npm run test --workspace @terminay/server-core
npm run lint
npm run build:app
```

Run Electron acceptance only through Docker:

```sh
npm run test:e2e -- e2e/documentation-sidebar-editor.spec.ts
```

If the container runner does not accept a file argument, run `npm run test:e2e`
and document that fact. Never use `npm run test:e2e:host` for this task.

## Do not ship these shortcuts

- Recursive Explorer expansion as the Documentation catalog.
- Renderer/Electron filesystem traversal or a Desktop-only documentation IPC.
- A second file session/panel/draft for the same project path.
- Direct disk writes, `fs.writeFile`, or a new save API for autosave.
- Saving on every keystroke, overlapping saves, or an autosave timer without
  conflict revision preconditions.
- Reconstructing Markdown from rendered HTML or allowing MDXEditor normalization
  to silently remove unsupported source.
- Executing MDX imports in Terminay's renderer instead of Task 61's sandbox.
- Clearing the last good tree during refresh or losing expansion on watch events.
- Running Playwright's Electron suite directly on the host.

## Definition of done

All six milestone gates pass. Focused package/controller/component tests, lint,
application build, and Docker Electron E2E pass. Normal File Viewer save
behaviour remains unchanged, all feature-spec acceptance outcomes are covered,
no prohibited shortcut remains, and this file moves to
`../tasks_completed/`.
