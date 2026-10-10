# What one workspace change cost (change `workspace-change-fanout`)

Date: 2026-10-10 · macOS (Darwin 27), Apple silicon, Node 24 · packaged Terminay Desktop 5.15.0-beta.54 to 6.0.0-beta.59, and a standalone benchmark of the commit primitives

## Method

**In the field.** The local diagnostics history of one Desktop install was read across six launches spanning the release that introduced program-set tab titles. `local-server.git.measurement.completed` records were counted by `raisedBy` and by hour. A measurement raised as `refresh` is one a client asked for explicitly.

**By reading.** The path of one `panel.programTitle.set` command was traced through `packages/server-core/src/workspace.ts`, `workspaceProtocol.ts`, `workspaceRepository.ts`, the Desktop main listeners, `src/shared/WorkspaceSnapshotStore.ts`, and the renderer, counting whole-state copies, writes, and the effects that re-run.

**By benchmark.** The commit's primitives were timed against that install's `workspace.v4.json` and against the same state with every collection multiplied by 10 and by 40: `structuredClone`, pretty-printed `JSON.stringify`, the `writeFileSync` plus `renameSync` atomic replace, and `JSON.parse`. 100 to 300 runs each.

## Results

Forced Git measurements per hour, by build:

| Build | Program-set titles | `refresh` measurements per hour |
| --- | --- | --- |
| 5.15.0-beta.54 | no | 14 to 45 |
| 5.15.0-beta.56 | yes | 55 to 1,031 |
| 5.15.0-beta.57 | yes | 140 to 1,252 |
| 6.0.0-beta.58, beta.59 | yes | 241 to 651 |

The busiest minute held 190, about three a second. Each took 100 to 400 ms of Git child processes; the slowest took 1.6 s. Over the retained history `refresh` accounted for 4,667 of 5,532 measurements and 956 s of Git time.

Work traced for one title change:

| Layer | Work |
| --- | --- |
| Server commit | 11 whole-state `structuredClone`s, one full validation, one synchronous whole-file write |
| Server retention | one whole-state copy per command id, up to 1,024 retained |
| Wire, per client | a change event naming no change, then a full-state delta reply |
| Client store | the reply validated twice, every object given a new identity |
| Renderer | every project tab rebuilt; App and every project workspace re-rendered; every terminal panel handed new parameters twice |
| Explorer and Git, per mounted folder | tree cleared and re-listed, file watches re-opened, Git subscription re-made, one forced Git measurement |

Commit primitives, p50 (p95) in milliseconds:

| State | One clone | Eleven clones | Serialise + write + rename | Parse |
| --- | --- | --- | --- | --- |
| 4 panels, 13.7 KiB | 0.09 (0.30) | 1.1 (2.6) | 1.4 (9.2) | 0.05 (0.20) |
| 40 panels, 135 KiB | 1.0 (2.9) | 9.7 (14.7) | 2.5 (6.8) | 0.5 (2.5) |
| 160 panels, 538 KiB | 3.5 (9.1) | 32.0 (42.4) | 7.3 (12.3) | 2.3 (6.8) |

## Reading

- The lag a person felt was the renderer's and Git's share, not the server's. On the affected install the server spent about 2.5 ms per title change.
- The server's share grows with the workspace and is dominated by the copies, not the write. At 160 panels the copies alone exceed two frames.
- The write is 1.4 to 7.3 ms at every size measured. That is affordable at the rate people change a workspace and not at the rate programs print.
- Nothing here was unbounded, and each site was correct on its own. The cost came from a value that changes every second being given the path built for changes a person makes.

## After

**One committed rename**, through the server's operation registry with three observers attached and the Desktop backend's atomic whole-file write, 400 runs, p50 (p95) in milliseconds. The states are built by commands, so they are smaller per panel than the field workspace above.

| State | Before | After |
| --- | --- | --- |
| 4 panels | 0.23 (0.29) | 0.14 (0.19) |
| 40 panels | 0.82 (1.17) | 0.30 (0.38) |
| 160 panels | 2.93 (3.77) | 0.88 (1.33) |

**Whole-state copies**, counted by the commit-cost harness in `packages/server-core/test/workspace-commit-cost.test.mjs`:

| | Before | After |
| --- | --- | --- |
| One rename, through the registry | 8 | 1 |
| Ten reads of the committed state | 20 | 0 |

**One title change**, by test rather than by trace:

| Layer | Before | After |
| --- | --- | --- |
| Workspace commits, revisions, file writes | 1 each | 0 |
| Wire, per client | an event, then a full-state query and reply | one event carrying the title |
| Client workspace projection | replaced, every object new | untouched |
| Explorer listings, watches opened, Git subscriptions, forced Git measurements | 1 each per mounted folder | 0 |

**One workspace change of any other kind** (a rename, a move, a close):

| Layer | Before | After |
| --- | --- | --- |
| Wire, per client | an event, then a full-state query and reply | one event carrying the change record |
| Client workspace projection | every object new | the objects the record names are new; the rest are the objects they were |
| Explorer and Git, per mounted folder | re-listed and re-measured | untouched unless its root, project, or clients changed |

## Not measured

- Renderer time per revision. It was traced by reading, not profiled.
- A remote client over WebRTC.
- A standalone server on SQLite; the write figures are for the Desktop file backend.
