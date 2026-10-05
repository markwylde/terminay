# ADR-0040: Home tabs are device-local presentation hosted in their own Dockview

Status: accepted
Date: 2026-10-05

## Context

Every panel in a project is a canonical server object. The renderer adds a
Dockview panel only after the server creates it, turns a Dockview removal into a
server close, removes any Dockview panel the server does not know, and expresses
layout to the server as named commands rather than as a Dockview document. That
is what lets one workspace render on a desktop and a phone at once, and it is
part of the project and terminal-session boundary that remote access and MCP
rely on.

Home is not a project. It needed tabs — sections, automations, editors, run
logs — that a user can keep open, arrange, and return to. Three ways to give it
them were considered:

- Make Home a reserved project on the server, so the existing panel machinery
  applies. One device's Home tabs would then appear on every other device, and
  presentation with no meaning to the server would become shared workspace
  state.
- Reuse the project Dockview wiring in the renderer with a flag marking panels
  that are not server objects. Every lifecycle path that closes or reconciles a
  panel would have to honour the flag, and one miss sends a close for something
  that is not a panel.
- Give Home a separate Dockview with its own, much smaller, wiring.

## Decision

1. **There are two kinds of tab host.** A project's Dockview holds server-owned
   panels. Home's Dockview holds Home tabs, which are renderer presentation of
   things the server owns elsewhere (automations, runs, terminals) or of nothing
   at all (sections).
2. **The two never share lifecycle code or panels.** Home's host does not use
   the project panel lifecycle, adoption, or reconciliation, and a tab cannot be
   dragged from one host to the other.
3. **Closing a Home tab closes a view, never a thing.** Anything destructive is
   an explicit action inside the tab, sent through the same authorised client
   operation as before.
4. **Home's arrangement is client-owned device-local state.** It may be stored
   on the device as a serialised Dockview document. It is never sent to a
   server, is read back as an untrusted hint that is filtered against what still
   exists, and is never needed to recover anything.
5. **The rule against Dockview documents for workspace state stands.** It
   applies to server-owned project layout and is not relaxed by this decision.
6. **Home tabs are identified by a typed descriptor**, not by a server panel id,
   and a descriptor that names a server object is closed when that object is
   gone.

## Consequences

- Home can gain new kinds of tab without any server or protocol change.
- Home's arrangement does not follow a user between devices.
- A serialised Dockview document is now a format the renderer must tolerate
  across Dockview upgrades; a document that fails to load is discarded.
- Features built on server panels — the dashboard inventory, the compact
  switcher, MCP terminal tools, remote mirroring — do not see Home tabs, and
  must not be taught to.
- Anything that should be shared between devices or visible to agents must be a
  server object first; putting it in a Home tab does not make it one.
