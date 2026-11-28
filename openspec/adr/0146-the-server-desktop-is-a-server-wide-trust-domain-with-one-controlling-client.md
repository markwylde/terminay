# ADR-0146: The server desktop is a server-wide trust domain with one controlling client

Status: accepted
Date: 2026-11-27

## Context

Project/window and terminal-session boundaries are security boundaries
(ADR-0011, ADR-0047, ADR-0048). The server desktop (ADR-0145) cannot honour
them. Every program the server account runs, from any project, draws on the
same screen, can read it, and can inject input into it. RFB delivers the whole
framebuffer to every viewer.

A client that holds an ordinary Terminay connection can already start a
terminal and run any program as the server account. Every approved remote
device connects with administrative scope, so scope does not tell one paired
device from another. A separate per-device desktop grant was considered and
rejected by the owner: pairing is where trust is decided, and a client past it
effectively has a shell.

What the owner will not accept is any way to reach the desktop that does not
pass through that pairing.

## Decision

1. **Pairing is the trust point.** Every Terminay connection with write
   authority and no narrowing claim may view and control the server desktop
   and start its setup. This is the same rule as the bot desktop.
2. Connections narrowed to a project, terminal session, capability, chat, or
   MCP principal are refused. They are deliberately less than a full Terminay
   connection, and refusals do not reveal the desktop's state.
3. **Nothing outside the Terminay connection reaches the desktop.** This is
   the boundary that is enforced (ADR-0145); the ones below are stated, not
   enforced.
4. The server desktop is **one trust domain for the whole server**. Terminay
   does not present it as belonging to a project, window, or terminal, and the
   desktop window says it is shared.
5. Same-account processes, **including agents running in terminals**, can use
   the display directly through X11. The authority check governs remote
   viewing through the protocol, not local X11 access.
6. Streams are bound to the authorized connection, a mode, and a generation.
   Authority is revalidated on each read and write, and a revoked device's
   stream closes.
7. **At most one control stream exists.** Others are view-only, with input,
   clipboard, and resize refused by the server. Takeovers are serialized, and
   when a control stream ends, the server releases every key and button it
   held before admitting other input.
8. The desktop's on and off state is changed only by dedicated desktop
   operations under this authority, never by the generic settings operations.

## Consequences

- Every paired device can see every project's graphical programs. Users who
  need separation run separate servers.
- An agent in one project can observe or drive a graphical program started
  from another. That is already true of files and processes under the same
  account.
- Two devices cannot fight over the pointer; the second must take control.
- The relay must track pressed keys and buttons per control stream and hold
  its own connection to the display to release them.
- Per-project desktops were rejected: they share one account, so they would
  suggest an isolation they do not provide.
