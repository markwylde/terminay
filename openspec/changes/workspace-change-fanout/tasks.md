## 1. Groundwork

- [x] 1.1 Archive `program-set-tab-titles` so its requirements are in the main specs. Verified by `openspec validate --all` passing and `openspec/specs/program-set-tab-titles/spec.md` holding the requirements this change modifies.
- [x] 1.2 Revert the interim renderer edits on this branch (`featureAvailabilityRef` and the serialised move-target list in `src/App.tsx`, and the matching test in `scripts/git-pane-sync.test.mjs`); design decision 8 replaces them. Keep the value-compared `updateParameters` in `reconcileServerPanels`. Verified by `git diff main -- src/App.tsx` showing only that hunk.
- [x] 1.3 Add a commit-cost harness to `packages/server-core/test` that counts state copies and persistence writes per applied command at three state sizes. Verified by the harness running in the unit suite; before any fix it reported eight copies for a rename through the operation registry (the other three of the eleven traced were the Desktop observers and the coalescer's lookup, outside server-core) and twenty for ten reads.

## 2. Server: read without copying, commit with one copy

- [x] 2.1 Make the state `WorkspaceStore` returns deeply read-only in its type, and return the committed value instead of a copy. Fix every caller the compiler then rejects. Verified by `npm run typecheck:workspaces`.
- [x] 2.2 Freeze the committed state, in every build, so a reader that changes it fails where it does so. Verified by a test that mutates a read state and fails, and by the full server-core suite passing with freezing on.
- [x] 2.3 After each commit, keep the predecessor object for every collection entry that is structurally equal, and derive the change record (created or replaced objects, removed ids, changed top-level fields) from that comparison. Verified by unit tests for create, rename, move between projects, move between folders, close, and a command that changes nothing.
- [x] 2.4 Pass the change record to store subscribers. Make `publishWorkspaceChange`, `terminalSessionRehomedBy`, `serverFolders.workspaceChanged`, the MCP gateway project tracker, the automation-space visibility projector, and `releaseClosedHeldSessions` read the shared state and act only when the record concerns them. Verified by the harness from 1.3 reporting one copy per commit with all observers attached.
- [x] 2.5 Serialise the state once per commit and keep the write synchronous and atomic before publication. Verified by a test that a failing write publishes no event and leaves the revision unchanged, and by the harness reporting one write per commit.
- [x] 2.6 Store change records, not states, in the outcome cache and bound it in total bytes as well as in count. Verified by tests for eviction at the byte bound and for a duplicate command id answered from a remembered outcome.

## 3. Server: program titles as a live fact

- [x] 3.1 Add an in-memory title store keyed by session, fed by the existing sanitiser and coalescer, with the server's resolver (named title, else program title, else default name). Verified by unit tests for resolution, sanitising, the 250 ms window, an unchanged displayed title publishing nothing, and a program title under a named title publishing nothing.
- [x] 3.2 Publish the terminal title projection: a snapshot query and a keyed change event, scoped per connection like terminal activity, with a pending title replaced by a newer one for the same terminal. Gate it on a `terminal-titles.v1` capability. Verified by server-core tests for scope, replacement under a stalled connection, and a newly connected client receiving existing titles.
- [x] 3.3 Republish a terminal's displayed title when a named title is set or cleared, when its panel moves project, and when the `programSetTabTitles` setting changes; drop a terminal's title when its panel is removed. Verified by unit tests for each.
- [x] 3.4 Remove `programTitle`, `panel.programTitle.set`, and `panel.programTitles.clear` from the workspace model, reducer, validator, and protocol projection. Drop a persisted `programTitle` on load. Verified by a load test with a file that has one, and by `grep` finding no `programTitle` in `workspace.ts`.
- [x] 3.5 Serve MCP `list_terminals` display names and the agent session bridge's display name from the title resolver. Verified by the existing MCP title tests passing unchanged and a new one for a program title read with no client attached.
- [x] 3.6 Rewrite `packages/server-core/test/program-titles.test.mjs` against the store: title sequences cause no workspace commit, no revision, and no persistence write. Verified by that suite.

## 4. Protocol: change records

- [x] 4.1 Define the change-record DTO, its parser, the second delta version, and the `workspace-changes.v1` and `terminal-titles.v1` capabilities in `packages/protocol`. Verified by parser unit tests for valid, malformed, and oversized records.
- [x] 4.2 Carry the scoped change record on `workspace.changed` for connections that negotiated the capability. A record is derived per connection as the difference between what it could read before and after the commit, so it is exact in every case, including an object entering or leaving a scope; an event is sent without a record only when the store no longer retains the commit. Verified by server tests for a connection the automation space is withheld from, a project-scoped connection, and an object entering and leaving a scope.
- [x] 4.3 Answer `workspace.delta` with ordered change records for a capable connection, and with a snapshot when history no longer reaches the requested revision. Keep the first delta version for a connection without the capability. Verified by server tests for both versions and for the history boundary.
- [x] 4.4 Cover the wire contract end to end: record applied in order, scoped record, fallback to snapshot, and a peer without the capability against a composed server (`packages/server-core/test/workspace-change-records-wire.test.mjs`; `packages/protocol-conformance` holds transports, not cases), and gap, duplicate, reordered, and malformed records against the client store (`scripts/workspace-projection.test.mjs`). Verified by both suites passing.

## 5. Client store

- [x] 5.1 Apply a change record in `WorkspaceSnapshotStore` when it starts from the held revision, sharing every untouched object; otherwise request a delta. Validate once. Verified by store tests for in-order, gap, duplicate, reordered, and malformed records, each asserting identity of untouched objects.
- [x] 5.2 Reconcile a whole snapshot or first-version delta against the held projection so equal objects keep identity. Verified by a store test that reconnects with one changed project.
- [x] 5.3 Tell listeners what changed, and add per-selection subscriptions (`useSyncExternalStore`) for a project, a panel, and the ordered project list. Verified by store tests that a listener for one panel is not called when another changes.
- [x] 5.4 Add a client title store over the title projection with a per-terminal subscription, falling back to the panel's workspace title. Verified by unit tests for snapshot, change, fallback, and a server without the capability.

## 6. Renderer

- [x] 6.1 Make `useProjectCollection` and `useConnectionProjectTabs` return the previous project tab, and the previous array, when the snapshot objects they are built from are the same. Verified by unit tests of the identity helpers (`src/workspace/unchangedPresentation.test.ts`), which also assert the collection uses them.
- [x] 6.2 Derive feature availability from the connection and the project's own server-scope fields rather than the workspace revision, and key the explorer, watch, and Git effects in `useFileExplorerController` on root, project id, and client objects. Verified by a controller test in a real browser (`scripts/file-explorer-unrelated-change.test.mjs`, run locally like the other browser-harness scripts: the CI fast gate has no browser) that an unrelated change calls neither `listFolder`, `startWatch`, `subscribeStatusChanges`, nor a fresh Git listing, and in CI by the end-to-end spec in 7.3.
- [x] 6.3 Make the project workspace component's props stable at their source, have it subscribe to its own project's part of the projection, and memoise it. Verified by source assertions in `src/workspace/unchangedPresentation.test.ts` and by the end-to-end suite passing with the memoised component; the bound on workspace renders is asserted in 7.3. A two-project render count for a change in another project is not asserted end to end: the fixture presents one project.
- [x] 6.4 Write terminal panel parameters only when a value differs, in `reconcileServerPanels` and `syncRunningMacroTabs`. Verified by unit tests of `changedTerminalAppearance` for a reconciliation with nothing changed.
- [x] 6.5 Hand the displayed title to the one tab it belongs to from the title store, and read it per row in the folders tree, dashboard, compact switcher and breadcrumb, notifications menu, agents sidebar, and status bar; remove the title-revision state and the inventory republish it drove. Lists are still built from the title a row had when its list was built, so search and filtering by title see a new title when the list is next rebuilt. Verified by `scripts/terminal-title-store.test.mjs` (a title is heard by that terminal's listeners only), the source assertions in `src/workspace/unchangedPresentation.test.ts`, and `e2e/program-set-tab-titles.spec.ts`.
- [x] 6.6 Remove the status bar's working-directory query on every title change; it is asked on focus, window focus, and after Enter. Verified by the source assertion that no title revision remains in the status bar or the workspace.

## 7. Gates and evidence

- [x] 7.1 Server gate: sixty title sequences at one terminal produce no workspace commit, no revision, no persistence write, and at most two title publications per 250 ms window. Verified by `packages/server-core/test/program-titles.test.mjs`.
- [x] 7.2 Renderer gate: a title change is heard only by the listeners of that terminal, and a project's part of the projection is the same object across another project's change. Verified by `scripts/terminal-title-store.test.mjs` and `scripts/workspace-projection.test.mjs` in the CI fast gate.
- [x] 7.3 End-to-end: a terminal animates its title forty times; assert from the renderer's diagnostics that no workspace projection was published, the explorer was not loaded again, Git was not measured, and the project workspace rendered fewer than twenty times. A second case renames a terminal and asserts the explorer and Git are untouched. The unchanged workspace file is asserted by 7.1, on the server, where the write happens. Verified by `e2e/workspace-change-fanout.spec.ts` under `npm run test:e2e`.
- [x] 7.4 Keep `e2e/program-set-tab-titles.spec.ts` passing on the live title path, including a title surviving a client reload. A second client receiving titles, a late-joining client, and a stored program title being dropped on load are verified against a composed server in `packages/server-core/test/program-titles.test.mjs` rather than end to end.
- [x] 7.5 Re-run the commit benchmark and append the after figures to `openspec/adr/evidence/workspace-change-fanout-cost.md`. Verified by the file holding before and after tables. A packaged-app run with a real agent is not part of this: it is recorded there as not measured.

## 8. Delivery

- [x] 8.1 Run `npm run lint`, `npm run typecheck:workspaces`, the unit suites, protocol conformance, and `npm run test:e2e` locally. Verified by all passing.
- [x] 8.2 Run `openspec validate --all` and `openspec validate --all --archived`. Verified by both passing.
- [x] 8.3 Open the pull request on `origin` with `tea`, and read back every commit status on the head SHA. Verified by every status being `success` or `skipped`.
