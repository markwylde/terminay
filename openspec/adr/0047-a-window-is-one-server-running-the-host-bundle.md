# ADR-0047: A window is bound to one server; Desktop runs its packaged bundle for it, with compatibility negotiated by the protocol

Status: accepted, supersedes ADR-0018
Date: 2026-10-07
Supersedes: ADR-0018

## Context

ADR-0018 made two decisions at once. It let a window hold many server
connections — one primary and any number of attached — so that one tab strip
could carry projects from several servers. To make that possible it also
replaced ADR-0008's "a window runs the exact bundle its server ships" with one
bundle per window and a real compatibility contract in the protocol hello.

The second decision has held. The first has not paid for itself. Every
surface in the product had to answer "which server?" on its own: Settings,
Extensions, Macros, Recordings, Shell profiles, and Automations select one
behind a picker; Home, the dashboard, badges, and Notifications were to
aggregate. A month on, the aggregating surfaces cover a second server only in
outline, because the renderer works in one server at a time and holds another
server's panels only once the window is switched to it. A person looking at a
window cannot say what it is.

The product's owner has decided the simpler rule is the right one: a window is
one server. Starting a server somewhere new — in a container, on a VM — is
then one more way of adding a server, not a kind of project and not a second
population inside a window.

## Decision

What ADR-0008 established, ADR-0018 kept, and this record keeps:

- Every Terminay Server distribution bundles the complete workspace UI and
  the matching client library for its application-protocol version.
- Desktop and `app.terminay.com` are protocol-blind connection and
  presentation shells. They own bootstrap, credentials, transports, and
  presentation, and give the bundle one opaque byte endpoint and a frozen
  host context. Server code stays sandboxed and origin-bound.

What ADR-0018 established and this record keeps:

1. **Desktop runs the bundle packaged with it for every server.** A remote
   profile supplies a transport and a server identity, never bundle bytes.
   There is no remote bundle download, no per-server bundle cache, and no
   bundle-to-server identity binding. A browser session runs the bundle of
   the server it opened.
2. **Compatibility is a protocol contract, evaluated by the bundle's client.**
   The protocol declares a version range and per-feature capability strings;
   the bundle manifest declares what its client needs; the hello negotiates
   them; the client reports the connection as compatible, degraded, or
   incompatible and sends nothing to an incompatible server. The host checks
   only bundle-to-host boundaries. Every capability string is owned by its
   feature.
3. **Each server owns its workspace.** Projects, panels, layout, terminals,
   settings, macros, recordings, agents, and MCP are owned by their server,
   with one revision and one journal per server. Servers never talk to each
   other.

What changes:

4. **A window is bound to exactly one server.** It holds one connection, and
   everything it shows belongs to that server. There is no primary and no
   attached connection, and no window composition. An unreachable or
   incompatible server is a state of the whole window.
5. **A window's server changes only by the person's explicit act.** On
   Desktop the host can switch a window to another remembered server, or open
   a new window on one, as closed, source-bound actions that name a profile
   id. The host opens the transport and replaces the document; it never
   holds two servers' transports for one window. A failure never moves a
   window.
6. **A window knows nothing about a server it is not showing.** It opens no
   connection to one and shows no state of one beyond the remembered label.
   No surface selects, names, or aggregates servers.
7. **The host remembers which server a window shows** as device-local
   presentation state, beside window geometry, and reopens the window there.

## Rejected alternatives

- **Keep attached connections and finish the aggregating surfaces.** Every
  surface keeps a server dimension, and the tab strip keeps mixing identities
  a person has to read tab by tab. Rejected by the owner as the more
  confusing product.
- **Hold background connections to every saved server for an activity badge.**
  It keeps the connection machinery this decision removes, spends a
  connection per saved server per window, and each server holds at most one
  live connection per device. Left for a later decision, which would want a
  summary a host can read without a full application connection.
- **Return to ADR-0008's server-supplied bundle.** It reintroduces the remote
  bundle download and cache, and gives up the compatibility contract that
  makes an old server readable by a new Desktop.

## Consequences

- Attach, detach, the `(serverId, projectId)` composition, the composition
  store, attached byte endpoints, and the browser manager's attached
  transports are removed. Client-held ids no longer need a server component
  to be unambiguous inside a window.
- "Incompatible" and "offline" are window states, and the connection menu
  must stay usable in them so a person can leave for another server.
- Two servers are seen side by side in two windows, not in one.
- Activity on a server is invisible until a window shows that server.
- Several windows may show the same server. Each is its own connection under
  the same device key, as torn-off windows already were.
- The `connections` host capability shrinks to listing, renaming, and
  forgetting remembered profiles, switching, and opening a window.

## Open items

- Confirm how a server treats two live connections from one device key, which
  two windows on one remote server produce.
- A host-readable activity summary for servers no window is showing.
