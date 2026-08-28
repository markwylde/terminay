# Server-bundled clients and protocol-blind hosts

Status: accepted architecture; delivery evidence is tracked by
[Task 27](../tasks_completed/27-server-bundle-host-contracts.md),
[Task 28](../tasks_completed/28-desktop-server-bundle-host-and-state.md),
[Task 29](../tasks_completed/29-browser-host-and-cross-version-convergence.md),
and [Task 54](../tasks/54-canonical-renderer-runtime-convergence.md).

## Context

Terminay Server owns application state and already distributes a complete,
content-addressed workspace bundle. The browser connection manager can remain
compatible across server application versions by establishing a stable
bootstrap transport and then running the selected server's matching bundle.

Desktop has historically combined four concerns in one renderer/main-process
surface: Local presentation, server feature clients, native-window behavior,
and connection bootstrap. If Desktop continues to ship and run its own full
workspace against remote servers, it must understand every remote application
protocol version and can accidentally retain server state as a second
authority. It also creates a separate browser/Desktop workspace release line.

The product instead needs one workspace implementation that follows the
selected server, while retaining secure native capabilities and protected
connection credentials in each host.

## Decision

Every Terminay Server distribution contains the only full Workspace UI
artifact and the matching `TerminayClient` application-protocol implementation.
Local Desktop, remote Desktop, direct browser sessions, and the browser
connection host all execute that exact verified bundle.

Terminay Desktop and `app.terminay.com` are connection and presentation shells.
They own authentication bootstrap, protected device credentials, transport
establishment, verified bundle installation, execution isolation, connection
profiles, and host-specific presentation. They do not implement workspace
features, decode feature-level application frames, or persist server workspace
state.

This decision creates two independent APIs.

### Server application API

The server-bundled client constructs `TerminayClient` over a bounded opaque
byte endpoint supplied by the host. The same framed `ServerConnection`
semantics run over:

- a private MessagePort for the embedded Local server;
- WebRTC data channels for normal remote access; and
- in-memory transports for conformance tests.

The host may validate the stable framing/size/lifecycle envelope and bind it to
the exact authenticated server, but does not decode or translate feature
operation names, workspace DTOs, command results, or application events.
Application-protocol compatibility therefore belongs to the selected server
and its bundle rather than to the installed host version.

### Host presentation API

The trusted shell injects a frozen, source-bound context only after it binds
the renderer to one server profile and verified bundle:

```ts
type TerminayHostContext = Readonly<{
  bridgeVersion: number;
  hostKind: "browser" | "desktop";
  serverId: string;
  profileId: string;
  capabilities: Readonly<{
    nativeWindows?: { version: number };
    nativeMenus?: { version: number };
    filePicker?: { version: number };
    clipboardWrite?: { version: number };
    notifications?: { version: number };
    updater?: { version: number };
    osIntegration?: { version: number };
  }>;
}>;
```

The concrete schema remains closed and runtime-validated. Capabilities expose
semantic requests, such as opening a shared route with a requested
presentation disposition, rather than `BrowserWindow`, arbitrary filesystem
paths, raw IPC, or server commands. Desktop may satisfy the request with a
native auxiliary window; a browser uses an in-page route or explicit new tab.

Host kind is diagnostic/presentation metadata, not authority. Renderer code
cannot enable Desktop behavior through `mode=electron`, a URL/query value, a
server response, or local storage.

## Bundle ownership and launch

The server UI archive metadata binds the immutable bundle to:

- bundle format and id;
- server and application-protocol versions;
- bootstrap, bundle-format, and host-bridge revision requirements;
- supported host-bridge range; and
- required and optional host capabilities.

The browser manager is a small stable shell. It establishes pairing/reconnect
and WebRTC, performs bounded atomic installation of the authenticated server's
archive, and launches it in the exact server session origin. It never installs
server code in the manager origin, interprets the server's generated asset
inventory, or ships a fallback full workspace.

Desktop Local obtains the bundle from the pinned embedded-server artifact and
does not need a network listener. Desktop remote downloads the bundle through
the authenticated asset channel and commits it to a content-addressed cache
scoped to the exact server identity. Both launch through the same sandboxed
server-UI window composition and receive the same host-context negotiation.
The installed Electron application has no separately evolving Local workspace
renderer.

Development, packaged, signed, and released Desktop builds use this same
server-bundle entry, preload boundary, host-context negotiation, byte endpoint,
workspace hydration, and route composition. Development rebuilds that selected
Local server bundle through a cacheable Turbo task and launches Electron
against the generated files; it does not select a different renderer entry or
authority graph. There is no Electron-only full-workspace entry, fallback
renderer, compatibility workspace client, or environment-based branch that
changes the application architecture.

