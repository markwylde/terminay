## Context

`terminay daemon upgrade` (`apps/terminay-cli/src/commands/upgrade.ts`) already resolves the installed channel, verifies the archive's SHA-256 sidecar and Ed25519 signature, stages it under `versions/`, stops the unit, switches `current`, starts the unit, waits for readiness, and rolls back. The unit carries `KillMode=process` and shells live in the detached session holder (ADR-0035), so a restart drops connections and nothing else.

Three things are missing, and three places cannot use the existing path as it stands:

- The server never learns a newer release exists. It knows its own version (`TERMINAY_SERVER_VERSION`, the archive manifest) and nothing about the channel.
- No protocol surface carries that to a client, or an upgrade request back.
- The header connections control and connection menu have nowhere to show it.
- A **system-scope** service runs as an unprivileged account with `NoNewPrivileges=true`. It cannot `systemctl stop` its own system unit or write `/opt/terminay`.
- A **container** server is the image's `/opt/terminay`, started by an entrypoint that `exec`s it. The CLI refuses `upgrade` there (`context.ts`, `TERMINAY_MANAGED_BY=container`), and recreating the container ends every terminal.
- The upgrader is an npm package. A server host is not guaranteed to have npm, and fetching code from a registry at the moment a remote client clicks a button is a supply-chain step the release signature does not cover.

