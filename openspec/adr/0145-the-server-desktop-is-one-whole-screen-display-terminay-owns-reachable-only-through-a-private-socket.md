# ADR-0145: The server desktop is one whole-screen display Terminay owns, reachable only through a private socket

Status: accepted
Date: 2026-11-27

## Context

A headless standalone server has no display, so graphical programs started from
its terminals cannot run. Bots already have a virtual desktop: Xvnc inside the
bot's container, relayed as RFB over the Terminay connection and drawn with
noVNC. The server's own account has nothing equivalent.

Users first wanted one Terminay window per application window. RFB carries a
screen, not windows, so that needs a different mechanism. Four were examined:

- Placing each window in a private cell of one hidden screen and cropping the
  framebuffer per Terminay window. Override-redirect menus and drag icons cross
  any gutter and grab the pointer, applications restore their own geometry, and
  Xvnc's framebuffer is capped at 16,384 pixels per axis.
- Xpra. Stock Debian 13 does not package it; the upstream package starts a root
  proxy on TCP 14500 when installed; its browser client cannot be embedded
  without a fork; it allows command start, file transfer, and shell by default.
- `x11vnc -id` per window. Its manual says menus and transients may be clipped
  and that it may crash when a window is obscured or resized.
- A capture bridge of our own. This is a new remote-desktop protocol.

The machine may already have X or VNC sessions and configuration that belong to
its operator.

## Decision

1. The server desktop is **one X screen streamed whole** and shown in one
   Terminay window. A window manager on that screen manages application
   windows. Terminay does not present application windows individually.
2. Terminay **starts and supervises its own display server** (TigerVNC's
   `Xtigervnc`) as a process of the server account on the server's own host. It
   never connects to, configures, or reuses a display, VNC session, or per-user
   VNC configuration it did not create.
3. The display server has **no TCP or UDP listener**. Its RFB listener is a unix
   socket in the server's owner-only runtime directory (ADR-0054), and the
   server is its only client. X11 clients are admitted by an authority cookie
   in an owner-only file that is never placed in arguments or logs.
4. Pixels and input reach a client **only through the Terminay connection**,
   through the same relay and message allowlist as the bot desktop.
5. The display server **cannot open a network connection**. A host where that
   cannot be arranged does not get a server desktop; there is no fallback.
6. The display number is a preference (765). A number in use by a display
   Terminay does not own is left alone and another is chosen.
7. The desktop session starts **no network service of its own**. A helper that
   listens on a port, as the bot desktop's control service does, is not part
   of the server desktop.
8. The display outlives a restart of the server process. The server adopts a
   running display only from a supervising process that completes a
   credential handshake, as the PTY session holder does, never from a process
   id or path recorded on disk. A kernel-held lock (ADR-0055) keeps that
   supervisor single.

## Consequences

- Everything needed to stream the desktop already exists and is exercised by
  bots; the new work is supervision, authority, and setup.
- Users switch between application windows inside the desktop, not between
  Terminay windows.
- Terminay shares the system's display-server packages. It isolates what runs
  and what is configured, not the binaries.
- The X socket lives in `/tmp/.X11-unix` because `DISPLAY=:n` requires it, so
  the cookie, not the path, is the X11 access control. It is the one desktop
  file outside Terminay's own directories.
- The server and its terminals must share the host's temporary directory. An
  install whose service has a private one cannot host the desktop.
- A program on the display cannot make the display server send the screen to
  another host. Hosts that cannot deny the display server network access are
  unsupported, even when everything else would work.

## Open items

- The socket-only listener, the network-denied launch, and the session
  starting without a login session were shown in
  [the spike](./evidence/server-desktop-spike.md) on Debian 12 and 13 under
  the installer's unit and in the official image, with stand-in scripts for
  the holder. The same checks with the product itself remain to be recorded.
