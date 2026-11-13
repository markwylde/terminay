# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude
- Change: terminal-osc52-clipboard

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer and terminal content are untrusted; the change adds no privileged surface and reuses the validated `clipboard.write` bridge action.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the handler lives in the shared workspace bundle, so Desktop and browser hosts get it from the server they connect to.
- openspec/adr/0023-server-owned-clipboard-scratch.md - concerns pasting images into a server; this change is the opposite direction and creates no server-side clipboard state.
- openspec/adr/0056-terminal-output-reaches-workspace-state-only-as-sanitised-display-text.md - OSC 52 is acted on only in the client and never becomes workspace state.
- openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md - the query form is never answered, so no clipboard content is written into a PTY.

## Repository-Level ADRs Created

- openspec/adr/0112-terminal-output-may-write-but-never-read-the-viewing-devices-clipboard.md - live terminal output may write the viewing device's clipboard through the existing semantic write route, never read it; replayed output never writes; a connection-host setting turns it off.

## Notes

The decision grants untrusted, possibly remote, terminal output an effect on the client device, so it is recorded durably rather than only in this change.