In-force ADRs that constrain this: 0011 (trust boundaries), 0016 (signed per-architecture archives, side-by-side versions, `current` pointer), 0027 (the renderer only reads update status and asks; it never names a version or URL), 0028 (no polling without the owner's approval), 0035 (session holder owns PTYs), 0047/0048 (a window is one server; a connection belongs to a window and authority to a device), 0055 (kernel-held data-root lock).

## Goals / Non-Goals

**Goals:**

- A client of any kind sees that the server it is using has a newer release, and can start the upgrade.
- The upgrade is the existing verified stage/switch/rollback path everywhere it can be.
- Terminals survive on systemd and in a container.
- An upgraded container keeps running the upgraded release across restarts.
- The client cannot choose what gets installed.

**Non-Goals:**

- Automatic, unattended upgrades. A person always confirms.
- Release notes in the confirmation. The Desktop "What's new" dialog is not reused here.
- Upgrading the embedded Local server; Desktop's updater owns that binary.
- Changing a server's channel, or downgrading, from a client.
- Refreshing a container's base OS layer. An in-place upgrade replaces the server release only; the image's packages change when the operator pulls a newer image or chooses recreate.
- Windows or macOS standalone servers; the CLI is Linux-only.

## Decisions

### 1. The server checks its own channel

The server performs the check by running the upgrader its own release ships: `<release>/bin/terminay daemon upgrade --check`. What the installed channel is, when a `main` build was published, which scope the install has, and whether a helper exists are all facts the CLI already owns (the install record, the layout, the container releases directory). Asking it keeps one implementation of release resolution and one of "what can this machine do", instead of teaching the server the install layout. The launcher exports the CLI's path as `TERMINAY_UPGRADER`; a server without it (embedded, or run from a checkout) offers no upgrade.

The check prints one JSON line, which is the whole contract between the two:

```
{ "schemaVersion": 1,
  "environment": "user" | "system" | "container",
  "installed": { "channel", "version", "revision" },
  "available": null | { "version", "revision"?, "publishedAt"? },
  "canUpgrade": boolean,
  "modes": ["in-place"] | ["in-place", "recreate"],
  "trigger": { "kind": "spawn" } | { "kind": "request-file", "path" },
  "unavailable": null | { "reason", "command" },
  "lastResult": null | { "from", "to", "outcome": "succeeded" | "rolled-back", "reason"?, "at" } }
```

A source install prints `available: null`, `canUpgrade: false`. The command exits zero whenever it could describe the install, including when the release metadata could not be fetched, in which case it adds `"checkError"` and omits nothing else; the server then keeps its last known `available`.

*Alternative: a shared resolution module imported by both.* The CLI is published to npm compiled, not bundled, so it cannot import a workspace package, and making the server depend on the CLI package would pull the installer into the server's dependency closure for one function while still leaving the install facts on the other side.

*Alternative: Desktop checks on the server's behalf.* Rejected. Browser and phone clients would never see it, the client would have to be told the server's channel and architecture, and it would put release resolution in the untrusted renderer or in a host that ADR-0047 keeps protocol-blind.

**Boundary crossed:** a standalone server gains an outbound HTTPS request to `api.github.com`/`github.com`. It sends no body and no identifying query; the server id is not in the request. Hosted services stay data-blind because none is involved.

### 2. When the check runs — an owner-approved poll (ADR-0028)

No event source exists for "a GitHub release was published" that a server behind NAT can receive. The check therefore runs:

- once at server start (event),
- when a client attaches and the last result is older than one hour (event, on demand),
- every hour while at least one client is attached (**a poll**).

The poll is owned by "at least one client attached": armed on the first attach, cleared on the last detach, so a server nobody is using makes no requests (ADR-0028 decision 6).

**Owner approval:** Mark Wylde approved the server polling GitHub releases for its channel on 2026-10-11, answering "Yes" to "Should the server itself poll GitHub releases for its channel and tell every client (so phone and browser see the icon too)?". He approved the one-hour interval the same day, answering "Yes" to "Approve the server re-checking GitHub releases every hour while at least one client is attached (ADR-0028 needs your word on the interval)?". The code site cites ADR-0028 and this change.

*Alternative: on demand only (start and attach).* Honours ADR-0028 without approval, but a Desktop left attached for a week would never show the icon.

### 3. An optional `server.upgrade` capability carries status one way and one operation back

- **Status** is server-owned live state published to every attached client and republished on change: `{ version, channel, available?: { version }, canUpgrade, modes: ('in-place' | 'recreate')[], unavailable?: { reason, command }, upgrade: none | in-progress | outcome }`. It is not workspace state and is not persisted in the workspace journal.
- **Operation** `server.upgrade.start { mode }`. Strict schema: any other field is a rejection, in line with "untrusted client input" in `server-runtime-and-protocol`. The server resolves the target itself, exactly as ADR-0027 decision 5 does for Desktop.

The capability is optional in the bundle manifest, so an older server is simply "compatible, no upgrade surface" and an older client ignores the status.

**Boundary crossed:** device → server administrative action. Authorization is "any authenticated paired device". This grants nothing new: a paired device already has a shell as the server's account. What it must not gain is a way to choose the code that runs, which is why the operation carries only a mode.

### 4. The CLI ships inside the server archive

`scripts/standalone-artifact.mjs` adds the built CLI and a `bin/terminay` wrapper that runs it on the archive's own Node. The artifact manifest lists it, so `verifyArchive` covers it. The image already copies the CLI to `/opt/terminay-cli`; it moves to the archive's copy so there is one.

The CLI that performs an upgrade is the one from the **currently running** release, as with `npx terminay daemon upgrade` today. A bug in an old upgrader is therefore fixed only by a manual upgrade with a newer CLI; the npm package stays published for that.

*Alternative: `npx terminay daemon upgrade` at click time.* Rejected: needs npm and registry access on the host, and executes unsigned-by-us code selected at runtime.

### 5. User scope: spawn the upgrader detached

The server spawns `<prefix>/current/bin/terminay daemon upgrade --user` in its own session (`setsid`, stdio to a log file in a private temporary directory; the server does not know the prefix and writes nothing new into the data root, so the durable account of what happened is the outcome record of decision 9). `KillMode=process` leaves it alive when the unit stops; detaching keeps the server's own shutdown from ending it. The user unit's environment already has what `systemctl --user` needs.

### 6. System scope: a root-owned path unit, not polkit or sudo

`daemon install --system` writes:

- `terminay-upgrade.path` — `PathChanged=<request file>`, enabled.
- `terminay-upgrade.service` — `Type=oneshot`, root, `ExecStart=/opt/terminay/current/bin/terminay daemon upgrade --system`.

The request file sits in a root-created directory that only the run-as account can write. The server touches it; systemd starts the oneshot. The oneshot never opens the file.

**Boundary crossed:** an unprivileged account causes a root process to run. What bounds it: the command line is fixed in a root-owned unit; every executed file is under the root-owned prefix (`/opt/terminay`), never the data root; the upgrade follows the recorded channel, verifies the signature, and refuses a downgrade. The worst a compromised run-as account can do is cause an upgrade to the newest signed release, which is what the operator's own `daemon upgrade` does.

*Alternatives.* A polkit rule allowing the account to manage the unit: needs polkit, which minimal servers lack, and still leaves `/opt/terminay` unwritable. A sudoers entry: blocked by `NoNewPrivileges=true`, which we keep. Making the prefix writable by the run-as account: turns "can open a shell" into "can replace the server binary root starts", and is rejected outright.

### 7. Containers: the image is a baseline, the data volume may carry a newer release

The entrypoint stops `exec`ing the server and supervises it:

```
entrypoint (PID 1, stays up)
  loop:
    release = marked release on the data volume, if it verifies
              and is not older than /opt/terminay; else /opt/terminay
    run release/bin/terminay-server "$@"      (forward SIGTERM/SIGINT)
    if a restart was requested -> loop
    else exit with the server's status
```

Staged releases live in `<data root>/releases/{versions/,current,restart-requested,upgrade-result.json}`. This directory holds release files only; the server's database, vault, and identity are elsewhere in the data root and the upgrader never opens them. The data volume is used because it is the one volume every existing container already has, it survives recreation, and it works with a read-only root filesystem.

"Not older than the image" makes a pulled newer image win over a stale staged release, which the next upgrade's retention then removes. Ordering is semver for tags. A `main` build has no ordering in its manifest, so the mark records the image revision it was staged over: while the image is still that revision the staged build is newer by construction, and once the image is a different revision the operator has pulled one deliberately and it wins.

Selection logic runs on the image's own Node from a small script the image owns, not from the staged release, so a damaged staged release cannot break startup.

**Boundary crossed:** the container's terminal account can write the directory the entrypoint executes from. Inside the official image that account already has passwordless sudo, so no boundary is weakened; re-verifying the manifest at selection guards against corruption, not against that account.

The `daemon-cli` requirement "the data root SHALL NOT be modified by the CLI during upgrade" is narrowed to "SHALL NOT read or write server state in the data root", which is what it protected.

*Alternative: recreate the container for every upgrade.* Ends every terminal and needs the Docker socket; kept only as the explicit second mode below.

### 8. Recreate mode, when the Docker socket is mounted

Offered only when the socket exists and answers. The server inspects its own container, resolves the image reference (the same reference when it is a moving tag such as `latest` or `main`; the reference with the tag replaced when it is a version tag), pulls it, and starts a short-lived helper container from the **new** image with the socket mounted. The helper stops and renames the old container, creates the replacement from the inspected configuration, waits for its health check, and removes the old one, or on failure removes the replacement and restores and starts the old one.

A helper is needed because a container cannot survive its own removal.

**Boundary crossed, and the risk to state plainly:** a mounted Docker socket gives every process in the container, including every terminal a paired device opens, control of the host's Docker daemon, which is root on the host. Terminay does not narrow that. The runbook presents the mount as optional, with this sentence, and in-place stays the default and the preselected choice.

### 9. Outcome survives the restart as a record beside the versions

The upgrader writes `upgrade-result.json` next to `versions/` (the prefix on systemd, the releases directory in a container). The server reads it at startup and folds it into its status until the next check or attempt. It is written by the upgrader and read by the server, never the reverse, so the server's own state stays the only thing the server writes.

### 10. Client presentation

The warning icon reuses the header's existing icon slot beside the server label; the menu row and confirmation use the shared modal frame (ADR-0053). The drop and return use the existing reconnecting presentation; nothing new is drawn for the gap. The existing requirement that the control carries no exposure icon or count pill is untouched: this is a different, conditional indicator.

## Risks / Trade-offs

- [Mounted Docker socket is host root for every terminal] → opt-in, documented with that wording, never required, in-place preselected.
- [A recreate installs an image the release signature does not cover] → it pulls the same repository and tag style the operator created the container from, refuses a digest-pinned container, and is the trust the operator already placed in that registry; in-place stays the signed path and the default.
- [Waiting for the replacement container to become healthy] → the helper listens to the engine's event stream under one deadline; there is no wait-until-ready loop (ADR-0028).
- [The upgrader that runs is the old release's] → an upgrader bug cannot be fixed by the upgrade it performs; the npm CLI remains the manual escape, and the helper's command line stays minimal so it rarely needs to change.
- [Run-as account can trigger upgrades at will] → bounded to the newest signed release on the recorded channel; never a downgrade; one at a time.
- [`main` installs upgrade to whatever merged last] → the confirmation names the channel; nothing is automatic.
- [Recreate on a Compose-managed container drifts from the Compose file's image tag] → labels are preserved so Compose still recognises the container; the runbook says to update the file. In-place has no such drift.
- [Image tag no longer states the running version after an in-place upgrade] → `daemon status`, the server's status, and `--version` all report the release actually running.
- [GitHub rate limits unauthenticated API calls per address] → one request an hour per attached server, and a failed check keeps the last result.
- [Server and client disagree mid-upgrade because the client bundle is served by the server] → the reconnect loads the new server's bundle through the existing bundle-snapshot path; no new handling.
- [Rollback itself fails] → the outcome record and status say the previous version was started but is not ready; the client shows its ordinary offline state with that reason once reachable.

## Migration Plan

- Existing **user-scope** installs gain in-app upgrade after one manual `terminay daemon upgrade` to a release that carries the CLI in its archive.
- Existing **system-scope** installs need one manual `sudo terminay daemon upgrade`, which writes the helper units. Until then the server reports the upgrade as available but not self-serviceable, with that command.
- Existing **containers** need one pull-and-recreate onto an image with the supervising entrypoint. After that, in-place works.
- Rollback of this change: the helper units and the releases directory are inert without a server that uses them; `daemon uninstall` removes the units.

## Open Questions

- **Knowing the published `main` revision cheaply inside a fresh container.** An installed service compares publish times from its install record; a container that has never upgraded has none. Resolved during implementation from what the rolling release already publishes.
- **ADR-0028 open item "Desktop update check, hourly"** is still unapproved in that ADR; this change does not touch it.
