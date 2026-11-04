## Context

One animated tab title currently costs, per change:

| Layer | Work per title change | Sized by |
| --- | --- | --- |
| Server commit | about eleven `structuredClone`s of the whole state, a full validation, a synchronous pretty-printed rewrite of `workspace.v4.json` | whole workspace |
| Server retention | one whole-state copy kept per command id, up to 1,024 | whole workspace × 1,024 |
| Wire | a `workspace.changed` event naming no change, then a `workspace.delta` reply carrying the full state, per client | whole workspace × clients |
| Client store | full parse and validation twice, snapshot replaced wholesale, every object given a new identity | whole workspace |
| Renderer | every project rebuilt, App and every project workspace re-rendered, every terminal panel handed new parameters twice | every project, folder, and terminal |
| Explorer and Git | tree cleared and re-listed, file watches re-opened, Git subscription re-made, a forced Git measurement | every mounted folder |

The last row is what a person feels: each forced measurement spawns Git for 100 to 400 ms, up to three times a second.

Measured on the workspace file of the machine that reported the lag (13.7 KiB, 4 panels) and on the same state scaled up:

| State | 11 clones | serialise + write + rename | client decode |
| --- | --- | --- | --- |
| 4 panels, 13.7 KiB | 1.1 ms (p95 2.6) | 1.4 ms (p95 9.2) | 0.05 ms |
| 40 panels, 135 KiB | 9.7 ms (p95 14.7) | 2.5 ms (p95 6.8) | 0.5 ms |
| 160 panels, 538 KiB | 32.0 ms (p95 42.4) | 7.3 ms (p95 12.3) | 2.3 ms |

So on a small workspace the server's share is a few milliseconds and the renderer's is the lag. On a large one the clones alone are a dropped frame or two per commit on the Desktop main process. The write is the smaller cost at every size.

In-force decisions that bind this design: ADR-0011 (terminal output is untrusted), ADR-0028 (no polling; timers are armed by events), ADR-0044 (work on the output path is proportional to the output event), ADR-0047 and ADR-0048 (a window is one server; compatibility is negotiated per connection), ADR-0049 (folders are not identity boundaries), ADR-0055 (the data root is held by a kernel lock). ADR-0056 is in force and is revisited here; see Open Questions.

## Goals / Non-Goals

**Goals:**

- An animating title costs one small event and one tab's repaint: no workspace write, no revision, no Git, no render outside the tab.
- Any workspace change costs each layer work proportional to what changed.
- A commit stays atomic, validated, and durable before it is published.
- Clients that do not speak the new shapes keep working.
- The cost is held by a gate, not by review.

**Non-Goals:**

- Changing what a named title, a rename, or `rename_terminal` does.
- Changing the persistence backend, or making the commit asynchronous.
- Persisting program titles anywhere.
- Changing terminal activity, agent status, or Git observation contracts.
- Splitting `App.tsx`. Only the boundaries this change needs are drawn.

## Decisions

### 1. A program title is a live fact the server holds in memory

The server keeps `sessionId → programTitle` in a title store owned by the same service that reads the title sequence, and publishes one projection, the **terminal title projection**: for each terminal panel a connection may see, its displayed title, resolved by the server as named title, else program title, else default name. The projection has a snapshot query and a keyed change event, in the same current-state shape as terminal activity: a pending title for a terminal replaces the one still queued, so a congested connection receives the newest title rather than a backlog.

`programTitle`, `panel.programTitle.set`, and `panel.programTitles.clear` leave the workspace model. A named title remains a workspace fact; committing one makes the server publish that terminal's displayed title again. The `Terminal N` default stays in workspace state.

Boundary: this keeps ADR-0056's trust rules. The server is still the only reader of the sequence, the value is still sanitised display text that selects nothing, a client still cannot set it, and nothing is echoed to the program. It moves the value across the persistence boundary: output-supplied text no longer reaches disk or the durable, synced workspace model at all.

- *Why not keep it in workspace state and make commits cheap?* Even a free commit advances the revision, and the revision is what tells every client that the workspace's structure may have changed. A value that changes once a second should not be able to say that.
- *Why not add it to the activity entry?* Activity revisions are specified not to advance while status is unchanged. A title riding on them would wake every activity consumer once a second.
- *Why not let the client read the title from its own xterm?* A terminal with no client attached, a second device, and MCP all need it, and ADR-0056 rule 1 forbids a client turning parsed output into state.
- *Cost accepted:* a program title is lost on server restart. A program that animates its title rewrites it within a second; one that set it once shows its default name until it writes again.

