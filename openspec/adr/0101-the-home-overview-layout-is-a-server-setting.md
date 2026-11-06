# ADR-0101: The Home overview layout is a server setting

Status: accepted
Date: 2026-11-06

## Context

The Home overview becomes customisable: which widgets show, in what order, and at what size. Home's other presentation state — which section and tabs are open and how they are arranged — is per-device by the workspace-dashboard spec. The owner asked for the overview layout to follow them across devices instead, so that a dashboard arranged on the desktop reads the same on the phone.

## Decision

The overview layout is a top-level server setting, `homeDashboard`, classified `server` in `SETTING_AUTHORITY` and read and written through the working server's `SettingsClient`. It holds only widget ids, sizes, and visibility. It is not on the MCP settings allow-list. Home tab arrangement and section selection stay per-device.

## Consequences

- Every device attached to a server shows that server's overview layout; a window attached to several servers uses the layout of the server it is working in.
- The layout survives reinstalling a client and needs no device storage.
- A server that predates the setting treats the path as transient and drops the write; the default layout shows.
- Concurrent edits from two devices resolve last-write-wins on the whole value.
