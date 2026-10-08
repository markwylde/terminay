## Why

Opening the Documentation sidebar group shows a collapsed Documentation pane with
no contents and no count: the catalog is only built once the pane is expanded, so
every visit costs an extra click before any document is visible. Collapsing the
pane — or switching to another sidebar group while the catalog is still being
built — tears the indexer down, so the work restarts from nothing next time.

## What Changes

- Selecting the Documentation sidebar group expands the Documentation pane
  automatically the first time it is visited in an app session, so the document
  tree is on screen without a click.
- Indexing becomes a background activity owned by the project rather than by the
  pane: once started it survives sidebar group switches, hiding the sidebar, and
  collapsing the pane, and is torn down only when the project, root, or server
  changes.
- While a catalog build is in flight the Documentation pane header shows a
  spinner in place of the refresh button, with a stop button beside it.
- Pressing stop cancels the in-flight build, keeps the previously loaded catalog
  (empty when there was none), and restores the refresh button.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `documentation-sidebar-and-editor`: the pane auto-expands on first visit per app
  session; catalog indexing runs in the background for the life of the project
  independently of pane collapse and sidebar visibility; the pane header reports
  indexing with a spinner and a stop control that cancels the run without
  discarding the last good catalog.

## Impact

- `src/App.tsx` — Documentation pane definition: header actions, controller
  enablement, and the auto-expand on sidebar group selection.
- `src/workspace/useDocumentationController.ts` — controller lifetime decoupled
  from pane collapse.
- `src/workspace/DocumentationCatalogController.ts` — cancellable run, stop
  semantics.
- `src/components/sidebar/documentationPane.test.ts` and the documentation
  controller unit tests; an e2e assertion for the auto-expanded pane.
- No server, protocol, or catalog-query change: `docs.catalog` is unchanged.
