## 1. Cancellable catalog builds

- [x] 1.1 Add `stop()` to `DocumentationCatalogController`: clear any pending coalesced timer, increment the request generation, set `loading` to `false`, leave `catalogValue` and the watch subscription untouched, and emit. Verified by a controller unit test asserting that a stop during an in-flight paged build leaves the previously loaded catalog in the snapshot, reports `loading: false`, and that the late response is not applied.
- [x] 1.2 Assert the empty-catalog case: stopping the very first build leaves `catalog` undefined and `loading` false rather than surfacing an error. Verified by a controller unit test.
- [x] 1.3 Assert the watch subscription survives a stop and that a subsequent watch event still schedules a coalesced refresh. Verified by a controller unit test driving a fake observation client.
- [x] 1.4 Expose `stop` from `useDocumentationController` alongside `refresh`. Verified by `npm run typecheck:workspaces` and the hook's consumers compiling.

## 2. Indexing lifetime decoupled from the pane

- [x] 2.1 Replace the Documentation controller's `enabled: !project.isDocumentationPaneCollapsed` with a per-project latch in the project workspace component that turns true when the Documentation sidebar group is first shown and stays true while the project component is mounted. Verified by a `documentationPane.test.ts` assertion that `useDocumentationController` is no longer passed the pane's collapsed state.
- [x] 2.2 Confirm the existing teardown keys (`client`, `observationClient`, `projectId`, `scopeKey`) are unchanged so the controller is still disposed when the project, root, or server changes. Verified by the existing controller lifetime tests continuing to pass.
- [x] 2.3 Add an Electron E2E assertion that starting an index, switching to the Explorer group and back, and collapsing then re-expanding the pane all leave the document tree populated without a fresh build. Verified by `npm run test:e2e` for that spec passing.

## 3. Auto-expand on first visit

- [x] 3.1 Track, in renderer-session memory keyed by project id, whether the Documentation group has already auto-expanded for that project; on selecting the group for a project not yet marked, mark it and patch `isDocumentationPaneCollapsed: false` through `onUpdateProject` when the pane is collapsed. Verified by a unit test over the extracted decision function covering first visit, a visit after a manual collapse in the same session, and a fresh session.
- [x] 3.2 Confirm no persisted settings or project-state field is added. Verified by the existing settings and stored-state normalization tests passing unchanged.
- [x] 3.3 Add an Electron E2E assertion that opening a project and selecting the Documentation group shows a populated tree with a document count without clicking the pane header. Verified by `npm run test:e2e` for that spec passing.

## 4. Pane header progress and stop control

- [x] 4.1 Render a spinning progress indicator in place of the refresh button while the controller reports `loading`, with an accessible label. Verified by a `documentationPane.test.ts` assertion on the rendered header source.
- [x] 4.2 Render a stop button beside it, labelled "Stop indexing documentation", wired to the controller's `stop`. Verified by a `documentationPane.test.ts` assertion and by the E2E spec below.
- [x] 4.3 Keep the last known document count in the pane header badge during a build rather than blanking it. Verified by a `documentationPane.test.ts` assertion that the count still reads from `documentation.catalog`.
- [x] 4.4 Add the spinner keyframes/class to the sidebar stylesheet, reusing the existing sidebar action button sizing so the header does not reflow between the two states. Verified by a stylesheet assertion in `documentationPane.test.ts`.
- [x] 4.5 Add an Electron E2E assertion that the header shows the stop control during an index and returns to the refresh button once it settles. Verified by `npm run test:e2e` for that spec passing.

## 5. Verification

- [x] 5.1 Run `npm run lint`, `npm run typecheck:workspaces`, and the documentation unit tests. Verified by each command exiting 0.
- [x] 5.2 Run `npm run test:e2e` for the Documentation specs. Verified by the run passing.
- [x] 5.3 Run `openspec validate --all`. Verified by it reporting clean.
- [ ] 5.4 Open the app against this repository and confirm by inspection that selecting the Documentation group expands the pane, shows the spinner and stop control, and settles to the refresh button with the full document count.
