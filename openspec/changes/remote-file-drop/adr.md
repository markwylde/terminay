# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (Opus 5.5)
- Change: remote-file-drop

## In-Force ADR Context Reviewed

- openspec/adr/0011 (project-root file services): the browser drop no longer uses `files.create`, so the catalog's project-root invariant is unchanged and no longer receives drop traffic.
- openspec/adr/0017 and 0018: a PTY lives on its server and one window holds many servers. This is why the route depends on the terminal's server.
- openspec/adr/0023-server-owned-clipboard-scratch.md: the pattern followed. The server owns the directory and names, and the client supplies bytes and a name.
- openspec/adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md: the writer is reused, with the same uncapped, streamed, remove-only-incomplete policy.

## Repository-Level ADRs Created

- openspec/adr/0113-dropped-files-are-a-streamed-scratch-write-on-the-terminals-own-server.md
