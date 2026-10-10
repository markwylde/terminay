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

- [ ] 4.1 Define the change-record DTO, its parser, the second delta version, and the `workspace-changes.v1` and `terminal-titles.v1` capabilities in `packages/protocol`. Verified by parser unit tests for valid, malformed, and oversized records.
- [ ] 4.2 Carry the scoped change record on `workspace.changed` for connections that negotiated the capability, with the fetch marker where a record cannot be scoped exactly. Verified by server tests for an unscoped connection, a project-scoped connection, and an object entering and leaving a scope.
- [ ] 4.3 Answer `workspace.delta` with ordered change records for a capable connection, and with a snapshot when history no longer reaches the requested revision. Keep the first delta version for a connection without the capability. Verified by server tests for both versions and for the history boundary.
- [ ] 4.4 Add protocol-conformance cases: record applied in order, gap, duplicate, scoped record, fallback to snapshot, and a peer without the capability. Verified by the conformance suite passing against the server.

## 5. Client store

- [ ] 5.1 Apply a change record in `WorkspaceSnapshotStore` when it starts from the held revision, sharing every untouched object; otherwise request a delta. Validate once. Verified by store tests for in-order, gap, duplicate, reordered, and malformed records, each asserting identity of untouched objects.
- [ ] 5.2 Reconcile a whole snapshot or first-version delta against the held projection so equal objects keep identity. Verified by a store test that reconnects with one changed project.
- [ ] 5.3 Tell listeners what changed, and add per-selection subscriptions (`useSyncExternalStore`) for a project, a panel, and the ordered project list. Verified by store tests that a listener for one panel is not called when another changes.
- [ ] 5.4 Add a client title store over the title projection with a per-terminal subscription, falling back to the panel's workspace title. Verified by unit tests for snapshot, change, fallback, and a server without the capability.

## 6. Renderer

- [ ] 6.1 Make `useProjectCollection` and `useConnectionProjectTabs` return the previous project tab, and the previous array, when the snapshot objects they are built from are the same. Verified by hook tests asserting identity across an unrelated change.
- [ ] 6.2 Derive feature availability from the connection and the project's own server-scope fields rather than the workspace revision, and key the explorer, watch, and Git effects in `useFileExplorerController` on root, project id, and client objects. Verified by a controller test that an unrelated projection change calls neither `listFolder`, `startWatch`, `subscribeStatusChanges`, nor a fresh Git listing.
- [ ] 6.3 Make the project workspace component's props stable at their source and memoise it. Verified by the render observer reporting no project workspace render for a change in another project.
- [ ] 6.4 Write terminal panel parameters only when a value differs, in `reconcileServerPanels` and `syncRunningMacroTabs`. Verified by a test counting `updateParameters` calls for a reconciliation with nothing changed.
- [ ] 6.5 Read the displayed title through the per-terminal title subscription in the terminal tab, sidebar rows, dashboard, and inventories; remove the title path through `setTerminalTitleRevision` and the inventory republish. Verified by the render observer reporting only the changed terminal's tab and rows for a title change.
- [ ] 6.6 Remove the status bar's working-directory query on every title change; key it on focus and on the terminal's own activity. Verified by a test that a title change sends no `currentCwd` query.

## 7. Gates and evidence

- [ ] 7.1 Server gate: sixty title sequences at one terminal over a simulated minute produce no workspace commit, no revision, no persistence write, and at most one title event per 250 ms. Verified by the test in the server-core suite.
- [ ] 7.2 Renderer gate: with the render observer on, a title change and a single-panel rename render only that terminal's tab and rows. Verified by the test in the renderer unit suite.
- [ ] 7.3 End-to-end: a terminal animates its title for ten seconds while another is typed in; assert no `git.measurement` raised as `refresh`, an unchanged workspace file modification time, and every typed character echoed. Verified by `npm run test:e2e` including the new spec.
- [ ] 7.4 Update `e2e/program-set-tab-titles.spec.ts` for the restart behaviour and for a second client receiving titles. Verified by `npm run test:e2e`.
- [ ] 7.5 Re-run the commit benchmark and a packaged-app run with an agent animating its title, and append the after figures to `openspec/adr/evidence/workspace-change-fanout-cost.md`. Verified by the file holding before and after tables.

## 8. Delivery

- [ ] 8.1 Run `npm run lint`, `npm run typecheck:workspaces`, the unit suites, protocol conformance, and `npm run test:e2e` locally. Verified by all passing.
- [ ] 8.2 Run `openspec validate --all` and `openspec validate --all --archived`. Verified by both passing.
- [ ] 8.3 Open the pull request on `origin` with `tea`, and read back every commit status on the head SHA. Verified by every status being `success` or `skipped`.
