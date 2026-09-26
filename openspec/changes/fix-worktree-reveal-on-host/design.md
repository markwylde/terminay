## Context

`TerminayGitClient.reveal` calls `host.require("nativeWindows")`, but the
renderer builds its Git client with no capabilities, so the call throws
synchronously and the menu item silently does nothing. Behind it,
`ServerTerminalAuthority` builds `ServerGitAdapter` with no `actions`, so a
reveal that reached the server would fail as unavailable.

The embedded server accepts two kinds of client: its own Desktop windows over
private renderer ports (`acceptRendererPort`, client IDs minted there), and
remote peers over WebRTC or WebSocket. Only the first sits at the machine whose
file manager would open.

## Goals / Non-Goals

**Goals:**

- Reveal works from Desktop windows connected to the embedded server.
- Reveal is not offered to any other client.

**Non-Goals:**

- File and folder **Reveal in OS** in the Explorer, which keeps its opaque
  reveal-token contract.
- Reveal from the standalone server.

## Decisions

- **The server decides who may reveal.** A connection's locality is known with
  certainty only where it was accepted, so the authority records the client IDs
  it mints for renderer ports and passes `canRevealOnHost` to the adapter. A
  renderer-side "is this the Local profile" check was rejected: one window can
  hold Local and remote connections at once, and the renderer would be asserting
  a trust fact it does not own.
- **Listings carry `revealAvailable`.** The worktree list is already a
  per-client query, so the flag costs no new operation and arrives with the rows
  the menu is built from.
- **The path is resolved server-side.** The handler receives opaque IDs, looks
  the worktree up in the server's listing, and hands the path to
  `shell.showItemInFolder`. No path crosses the protocol for this action.

## Risks / Trade-offs

- A Desktop window whose renderer port closes loses reveal until it reconnects;
  its client ID is removed on close, which is the intended fail-closed direction.
