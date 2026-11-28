# ADR-0147: Bot and server desktops share one remote-desktop package and differ only in connector and authority

Status: accepted
Date: 2026-11-27

## Context

The bot desktop's implementation is spread across the bot service
(`botService/rfb.ts`), the client core (`botIo.ts`), the renderer
(`src/workspace/bots/`), and the bot image (`terminay-desktop-session`). The
server desktop (ADR-0145) needs the same RFB relay, the same client-message
allowlist, the same viewer, the same clipboard rules (ADR-0129, ADR-0133), and
the same XFCE session.

The relay's allowlist and view-only enforcement are security controls. Two
copies would have to be kept in step by hand.

The two desktops do differ in two ways. A bot desktop is reached through a
container exec tunnel and a VNC password; the server desktop through a unix
socket. A bot stream is bound to one bot; a server desktop stream is
server-wide (ADR-0146). The bot session also runs services the server desktop
must not, such as a desktop-control service on a loopback port.

## Decision

1. One package, `packages/remote-desktop`, holds the RFB relay and filter, the
   pull byte-stream client and RFB channel, the viewer and clipboard sharing,
   and the desktop session script and configuration. Both desktops use it.
2. Each desktop supplies its own **connector** (how the relay reaches the
   display server) and its own **authority and wire operations**. `bots.*`
   operations and bot stream authority are unchanged; the server desktop has
   `server.desktop.*`.
3. A behaviour that differs between the two is a **named option of the shared
   code**, never a fork of it. Resize admission and the session's extra
   services are such options, and each defaults to off.
4. A future desktop of any kind uses this package.

## Consequences

- A fix to the filter or the clipboard rules reaches both desktops.
- The bot image's build context now takes its session script from the shared
  package, so the image fingerprint includes it.
- Bot wire compatibility is untouched, at the cost of two operation namespaces
  over one stream mechanism.
- Making the server desktop a pseudo-bot was rejected: it would inherit
  container assumptions and the wrong authority.
