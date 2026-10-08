## Why

Terminay Desktop will not start when its data directory sits at a long path. The window shows "Terminay could not open this workspace. Terminay could not finish starting. Relaunch to retry", relaunching fails the same way, and nothing on screen says why. The cause is that Desktop creates its MCP control socket inside the data directory, and a Unix socket's path is limited to about 104 bytes on macOS and 108 on Linux. A data directory chosen with `TERMINAY_USER_DATA_DIR`, or the ordinary one under a long home directory, pushes `terminay-mcp-control.sock` past that limit and `listen` fails with `EINVAL`.

It was found by launching a development build with its data directory inside a deep scratch folder, and it fails that way every time. The session holder already knows about this limit and steps aside when its own socket would not fit; the Git command socket was given a short path on purpose. The control socket is the one local socket that was never checked, and it is the one whose failure stops the whole application.

## What Changes

- Desktop works out where its MCP control socket goes before it listens. When the path inside the data directory fits the platform limit, the socket stays there, exactly as today.
- When that path does not fit, the socket goes in a short, owner-only directory outside the data directory, named for the data directory so that the same data directory always gets the same socket path. Terminals that outlive a relaunch keep an address that still works.
- Desktop refuses to use that directory unless it is a real directory owned by the user and closed to everyone else, so nothing another user prepared can stand in for it.
- When no usable path exists, Desktop says so in the launch recovery state: that the data directory's path is too long for a local socket, what the path and the limit are, and that a shorter data directory fixes it. The technical detail is still recorded in diagnostics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: where the local control endpoint's socket lives when the data directory's path is too long for one, the conditions under which a directory outside the data directory may hold it, and what Desktop reports when the endpoint cannot be placed.

## Impact

- `electron/main.ts`: `getMcpControlSocketPath` is replaced by a resolved placement computed once at startup and used both for the endpoint and for the address handed to terminals.
- A new pure module beside the control endpoint (`apps/terminay-server/src/mcp/`) that resolves the placement and checks the fallback directory, reusing the length limit the session holder already defines in `packages/server-core/src/sessionHolder/paths.ts`.
- The launch recovery path in `electron/main.ts`, which gains a specific message for this failure.
- New unit tests for the resolver and an end-to-end test that starts Desktop with a long data directory.
- No protocol command, capability token, registration entry, or stored state changes. The address reaches terminals through the same launch-environment value as before.
- A new ADR records where a local socket may live.
