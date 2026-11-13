# ADR-0113: A dropped file becomes a path on the terminal's own server, through a third named scratch write

Status: accepted
Date: 2026-11-13

## Context

A terminal's PTY runs on its server (ADR-0017), and one Desktop window can show terminals from several servers (ADR-0018). Desktop inserted the native path of a dropped file whatever the terminal's server was. That path is valid only on the Local server, so a remote shell or an agent in it got a path it could not open. The browser client uploaded drops through `files.create` into the project root (ADR-0011), where they dirtied `git status` and were limited to 4 MB.

ADR-0023 (clipboard images) and ADR-0046 (window attachments) already turn client bytes into a server path. The server writes into a scratch directory it owns, chooses every name, and accepts only bytes and an offered name, never a path. Each feature gets its own named directory and its own operation-level bounds.

## Decision

1. **Where the terminal runs decides the route.** A Desktop drop on a terminal whose server is Local inserts native paths and copies nothing. Every other drop, from Desktop or a browser, is copied to the terminal's server. A client-local path is never inserted for a remote terminal. If a copy is impossible, the drop fails visibly.
2. **Dropped files are a third named scratch write**, `terminay-drops` under `os.tmpdir()`. Each drop gets a server-created folder, and each file keeps a sanitised form of its offered name so tools recognise its type. The operations (`terminal.drop-begin`, `-part`, `-finish`, `-cancel`) are authorised like the clipboard image command: write scope, project claim, and the live session that will receive the paths. They are advertised as `terminal-file-drop.v1`.
3. **Streamed, uncapped, removed only when incomplete**, as in ADR-0046. Files travel in bounded, acknowledged parts. There is no total size limit, and the person can watch progress and stop. A stopped, failed, foreign or idle upload is removed. A delivered file is left for the OS temporary-file cleaner.
4. **Browser drops no longer write into the project.** Adding a file to a project is the file explorer's job, and it goes through the catalog.

## Consequences

- The same gesture gives a usable path on every client and every server.
- A reviewer of filesystem mutations now has four buckets: project catalog operations, clipboard scratch, attachment scratch and drop scratch. There is still no client-chosen absolute path.
- A long-lived server accumulates dropped files in its temporary directory until the OS clears it.
- Desktop smart paste of copied files and clipboard images still writes Electron-local paths. Bringing it onto the terminal's server is a separate decision.
