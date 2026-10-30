# How libuv creates a named pipe on Windows

Spike 1.1 of `native-windows-desktop`, for ADR-0081. Script:
`scripts/windows-spikes/named-pipe.mjs`.

- Date: 2026-10-30
- Runner: GitHub `windows-latest`, runs 41101066460 and 41104297080 of
  `markwylde/terminay-windows-tests` (job `named-pipe`), as `runneradmin`
- Node: v24.15.0; libuv 1.51.0

## Method

A `net.Server` listened on `\\.\pipe\terminay-spike-<pid>`, and a second
server tried to bind the same name. The pipe's security descriptor was then
read as SDDL. It was read through `koffi`, from a handle opened for
`READ_CONTROL` only. Clients then connected:

- through `\\.\pipe\…`;
- through `\\localhost\pipe\…` and `\\<hostname>\pipe\…`, which take the SMB
  redirector path that a client on another machine takes.

## Results

| Check | Result |
| --- | --- |
| First bind | ok |
| Second bind to the same name | `EADDRINUSE` (libuv sets `FILE_FLAG_FIRST_PIPE_INSTANCE`) |
| Security descriptor | `O:BA D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;BA)(A;;FR;;;WD)(A;;FR;;;AN)` |
| Local client | served |
| `\\localhost\pipe\…` client | served |
| `\\<hostname>\pipe\…` client | served |

The DACL is Windows' default for a named pipe:

- full access for SYSTEM, Administrators and the creator's owner SID;
- read-only access (`FR`) for Everyone and Anonymous.

The runner's account is an administrator, so its owner SID is Administrators;
for an ordinary account it is the user. Neither the descriptor nor the client
results show `PIPE_REJECT_REMOTE_CLIENTS`.

A connection as a second local account was also attempted, through
`Start-Process -Credential`. It could not be started on the hosted runner, so
the result above rests on the descriptor rather than on that connection.

## Consequences for the design

- **Squatting is refused.** A name that is already taken fails the bind, so a
  holder or control endpoint never shares a name with a squatter. It fails
  instead, and the name must not be predictable to another user before the
  owner binds it.
- **Other users cannot write.** Node opens a pipe for read and write, and only
  this user, SYSTEM and Administrators hold write access. A read-only opener
  receives nothing: the holder speaks only after the client's challenge, and
  the control endpoint only after a request.
- **Remote clients are not refused by the pipe.** A client on another machine
  that authenticates over SMB as this user, or as an administrator, is
  served. Node exposes no server-side pipe handle, so
  `GetNamedPipeClientComputerNameW` cannot be called on an accepted
  connection, and design decision 4's fallback cannot be built on `net`. A
  "refuses clients on another machine" requirement therefore needs either a
  pipe created outside libuv, or a narrower contract: only this user's
  principal can connect, and a holder still admits only a peer that proves the
  credential.
