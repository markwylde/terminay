## Context

Desktop creates its MCP control endpoint in `startMcpControlEndpoint` (`electron/main.ts`), on a socket whose path is `getMcpControlSocketPath()`: `terminay-mcp-control.sock` inside Electron's `userData` directory. The same function supplies the address every terminal receives in its launch environment (`CONTROL_SOCKET_ENV`), which is how an agent's stdio adapter finds the endpoint.

`sockaddr_un.sun_path` is 104 bytes on macOS and 108 on Linux, terminator included. Node reports a longer path as `EINVAL` from `listen`. `startMcpControlEndpoint` rethrows, the readiness chain rejects, and Desktop shows its general launch recovery state. Retry relaunches into the same failure.

The default data directory on macOS is `~/Library/Application Support/Terminay`, which leaves the control socket at about 74 bytes for a short user name. It reaches the limit with a home directory around 30 bytes longer, and immediately with any deep `TERMINAY_USER_DATA_DIR`.

Two neighbours already deal with the limit:

- The session holder (ADR-0035) defines `SESSION_HOLDER_MAX_SOCKET_PATH_BYTES = 103` and `socketPathFits` in `packages/server-core/src/sessionHolder/paths.ts`. `isSessionHolderEnabled` returns false when a holder socket would not fit, so a deep data directory runs without a holder instead of failing.
- The Git command socket (ADR-0052) is created in the system temporary directory under a short hashed name, "short on purpose".

The control endpoint (`apps/terminay-server/src/mcp/controlEndpoint.ts`) creates its socket's parent directory with mode `0700`, tightens it with `chmod`, removes a stale socket only if the existing path is a socket, and sets the socket to `0600` after listening. The endpoint resolves every request from a per-terminal capability token (`mcp-server`, "Capability token scope and lifecycle"), so the socket's permissions are a second barrier, not the only one.

Terminals can outlive Desktop (ADR-0035, `terminals-survive-restart`). A terminal launched before a relaunch still holds the address it was given, so the address must not change between launches.

## Goals / Non-Goals

**Goals:**

- Desktop starts whatever the length of its data directory's path.
- Nothing changes for a data directory at an ordinary path: same socket, same place.
- The address a terminal was given stays valid across relaunches.
- When Desktop still cannot place the socket, the user is told what is wrong and what fixes it.

**Non-Goals:**

- Moving the control socket out of the data directory in general. The data directory stays the first choice.
- The session holder's sockets. A holder that does not fit is already switched off; giving holders a runtime directory is a separate decision about where held terminals live.
- The standalone server's `approval.sock`. Its command-line client derives the path from the data root and would need the same resolution on both ends; it is noted under Open Questions.
- Running without MCP when the socket cannot be placed. See decision 5.
- Windows, where the endpoint is a named pipe with no such limit.

## Decisions

### 1. The address is a pure function of the data directory, known before anything listens

A pure function resolves the socket's placement from the data directory, the platform, the user's runtime directory and the temporary directory, and returns either a placement (`path`, and whether it is in the data directory or a runtime directory) or throws a typed failure carrying the paths and byte lengths involved. Both `startMcpControlEndpoint` and `getTerminalControlEnv` use it, so the endpoint and the address given to terminals cannot differ.

The address has to be available without the endpoint: Desktop can launch a terminal before the endpoint is listening. The first version of this change resolved the placement when the endpoint started and gave terminals whatever had been resolved by then, and every terminal launched early was started with no address at all; the end-to-end suite caught it. So the terminal's address comes from the pure function, and only the check of a runtime directory on disk waits for the endpoint to start.

It lives beside the endpoint, in `apps/terminay-server/src/mcp/`, and imports the limit and `socketPathFits` from the session holder's `paths.ts` so there is one definition of the limit. The function does no I/O; checking the runtime directory on disk is a second, small function, so the length logic is testable without a filesystem.

Alternative considered: catch `EINVAL` from `listen` and retry elsewhere. Rejected because `EINVAL` from `listen` has other causes, and because the address has to be known before the first terminal is launched, not after a failure.

### 2. The data directory first, a runtime directory only when it does not fit

When `<data directory>/terminay-mcp-control.sock` fits, it is used. This keeps today's behaviour, and today's trust argument, for almost everyone.

When it does not fit, the socket is `control.sock` in a directory named `terminay-` followed by the first 12 hex characters of the SHA-256 of the data directory's absolute path. That directory is created in `XDG_RUNTIME_DIR` when that variable names an absolute path, and in `os.tmpdir()` otherwise. On macOS the temporary directory is the per-user `/var/folders/…/T`, about 49 bytes, which leaves the socket path near 83. On Linux `XDG_RUNTIME_DIR` is the per-user `/run/user/<uid>`.