The shared workspace exposes an in-page File/Edit/View/Help menu only when the
negotiated host lacks native application menus. Desktop advertises and renders
its native application menu, so its server bundle omits the in-page menu and
reserves the native title-bar inset before placing project controls.

## State ownership

| Owner | Durable state |
| --- | --- |
| Terminay Server | Workspace views, projects, panels, terminal sessions, files, Git, settings, macros, recordings, agents, exposure, device authorization, and revisions |
| Desktop shell | Sanitized profiles, OS-protected device credentials, native window geometry, exact window-to-server/view bindings, verified bundle cache, updates, OS permissions, and device-specific preferences |
| Browser manager/session origins | Sanitized manager profiles; origin-partitioned device proof material, verified bundles, and device-specific preferences |
| Workspace renderer | No independent durable server authority; disposable cached projections and transient presentation state only |

A native window binding contains local window identity, server profile identity,
optional server-owned logical view identity, and geometry. It does not contain
projects, panel layouts, terminal data, filesystem paths, server settings, or
application-protocol snapshots.

On the first successful start of a new server data root, the server commits one
initial workspace view, one This server project, one terminal panel, and its
terminal session as a single durable initialization. Later starts restore the
canonical repository and never create a second default merely because a client
window is new, reloaded, or temporarily disconnected. A connected renderer is
not considered ready until the initial or restored snapshot can drive the
project tabs, active terminal, and sidebar queries.

## Compatibility policy

Cross-version launch checks five smaller boundaries independently:

1. pairing/reconnect and signaling bootstrap;
2. framed byte-transport ABI and negotiated resource limits;
3. bundle manifest and asset-transfer format;
4. host-bridge version plus required capabilities; and
5. required and optional host capabilities.

Optional capability mismatch is not a connection failure. The shared UI uses
browser-equivalent in-page behavior or presents a clear unavailable action.
For example, a bundle may offer camera capture while an older Desktop lacks the
required permission/capture capability; the workspace remains usable and the
camera action requests a Desktop update.

An incompatible required boundary fails before the new connection/window is
committed and reports whether the Server, Desktop, or hosted bootstrap must be
upgraded. Hosts publish and retain a bounded compatibility window for deployed
server bundles; compatibility is not an unbounded promise that every historic
bundle runs on every future browser implementation.

## Exposure consequence

**Expose this server…** has one primary meaning: enable server-owned WebRTC
pairing/reconnect while preserving the existing Local connection. A direct
HTTPS/WebSocket network listener is a separate advanced route with its own
explicit lifecycle and handoff. It is not a WebRTC fallback or QR type.

The UI labels a bare stable origin as server/session metadata and labels the
secret-bearing short-lived value as the pairing link. Only the pairing link or
QR is offered to a new device.

## Security consequences

- Remote server code in Electron always runs sandboxed, with context isolation,
  Node integration disabled, and no broad preload.
- Authentication keys, reconnect grants, signaling credentials, and native
  transport objects remain in the privileged host.
- Every host action is closed-schema, source/window/profile-bound, capability
  checked, and user-gesture checked where it reads or changes native state.
- Exact server authentication, archive containment/resource checks,
  compatibility checks, and server identity binding complete before executable
  assets launch. Per-file content hashes are not an additional trust boundary:
  the authenticated WebRTC transport already protects transfer integrity and
  the exact session subdomain isolates the selected server's executable code.
- One server bundle cannot read another profile partition, bundle cache,
  credentials, window bridge, or application transport.

## Rejected alternatives

- **Electron-specific full workspace build:** recreates application-version
  coupling and a second workspace implementation.
- **Renderer-controlled `mode=electron`:** lets untrusted server code claim
  native authority and hides individual capability compatibility.
- **Feature-aware Desktop compatibility adapters:** require the shell to
  understand every server application version and risk a second state
  authority.
- **Development-only Electron workspace renderer:** makes normal development
  test a different product from the packaged artifact and permits startup,
  persistence, host-menu, and lifecycle defects to reach a release.
- **Run every server bundle at the manager origin:** breaks credential and code
  isolation between servers.
- **Treat Local Network as the exposure fallback:** changes transport semantics
  silently and produces an unusable bare-origin journey when WebRTC is absent.

## Required evidence

- One generated bundle id launches through Local Desktop, remote Desktop, a
  direct browser session, and the browser manager.
- An older compatible Desktop shell launches a newer fixture bundle whose
  application operation names it does not recognize, proving opaque forwarding.
- Missing optional host capabilities retain a usable workspace; missing
required revision/capability compatibility fails before launch with a typed error.
- A hostile bundle cannot obtain Node, generic IPC, credentials, another
  profile's partition/cache, or arbitrary native-window authority.
- Restarting either host reconstructs workspace exclusively from server state
  plus its allowlisted local profile/window metadata.
