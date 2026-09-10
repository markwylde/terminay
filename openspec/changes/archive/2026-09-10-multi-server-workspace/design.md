## Context

Every window today is bound to one server, runs that server's exact bundle,
and holds one `TerminayClient`, one workspace snapshot store, one agent status
store, and one session transport singleton. Two specs and ADR-0008 forbid a
window from running one server's bundle against another server, because the
protocol has never had to negotiate anything: `PROTOCOL_MIN_VERSION` and
`PROTOCOL_MAX_VERSION` are both 1, and the hello capability list is five
coarse strings.

Server-side, each server already owns exactly one workspace with its own
revision counter, event journal, startup restore, settings, macros,
recordings, MCP socket, and agent projection. Nothing needs to merge on a
server for a window to show tabs from several of them.

Constraints that stay: hosts are protocol-blind; credentials never enter the
workspace UI; the browser manager frames one session origin (ADR-0012);
Desktop runs server UI in a sandboxed, origin-bound partition (ADR-0005);
credentials cross only transport-authenticated data channels (ADR-0013).

## Goals / Non-Goals

**Goals:**

- One window, one bundle, many server connections, with project tabs
  interleaved across servers.
- A compatibility contract that is honest per server and degrades to a
  visible, inert state rather than a failed window.
- No new authority: each server keeps owning its own workspace; the client
  owns only composition.
- Delete Desktop's remote-bundle download and cache.

**Non-Goals:**

- Moving a project or panel between servers.
- A "home" server that knows about other servers. Servers never talk to each
  other.
- Merging settings, macros, or recordings across servers.
- Federated identity. Each server keeps its own pairing and device registry.

## Decisions

### The client owns composition, each server owns its workspace

A window's composition is an ordered list of `(serverId, projectId)` tab
handles plus the set of attached connections, each attached to one workspace
view on its server. It is device-local presentation state, in the same class
as window geometry and the window-to-server/view binding the specs already
allow the host to persist. It is never sent to a server.

Alternative rejected: the primary server owns a workspace that references
projects on other servers and routes to them. That is project environments
with a different transport, and it makes the primary a routing hop for other
servers' terminals, which the protocol-blind and no-second-authority rules
exist to prevent.

Boundary: workspace state ownership. This decision adds one client-owned list
and moves nothing server-owned to the client.

### Compatibility is negotiated per connection by the bundle's client

The protocol package gains a real version range and per-feature capability
strings (`workspace.v1`, `terminal.v1`, `files.v1`, `git.v1`, `agents.v1`,
`settings.v1`, `macros.v1`, `recording.v1`, `dictation.v1`, and so on). The
bundle manifest declares the protocol range and required capability set the
bundle's client needs from any server. `client_hello` carries them;
`server_hello` answers with the server's version and capability set; the
client computes one of **compatible**, **degraded** (optional capability
absent), or **incompatible**, and the UI shows it per connection.

An incompatible connection stays attached, its tabs render greyed with the
server's version and which side to upgrade, and no operation is sent to it.

The host does not evaluate this. It keeps checking only the bundle-to-host
boundaries it checks today (bootstrap, bundle format, host bridge,
capabilities). The bundle-to-server identity binding (`bundleId` must equal
the server's bundle id) is deleted.

Alternative rejected: gate on application major version. It is coarser than
the protocol, invisible to the protocol, and wrong whenever a server minor
adds a capability the bundle needs.

Boundary: the protocol contract between an untrusted bundle and a server. The
server still validates every envelope; a bundle that lies about capabilities
gains nothing it could not already send.

### Desktop runs its packaged bundle for every connection

The bundle Desktop ships is the embedded Local server's bundle. Every window
runs it. Remote profiles supply a transport, not a bundle. The remote bundle
download, the content-addressed per-server cache, and the "Desktop never runs
its Local renderer against a remote server" rule are removed. Desktop's
compatibility window with older servers is therefore the packaged bundle's
declared protocol range, which the release process must keep at least one
protocol version wide.

Boundary: ADR-0008's launch rule. Superseded by the adr step.

### The browser runs the opened server's bundle

The manager frames the primary server's session origin and installs that
bundle, unchanged. Attached servers deliver no bundle. The framed bundle asks
the manager for attached connections through the framed-host message schema;
the manager, which already holds every origin's device credential in its
vault, opens the transport and hands back a `MessagePort` byte endpoint. First
pairing with a new server still happens at that server's session origin.

Alternative rejected: let the primary origin's code drive WebRTC and signing
for another server. That puts one server's code on another server's credential
path. Handing over a byte endpoint gives the primary bundle data-plane access
to the attached server, which is inherent in "one UI", but keeps the
credential and the transport authentication in the manager.

Boundary: ADR-0013's credential path and ADR-0012's framed host. The manager
grows one responsibility, opening transports for attached servers, and gains
no application-protocol knowledge.

### Hosts hand out byte endpoints through a `connections` host capability

The host bridge gains one versioned capability: list connection profiles with
status, open a connection (returns an opaque byte endpoint), close it, and
subscribe to status. Desktop main implements it over its existing per-profile
transport code; the web manager implements it over the framed-host schema.
The session transport singleton in the bundle becomes a registry keyed by
connection.

### Client state is keyed by connection

`WorkspaceSnapshotStore`, the agent status store, activity aggregation,
feature clients, and event subscriptions are instantiated per connection and
reached through a connection context. Every id the client holds becomes
`(serverId, id)`; ids are per-server namespaces and may collide across
servers. Routes and deep links carry the server id.

### Cross-server surfaces select or aggregate; they never merge

Settings, Macros, Recordings, Shell profiles, and Extensions show a server
selector defaulting to the active tab's server. Home dashboard, activity
badges, and the agent sidebar aggregate rows from every attached connection,
each row keyed by server and project. Dictation targets the terminal's
server. MCP remains one socket per server.

### Detached and unreachable servers keep their tabs

A connection that is offline, reconnecting, unauthenticated, or incompatible
keeps its tabs in the strip, greyed and inert, so the composition is stable.
Detaching a server removes its tabs from the composition and closes nothing on
the server.

## Risks / Trade-offs

- [`App.tsx` assumes one `currentServerId` in roughly six thousand lines] →
  the connection context is introduced first with a single connection, and
  the multi-connection tab strip is switched on only after every consumer
  reads its client from the context.
- [Capability strings are only useful if they are maintained] → each feature
  client owns its capability constant next to its operation names, and a test
  asserts every registered operation belongs to a declared capability.
- [The packaged Desktop bundle can drift ahead of a server the user has not
  upgraded] → that is the incompatible state, shown per tab, not a broken
  window. Release policy keeps the bundle's declared range at least one
  version wide.
- [Browser attached connections move transport work into the manager] →
  scheduled last; Desktop multi-connection ships without it.
- [Id collisions across servers] → composite keys everywhere; a test attaches
  two servers restored from the same data-root copy.

## Migration Plan

None for users. Desktop's per-server bundle cache directory is deleted on
first start of the new version. Rollback is reverting the change.

## Open Questions

- ADR-0008's rule that hosts run only the selected server's bundle must be
  superseded; the adr step records the replacement and restates what remains
  (server-bundled UI, protocol-blind hosts, host-supplied transports).
