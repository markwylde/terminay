# ADR-0018: One workspace bundle drives many server connections, with compatibility negotiated per connection by the protocol

Status: accepted, supersedes ADR-0008
Date: 2026-09-09
Supersedes: ADR-0008

## Context

ADR-0008 made every server ship the only full workspace UI, and made Desktop
and browser hosts protocol-blind shells that run the selected server's exact
bundle. Its launch rule, "a window runs the bundle its server ships and never
another", was how the product avoided cross-version protocol negotiation: the
application protocol has one version and five coarse capability strings, and
nothing has ever had to negotiate.

That rule binds a window to one server. With ADR-0017 every remote is a
Terminay Server, and the product wants a single window whose project tabs come
from several of them. A window cannot run several bundles, so one bundle has
to talk to servers it did not come from. The protocol already carries a
version range and a capability set in its hello; they just have to mean
something.

## Decision

What ADR-0008 established and this record keeps:

- Every Terminay Server distribution bundles the complete workspace UI and
  the matching client library for its application-protocol version.
- Desktop and `app.terminay.com` are protocol-blind connection and
  presentation shells. They own bootstrap, credentials, transports, bundle
  installation, and native presentation, and never decode application frames
  or persist workspace state.
- Hosts supply the bundle an opaque byte endpoint per connection and a
  frozen, source-bound host context; server code runs sandboxed and
  origin-bound (ADR-0005); credentials cross only transport-authenticated
  channels (ADR-0013); the browser manager frames the session origin
  (ADR-0012).

What changes:

1. **One bundle per window, many connections.** A window has one primary
   connection, whose bundle it runs, and any number of attached connections.
   Desktop's primary is always its embedded Local server, so Desktop runs the
   bundle packaged with it for every connection and downloads no remote
   bundle. A browser session's primary is the server the manager opened;
   attached servers deliver no bundle.
2. **Compatibility is a protocol contract, evaluated per connection by the
   bundle's client.** The protocol declares a real version range and
   per-feature capability strings. The bundle manifest declares the range and
   required capabilities its client needs from any server. The hello
   negotiates them; the client reports each connection as compatible,
   degraded, or incompatible, and sends nothing to an incompatible server. The
   host does not evaluate this and keeps checking only bundle-to-host
   boundaries.
3. **Hosts hand out transports through one `connections` host capability.**
   List profiles with status, open a connection to an opaque byte endpoint,
   close it, subscribe to status. Desktop main implements it over its
   per-profile transports; the browser manager implements it over the
   framed-host schema and opens attached transports itself, so no server's
   code is on another server's credential path.
4. **The client owns composition; each server owns its workspace.** The tab
   strip is an ordered list of `(serverId, projectId)` handles plus the
   attached set, persisted by the host as device-local presentation state.
   Projects, panels, layout, terminals, settings, macros, recordings, agents,
   and MCP stay owned by their server, with one revision and one journal per
   server. Servers never talk to each other.

## Rejected alternatives

- **A home server that owns a workspace spanning other servers.** That is
  ADR-0009's environment routing with a different transport and makes one
  server a routing hop for another's terminals.
- **Gate attachment on application major version.** Coarser than the
  protocol, invisible to it, and wrong whenever a minor release adds a
  capability the bundle needs.
- **One frame per server with the tab strip in the host.** Preserves every
  ADR-0008 invariant but makes the host a workspace surface, which it must not
  be, and gives up a single React tree for a single window.
- **Let the primary origin drive WebRTC and signing for attached servers.**
  Puts one server's code on another server's credential path.

## Consequences

- Desktop's remote bundle download, per-server bundle cache, and the
  bundle-to-server identity binding are deleted.
- The packaged Desktop bundle's declared protocol range is Desktop's
  compatibility window with older servers; release policy keeps it at least
  one version wide, and a server outside it shows as incompatible per tab
  rather than as a failed window.
- Every capability string must be maintained by the feature that owns it; a
  test asserts every registered operation belongs to a declared capability.
- Every client-held id becomes `(serverId, id)`. Ids are per-server
  namespaces and may collide across servers.
- Cross-server surfaces select or aggregate and never merge: Settings, Macros,
  Recordings, Shell profiles, and Extensions choose a server; Home, activity
  badges, and the agent sidebar aggregate rows keyed by server.
- The browser manager gains one responsibility, opening attached transports,
  and no application-protocol knowledge.

## Open items

- Desktop multi-connection ships before browser attached connections.
- A conformance fixture attaches two servers restored from one data-root copy
  to prove composite keys.