### 2. Coalescing bounds publication

The 250 ms per-terminal window is kept and now bounds how often a title is published. The timer is armed by a title sequence and not otherwise (ADR-0028); per-event work is a map write (ADR-0044). A sequence that leaves the displayed title unchanged publishes nothing, which now includes every program title written to a terminal that has a named title.

### 3. A commit copies the state once, and reading it copies nothing

The store holds the committed state as a deeply read-only value and hands that value out. A commit is: copy the current state once into a draft, reduce the command, validate, make it durable, then swap. After the swap the store compares each object of each collection with its predecessor and keeps the predecessor wherever they are equal, so an object a command did not change has the same identity before and after. The comparison is the source of the change record in decision 5.

The type of the state the store returns is read-only throughout. In tests and development builds the committed state is frozen, so a caller that mutates what it read fails where it does so.

Callers that copied the state to read one field (`publishWorkspaceChange`, `terminalSessionRehomedBy`, `serverFolders.workspaceChanged`, the MCP gateway project tracker, the automation-space visibility projector) read the shared value. Store subscribers receive the change record and use it to decide whether they have anything to do.

- *Why not an immutable-update reducer with no draft copy at all?* The reducer is large and assigns into a draft throughout. One copy per commit at the rate people act is 0.1 to 3.5 ms. Rewriting it is risk without a measured return.

### 4. The commit stays durable before it is published, and stays synchronous

The whole-file atomic write is kept in the commit path. Measured, it is 1.4 to 7.3 ms, and after decision 1 it runs when a person or an agent changes the workspace, not when a program prints. Publishing a revision that is not yet on disk would let a crash take back a terminal a client had already been told exists, while the session holder still held its PTY; that trade is not worth a few milliseconds at human rate.

The write is made proportional where it is free to: the state is serialised once, and that serialisation is reused for the byte bound in decision 6.

Boundary: no change to the repository boundary, the atomic-replace contract, or the data-root lock (ADR-0055).

- *Why not write behind?* It weakens "committed means durable" for every command to speed up a path that decision 1 already removes from the hot loop.

### 5. A change travels as a change record

A **change record** is the ordered outcome of one commit: the revision it starts from and produces, the command type, and per collection (`views`, `projects`, `folders`, `panels`, `terminalSessions`) the objects it created or replaced, by id, and the ids it removed, plus any top-level field it changed.

- The ordered `workspace.changed` event carries the change record, scoped to what the receiving connection may see. As built, a scoped record is not a filtered copy of the commit's record: the store keeps the states on either side of each retained commit, which share everything the commit left alone, and a connection's record is the difference between what it could read before and after, through the one function that also scopes its snapshots. That is exact by construction, including for an object entering or leaving the scope, so no "fetch instead" marker was needed. A scoped record also omits the command's type. The event goes out without a record only when the store no longer retains the commit, and the client then asks for a delta.
- `workspace.delta` gains a second version whose reply is the ordered change records since the requested revision. When the server's history no longer reaches that revision it answers with a snapshot, as it does now.
- A client applies a record only when the record's starting revision is the revision it holds. Otherwise it asks for a delta from the revision it holds. Applying is all-or-nothing: the record is validated first and the projection is replaced in one step.

Both shapes are gated by a feature capability, `workspace-changes.v1`. A peer that does not negotiate it gets today's event and today's delta envelope, unchanged. The title projection is gated by `terminal-titles.v1`; a server without it publishes no program titles, and a client then shows each panel's workspace title, which is its named title or default name.

Boundary: change records cross the same authorization projection as snapshots. Nothing a connection could not read in a snapshot appears in a record, and scoping failures fall back to a fetch rather than to a wider record.

- *Why not keep fetching and only share structure on the client?* That fixes identity and leaves a full-state round trip and a full parse per change, per client, including over WebRTC to a phone.
- *Why not JSON Patch?* Objects here are small and replaced whole by the reducer. Whole-object records need no path language, validate with the existing per-object validators, and map one to one onto identity.

### 6. Remembered outcomes are bounded in bytes

The idempotency cache keeps, per command id, the result a duplicate must be answered with. It stops retaining a whole-state copy per entry: an outcome holds the change record and the revision. It is bounded by entry count and by total bytes, oldest first. A duplicate of a command whose outcome has been evicted is answered as it is today when the id has aged out of history.

### 7. A client projection keeps the identity of what did not change