Alternatives considered:

- **Always use a runtime directory.** One code path, but it moves every user's socket out of the data directory for the sake of a few, and macOS clears files it has not seen used from the temporary directory.
- **A random directory per launch (`mkdtemp`).** Immune to someone preparing the path in advance, but the address would change on every launch and strand the terminals that survive one.
- **A symbolic link at a short path pointing into the data directory.** The socket would stay in the data directory, but both `listen` and every client's `connect` are subject to the limit, so every client would need the short path too; it adds a link to manage and removes nothing.

This crosses a boundary and is recorded as an ADR: until now every local socket with a fixed address lived inside the data directory, which the code treats as the owner-only trust boundary for them (`approvalSocket.ts` says so in as many words; ADR-0011 is the general model). A runtime directory is a second place a socket may live, and the conditions in decision 3 are what make it equivalent.

### 3. A runtime directory is used only if it is ours and closed

Because the name is derived from the data directory, another local user could create it first in a shared temporary directory. Before listening, the directory is checked with `lstat`: it must be a directory, not a symbolic link, owned by the process's user id, with no group or other permission bits. If it does not exist it is created with mode `0700`. If it exists and fails a check it is not used, not changed, and not removed; startup fails with the reason (decision 4).

The endpoint's existing `chmod(parent, 0o700)` would otherwise silently "repair" a directory owned by the user but open to others. For a runtime directory the check comes first and the answer is refusal, because a directory that was open may already hold something that is not ours. The data directory keeps its existing tightening.

The capability token remains the authority for every request. These checks protect the listener's address from being taken over; they are not what authorizes a caller.

### 4. A failure to place the socket has its own message

The resolver's typed failure, and a refused runtime directory, are mapped to a message for the launch recovery state:

> Terminay's data directory is at a path too long for a local socket. The socket would be at `<path>` (`<n>` bytes; the limit is `<limit>`). Start Terminay with a shorter data directory.

and, when a runtime directory was refused, a second sentence naming it and why. The existing recovery path already distinguishes nothing; this adds one recognised cause ahead of the general message, the way `explain-locked-data-root` did for a locked data root on the standalone server. The launch recovery state records the message it shows, so diagnostics carry the same paths, lengths and reason as text; no second record is written. The recovery state ordinarily shows at most 320 characters of a message, and this one names paths, so it is given room for 2,000. Neither the message nor the record carries a token.

### 5. Desktop still does not start without its control endpoint

If no placement is usable, startup fails with the message above. The alternative, starting with MCP switched off, would leave a user whose agents cannot reach Terminay with no visible cause, and would need a new state on the MCP settings surface and in terminal launch. With decision 2 in place the remaining failures are a temporary directory at a very long path or a runtime directory someone else owns, both of which the user should hear about.

### 6. The limit is counted in bytes

`socketPathFits` already uses `Buffer.byteLength`. The resolver uses it for both candidates, so a data directory with multi-byte characters is measured as the kernel measures it.

## Risks / Trade-offs

- [macOS removes files from the per-user temporary directory that have not been used for some days, which could remove a runtime directory's socket under a long-running Desktop] → Only data directories that do not fit are exposed, and the Git command socket (ADR-0052) already lives there under the same policy. If it proves a problem in practice the endpoint can re-create its socket when it finds it gone; that is left out until it is seen.
- [A data directory that moves from fitting to not fitting, by being renamed or moved, changes the socket's address] → A moved data directory already invalidates every terminal's environment in other ways. Within one data directory path the address is stable.
- [Twelve hex characters of a hash can collide] → 48 bits across the data directories of one user on one machine. A collision would have two Desktops contend for one socket, which the single-instance lock per data directory does not prevent; the second would fail to listen and report it.
- [The message tells the user to choose a shorter data directory, which a user who never chose one cannot obviously do] → That user's data directory is under their home directory, and with decision 2 they no longer reach the message at all unless the temporary directory is also unusable.
- [An end-to-end test with a long data directory depends on the test machine's temporary directory being short enough] → The test builds its long path inside the workspace it is given and asserts the socket's directory is outside it; the resolver's unit tests cover the arithmetic with injected directories.

## Migration Plan

None. A data directory whose socket fits is untouched. One that did not fit could not start before and has nothing to migrate.

## Open Questions

- The standalone server's `approval.sock` is derived from the data root on both the server and its command-line client. It can hit the same limit. Whether it should use the same resolver, on both ends, is left for a follow-up once this one has run.
- Whether the session holder should use a runtime directory instead of switching itself off for a deep data directory. No in-force ADR needs revisiting for this change.
