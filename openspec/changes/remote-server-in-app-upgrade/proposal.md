## Why

Someone connected to a remote Terminay Server has no way to learn that it is out of date, and no way to bring it up to date without opening a shell on that machine and running `terminay daemon upgrade` or pulling a new image. Terminay Desktop already tells its user when a newer build is ready and installs it from the title bar; the server it is connected to deserves the same, and a phone or browser client, which has no Desktop updater at all, has nothing today.

The mechanics mostly exist. `daemon upgrade` already verifies, stages, switches, and rolls back, and terminal sessions already outlive a server restart. What is missing is the server knowing a newer release exists, telling its clients, and accepting an upgrade request from one of them — and a way to carry that out where the server cannot restart itself: a system-scope service running as an unprivileged account, and a container whose image is fixed.

## What Changes

- A standalone server checks its own release channel for a newer release and reports the result to every connected client.
- The header's connections control carries a warning icon when the active tab's server has an upgrade available, and the connection menu offers **Upgrade server…** on each attached server that has one.
- A confirmation names the running and available versions, says the connection drops briefly, and, on a container server with the Docker socket mounted, lets the user choose between upgrading in place and recreating the container.
- Any paired device may start the upgrade. The client names only the server and, on a container, which of the two modes; never a version, URL, or path.
- The server carries its own upgrader: the `terminay` CLI ships inside the server archive, so an upgrade needs no npm, registry, or system Node on the server host.
- User-scope installs upgrade as the account the server already runs as.
- System-scope installs upgrade through a root-owned helper that `daemon install` and `daemon upgrade` write: a systemd path unit that starts a fixed, argument-free upgrade when the server asks for one.
- Container servers upgrade in place: the new release is staged on the data volume and the entrypoint, which stays the container's main process, restarts the server on the newest verified release. Terminals keep running, and the upgraded release is the one that runs after every later container restart.
- A container with the Docker socket mounted can also be recreated on the newer image, which ends its terminals. Mounting the socket is documented as optional and as granting the container's terminals control of the host's Docker daemon.
- `daemon upgrade` inside a container performs the in-place upgrade instead of refusing.
- The outcome of an upgrade, including a rollback, is reported to clients when they reconnect.
- The embedded Local server never reports an upgrade; it is updated with Terminay Desktop.

## Capabilities

### New Capabilities

- `server-upgrade`: how a standalone server learns a newer release exists, reports it, authorizes and carries out an upgrade a client asks for, and reports the outcome.

### Modified Capabilities

- `daemon-cli`: the upgrader ships in the server archive; system-scope installs gain the root-owned upgrade helper; `daemon upgrade` works inside a container by staging on the data volume; the wording of what an upgrade may touch in the data root narrows from "nothing" to "no server state".
- `connections-and-client-hosts`: the header connections control and the connection menu show an available server upgrade and offer the action.
- `server-runtime-and-protocol`: the container entrypoint supervises the server and selects the release to run.

## Impact

- `apps/terminay-server/`: release check, upgrade status publication, the upgrade operation, spawning the upgrader, reading the outcome at startup.
- `packages/protocol` and the workspace client: an optional `server.upgrade` capability, a status subscription, and one operation.
- `apps/terminay-cli/`: helper units in `unit.ts`/`install.ts`/`upgrade.ts`; a container upgrade path in place of the refusal in `context.ts`; an upgrade outcome record.
- `scripts/standalone-artifact.mjs` and the archive manifest: the CLI becomes part of the server archive.
- `Dockerfile`, `docker/terminay-server-entrypoint`: supervising entrypoint and release selection.
- `src/App.tsx`, `src/workspace/RemoteAccessConnectionMenu.tsx`: icon, menu action, confirmation dialog, progress.
- `docs/operations/standalone-server.md`: in-app upgrade, the helper, the optional Docker socket mount and its risk.
- New outbound HTTPS from a standalone server to the project's GitHub releases. No terminal, workspace, or device data is sent.
- New timer: an hourly release check while at least one client is attached, which ADR-0028 requires the owner to approve (recorded in `design.md`).