`WorkspaceSnapshotStore` applies a change record by building a new snapshot that shares every untouched object with the previous one. A snapshot or delta that arrives whole is reconciled the same way: each incoming object equal to the one held is replaced by the one held. The projection is validated once.

The store exposes selectors with a subscription per selection (`useSyncExternalStore`), so a component subscribes to the project, panel, or title it shows and is not told about the rest. Listeners are told what changed, not only that something did.

### 8. Renderer work is keyed on what it depends on

- `useProjectCollection` and `useConnectionProjectTabs` derive each project tab from the snapshot objects it is made of and return the previous tab when those are the same objects, and the previous array when every tab is.
- The project workspace component is memoised, and its props are made stable: no set, array, or callback is created during the parent's render to be handed to it.
- Feature availability is derived from the connection and the project's own server-scope fields, not from the workspace revision. Explorer, watch, and Git effects depend on the root, the project id, and the client objects they call.
- A terminal panel's parameters are written only when a value differs from the one the panel holds.
- A terminal tab, the sidebar rows, and the inventories that name terminals read the displayed title from the title projection through a per-terminal subscription.

The earlier state of this branch reads availability through a ref and deduplicates the move-target list by serialising it. Both are replaced by the above: with stable project identities neither indirection is needed.

Three choices made while building this:

- A tab's title is still Dockview's own panel title, which the switcher, the inventory, MCP control, and recording all read. The title store hands a new title to the one panel it belongs to. Rows elsewhere read the store per row.
- A list that names terminals is still built from the title each row had when the list was built. The text shown follows the terminal; search and filtering by title see a new title when the list is next rebuilt.
- The title an AI generation is given as context is the workspace's own title for the terminal (its name, else its default), not a title its program set. An animated program title is not useful context, and the generated title is a name that replaces it.

Boundary: none crossed. The renderer still gets everything through the preload contract and the protocol client.

### 9. The cost is held by a gate

- A server test drives title sequences at a terminal and asserts no workspace commit, no persistence write, no revision, and at most one title event per window.
- A renderer test uses the existing render observer to assert that a title change, and a change to one panel, render only that panel's tab and row.
- An end-to-end test animates a title for several seconds in one terminal while typing in another, and asserts from diagnostics that no Git measurement was raised and the workspace file was not written.
- A server test asserts a commit performs one state copy at each of three state sizes, and that the outcome cache stays within its byte bound.

## Risks / Trade-offs

- [A caller somewhere mutates state it read from the store] → the read-only type catches it at compile time, freezing catches it in every test run, and the store's own tests cover each former copying caller.
- [A change record is scoped wrongly and leaks an object, or hides one] → records go through the existing snapshot scoping function; any case it cannot decide exactly sends the fetch marker. Protocol conformance gains scoped-connection cases for create, move in, move out, and remove.
- [A client applies a record out of order] → records carry their starting revision; anything else is a fetch. Covered by tests for a dropped, duplicated, and reordered event.
- [Identity preservation hides a real change] → equality is structural and is tested per collection; the fallback when in doubt is a new identity, which is today's behaviour.
- [Memoising the project workspace exposes a stale closure] → props are made stable at the source rather than compared loosely; the end-to-end suite covers the flows that cross the boundary (move, popout, adopt, rename, close).
- [A program title is missing after a server restart] → accepted and specified; the tab shows its named title or default name until the program writes one.
- [Two protocol shapes to maintain] → the old envelope is kept only behind capability negotiation and is exercised by conformance for as long as it is offered.

## Migration Plan

1. Archive `program-set-tab-titles`, so its requirements are in the main specs for these deltas to modify.
2. Land server reads and the commit pipeline (decisions 3, 4, 6) with no wire change.
3. Land the title store and projection (decisions 1, 2). On load, a persisted `programTitle` is dropped; the first commit after upgrade writes the file without it.
4. Land change records and the second delta version behind `workspace-changes.v1` (decision 5).
5. Land the client store and renderer changes (decisions 7, 8).
6. Land the gates (decision 9) and the evidence record.

Rollback is by reverting the release. A workspace file written after step 3 has no `programTitle`, which the previous build reads as a terminal with no program title.

## Open Questions

- ADR-0056 says output-driven facts are persisted workspace state whose commits are bounded by time. This design keeps its four trust rules and replaces that one. The adr step records a superseding ADR.
- No in-force ADR says how a workspace change reaches a client or what a client may do in response. The adr step records one.
