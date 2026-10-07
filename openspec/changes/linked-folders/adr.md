# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-08
- Reviewer: Claude (for Mark Wylde)
- Change: linked-folders

## In-Force ADR Context Reviewed

- openspec/adr/0002-sqlite-state-repository.md - describes a SQLite repository; the wired workspace backend is a JSON file. Not revisited here; the schema migration is written against the backend in use.
- openspec/adr/0011-security-trust-boundary-model.md - project and terminal-session boundaries; the two new ADRs say where a folder sits against each.
- openspec/adr/0020-per-operation-canonical-roots.md - a folder root is canonicalized once per operation and never cached, the same as the project root.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - bounds the one-off working-directory sweep used for capture.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - the agent-session directory and ancestry binding are the primary capture signal.
- openspec/adr/0028-no-polling-without-owner-approval.md - the folder reconciler consumes the existing worktree-registry watch and adds no timer.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - pull-request and check facts on folder rows come from the same host-owned facts.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - MCP scope is unchanged; a folder is never an MCP input.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - folder Dockviews are project panel hosts; Home's stays separate.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md - a folder move is deliberately not a re-home.
- openspec/adr/0045-the-mcp-adapter-may-read-a-document-the-agent-names.md - not widened by folder roots.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md and openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - tab peek reads the snapshot of the window's own server.
- Remaining in-force ADRs (0003, 0005, 0006, 0010, 0012, 0013, 0015, 0016, 0017, 0019, 0023, 0026, 0027, 0033-0039, 0041, 0042, 0044, 0046) reviewed; not touched by this change.

## Repository-Level ADRs Created

- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - a folder is a server-owned workspace object that carries no authority; moving a panel between folders never re-homes a terminal.
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - a project's file and Git operations may be contained in a linked folder's worktree, resolved and confirmed by the server per operation.

- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - Terminay does not hook into, configure, or modify an agent, and a feature may not depend on which agent is in the terminal; installing the Terminay MCP server is the one approved exception.
- openspec/adr/0052-terminals-report-git-commands-to-the-server-through-git-trace2.md - Terminay sets Git's Trace2 variables in its terminals and reads the stream to learn which terminal ran a Git command; nothing is stored, the stream is untrusted, and the user's own tracing wins. Approved by the owner.

## Notes

- No existing ADR is superseded. ADR-0043 and ADR-0020 are extended by the new ADRs, not changed. ADR-0025's passive detection is explicitly left in force by ADR-0051.
- ADR-0051 came out of this change's spike: the first capture design depended on agent behaviour and the owner stopped it.
- How a newly created worktree is attributed to a terminal is in `design.md`, decision 6. The owner declined the tracing mechanism at first, asked for the alternatives to be explored, including how another tool handles it, and then approved it; ADR-0052 records the alternatives.
- `openspec/adr/README.md` gains index rows for 0049 to 0052.
