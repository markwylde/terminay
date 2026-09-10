# Standalone Server operations

This guide describes the foreground `terminay-server` process and the
operator boundaries around it. The server is a supported standalone artifact
on GNU/Linux x64 and arm64 with a Debian 12-compatible userspace. It does not
daemonize itself, and a service manager must supervise the foreground process.

The supported way to install, upgrade, and pair one is the `terminay`
command-line installer — `npx terminay daemon install` — documented under
[Installing and upgrading](#installing-and-upgrading). The manual procedure is
its fallback, for hosts the CLI does not support.

Server-installed extensions follow the canonical
[extension operations](./extensions.md) runbook. Supported artifacts include
the pinned internal npm installer; extension packages are fetched from npmjs.
Operators do not install system Node/npm or place packages in a project
checkout. Extension packages, receipts, data, and encrypted secret references
live under the configured server data root.

## Configuration and paths

Command-line options take precedence over environment variables. A missing
option uses the documented default:

| Setting | Command-line option | Environment variable | Default |
| --- | --- | --- | --- |
| Stable server identity | `--server-id ID` | `TERMINAY_SERVER_ID` | `local-server` |
| Canonical data root | `--data-root PATH` | `TERMINAY_DATA_ROOT` | `.terminay` |
| Local endpoint policy | `--endpoint VALUE` | `TERMINAY_ENDPOINT` | `loopback` |
| Structured log destination | `--log-sink PATH` | `TERMINAY_LOG_SINK` | host-selected |
| Matching server UI bundle | `--ui-bundle PATH` | `TERMINAY_UI_BUNDLE` | host-selected |
| Reported server version | *(none)* | `TERMINAY_SERVER_VERSION` | `0.0.0` |
| Hosted signaling domain | `--hosted-domain DOMAIN` | `TERMINAY_HOSTED_DOMAIN` | `terminay.com` |
| Exposure enabled at startup | `--expose MODES` | `TERMINAY_EXPOSE` | `off` |
| Advertised direct signaling origin | `--direct-origin URL` | `TERMINAY_DIRECT_ORIGIN` | *(unset)* |

The data root is the server's authority boundary. Keep it on a local disk
with owner-only permissions, back it up as one unit, and do not put it below a
project checkout. Project files and explicitly configured recording roots may
remain outside this directory. The current runtime accepts the configured
paths at composition time; packaging is responsible for creating directories
and applying platform permissions.

The foreground readiness record may include the configured data and log paths
so a local operator can find them. `--status` is intentionally redacted: it
reports phase, identity, version, runtime mode, the enabled exposure modes by
name, and whether paths/bundles are configured, but not their values, the
direct origin, or workspace data. Do not redirect readiness
or diagnostics to a public endpoint.

## Foreground commands

```sh
terminay-server --help
terminay-server --version
terminay-server --status --data-root /var/lib/terminay
terminay-server --pairing --data-root /var/lib/terminay
terminay-server --data-root /var/lib/terminay --log-sink /var/log/terminay/server.jsonl
```

`--pairing` asks the running server, through the owner-only socket in its data
root, for the pairing handoff it is currently advertising, and prints one line
per enabled exposure mode. It mints nothing of its own: a pairing room only
exists once the server has registered it, so this command fails with a clear
message when no server owns the data root, and reports `"exposure":"off"` when
the server was never exposed. It never prints a private key, durable browser
credential, or application token.

Each device that opens a pairing link must then be approved on this server:
the foreground process logs an `approval-pending` line with the device name, a
five-character match code, and an approval id, and the operator compares the
code with the one on the device and runs one of:

```sh
terminay-server approvals --data-root /var/lib/terminay
terminay-server approve <approval-id> --data-root /var/lib/terminay
terminay-server deny <approval-id> --data-root /var/lib/terminay
```

These commands talk to the running server through an owner-only socket inside
the data root, so anyone who can approve a device already owns the data root.
`terminay-server reset-identity` (with the server stopped) rotates the host
key and revokes every paired device; each one must pair again.

Stop the foreground process with `SIGTERM` for a bounded graceful shutdown.
`SIGINT` is equivalent for an interactive terminal. A supervisor must not
start a second process against the same data root while the first one is
stopping.

## Installing and upgrading

The supported install path is the `terminay` command-line installer. The
manual procedure below it remains available for hosts the CLI does not
support, and is the fallback rather than the default.

### The `terminay daemon` installer

```bash
sudo npx terminay daemon install
```

The CLI resolves a version, verifies it, lays it out on disk, drives systemd,
and puts pairing and approval in one terminal. It does not bundle the server:
it fetches a distribution at install time. It supports GNU/Linux x64 and arm64
with systemd, and refuses to run anywhere else with a message naming the
requirement.

| Command | What it does |
| --- | --- |
| `daemon install [ref]` | Resolve, verify, unpack, write the unit, start, wait for readiness |
| `daemon upgrade [ref]` | Follow the installed channel, stage beside, switch, roll back on failure |
| `daemon status` | Unit state, version, channel, readiness, exposure modes |
| `daemon start` / `daemon stop` | Wrap the unit and wait for readiness or exit |
| `daemon qr-code` | Terminal QR, pairing URLs, and the approval prompt |
| `daemon approvals` / `approve <id>` / `deny <id>` | The same approvals, non-interactively |
| `daemon reset-identity` | Rotate the host key and revoke every device |
| `daemon uninstall [--purge]` | Remove the unit and versions; keep the data root unless purged |

#### Version references

`install` with no reference takes the newest tagged release. `vX.Y.Z` takes
that tag. `main` takes the rolling prerelease, which is published under the
tag `main-latest` — a release tagged for the default branch would make `main`
ambiguous in every clone. Any other branch or commit is built from source on
the target, after a preflight for `git`, `python3`, `make`, and a C++
compiler; the resulting manifest records the built commit and a `source`
channel.

`upgrade` with no reference re-resolves whatever channel the machine is
already on, so a box tracking `main` never silently moves onto the tag stream.
A source install has no ordering the CLI can trust, so it must be told what to
move to.

#### Verification

Every downloaded archive is checked against its published SHA-256 sidecar and
then against its detached Ed25519 signature, using a public key committed to
the CLI's own source. There is no flag or environment variable that skips it:
the boundary crossed is "release pipeline → operator's machine", and that key
is the only thing making the download trustworthy. A release that cannot be
signed is a release to block, not a check to relax. A source build has no
publisher and therefore no signature, but its manifest is still verified.

#### Install scope and the run-as account

Scope is prompted on a terminal with system scope preselected, and must be
given as `--system` or `--user` when there is no terminal. A system install
needs root and writes to `/etc` and `/opt`; a user install writes under the
invoking account's home and enables login lingering so the service survives
logout.

In system scope the CLI also asks which account the server and its terminals
run as. **This is the security decision in the command**: the daemon's PTYs
run as that account, so the choice decides whose files, keys, and agents a
paired device can reach. A dedicated `terminay` system account is preselected
and created if absent; `--run-as <user>` names an existing login user instead,
and is checked before anything is written.

#### Layout

| Path | System scope | User scope |
| --- | --- | --- |
| Prefix | `/opt/terminay` | `~/.local/share/terminay` |
| Versions | `<prefix>/versions/<version>` | same |
| Active version | `<prefix>/current` (symlink) | same |
| Install record | `<prefix>/install.json` | same |
| Environment file | `/etc/terminay/server.env` | `~/.config/terminay/server.env` |
| Data root | `/var/lib/terminay` | `<prefix>/data` |
| Unit | `/etc/systemd/system/terminay-server.service` | `~/.config/systemd/user/terminay-server.service` |

Installed versions are immutable once verified; the CLI never edits a file
inside a versioned directory. `current` is replaced by rename, so an interrupt
at any point leaves it pointing at a complete version. Upgrades keep the
active version and one previous, which is what a rollback restores.

The environment file is readable only by the run-as account and never carries
a vault passphrase, a device key, or pairing material — those live in the data
root, which is the trust boundary. The server id is written once and never
rewritten, because it is the identity paired devices know the machine by.

#### Exposure and the direct origin

Exposure defaults to `hosted,direct`. The direct origin is derived from the
machine's primary address, which is right for a host with a routable address
and wrong for one behind NAT — so the derived value is printed at install and
`--direct-origin https://<host>:<port>` overrides it. `--expose`, `--port`,
`--hosted-domain`, and `--project-root` set the rest.

#### Reaching a server in a local container

A server in a container on your own machine is not reachable from a client on
that machine by default, and the failure is silent: signalling succeeds, the
client finds the server, and the connection then sits in `checking` until it
gives up.

The reason is that every address the server can see about itself is one the
client cannot route to. On macOS and Windows the container runs inside a Linux
virtual machine, so its address exists only in that VM — `--network host` does
not change this, because the host is the VM. If both ends are also behind one
NAT, their reflexive addresses share a public address and would need router
hairpinning, which consumer routers usually lack.

`--advertise-address` answers this by naming an address the client *can* reach —
this machine's routable address, on which the published port answers — and
offering it as an additional candidate. It must be a routable address, not a
loopback one: a browser decides for itself which candidates are worth probing,
and Firefox prunes a remote loopback candidate without sending a single
connectivity check. A loopback address therefore produces a server that pairs
from Chromium and hangs elsewhere, so the CLI refuses one.

```bash
docker run -d --name terminay \
  --privileged --tmpfs /run --tmpfs /run/lock \
  --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 51000-51003:51000-51003/udp \
  node:24-bookworm \
  /bin/sh -c 'apt-get update -qq && apt-get install -y -qq systemd dbus && exec /lib/systemd/systemd'

docker exec -it terminay bash
npx terminay daemon install --system --run-as root \
  --advertise-address 192.168.1.20:51000
npx terminay daemon qr-code
```

Pair from the printed URL as you would with any server; signalling goes through
the hosted service exactly as it does for a remote one.

Four consecutive UDP ports are published rather than one. The WebRTC runtime
gives each candidate its own socket from the range it is pinned to, and rejects
a range of a single port. Publishing the range means whichever socket the
advertised address takes is reachable.

That range is a budget: a host with more local addresses than the range has
ports offers fewer of its own than it would unpinned. The advertised address
always keeps its port. The addresses given up are the ones the client was not
reaching anyway, which is the situation that made the option necessary.

This is for a server reachable only at a forwarded address. It is not a general
answer to NAT: it works because someone forwarded a port, not because the
server discovered a way through.

#### Pairing from the terminal

`daemon qr-code` (alias `daemon pairing-url`) asks the running server for its
live pairing URLs over the data root's owner-only socket, renders a terminal
QR for the direct URL when direct exposure is on and the hosted URL otherwise,
prints every URL with its expiry, and then waits. When a device requests
enrollment it shows the device name and match code and asks for approval; a
room seconds from expiring is replaced and the code redrawn. `--no-wait`
prints and exits, and `--mode hosted|direct` selects which URL is rendered.

Approval still happens only on the host, and the match code is still compared
by a human. The CLI never prints a host key or a device key.

### Installing by hand

Where the CLI cannot run, the archives are installable directly. Each Linux
architecture has one self-contained
`terminay-server-<version>-linux-<arch>.tar.gz`, published with a `.sha256`
sidecar and an Ed25519 `.sig` beside it. The archive carries its own pinned
Node runtime, the compiled server, the production dependency closure including
the native `node-pty`, the matched UI bundle, and the selected WebRTC runtime,
so the target needs neither Node nor a compiler. Merges to the default branch
also publish a rolling `main` channel under stable asset names on the
`main-latest` prerelease. Verify the sidecar and the signature before staging,
and compare `revision` in the archive's `artifact-manifest.json` — not
`version` — to decide whether the rolling channel moved. The full contract is
in the [release install and update policy](./release-update-policy.md), and the
[systemd example](#systemd-linux) below is the unit the CLI writes.

## Exposure

A standalone server is not remotely reachable until it is configured to be.
`--expose` is that decision, standing for the data root:

| Value | Effect |
| --- | --- |
| `off` (default) | Not remotely reachable. |
| `hosted` | Registers with the hosted relay under `--hosted-domain`. |
| `direct` | Serves its own signaling endpoint at `--direct-origin`. |
| `hosted,direct` | Both, sharing one room, one host key, and one device registry. |

**Hosted exposure** provisions a stable session origin under
`--hosted-domain` (default `terminay.com`) and persists it in the data root as
`remote-session-origin.v1.json`, so paired devices reconnect across restarts
without pairing again. Changing the hosted domain mints a new origin.

**Direct exposure** serves the signaling endpoint from this process at
`/signal` on the origin `--direct-origin` names, so no hosted relay is
involved. It requires the authenticated HTTP listener, and `--http-port` must
be the port that origin advertises:

```sh
terminay-server \
  --data-root /var/lib/terminay \
  --expose direct \
  --http-host 0.0.0.0 --http-port 8443 \
  --direct-origin https://box.example.test:8443
```

**Direct mode is authenticated by the server host key, not by TLS.** The
listener presents a certificate the server generates into its own data root
(`direct-tls.v1.json`, owner-only). A client verifies the host key's signature
over the transport transcript and the DTLS fingerprints before any credential
crosses, exactly as it does for the hosted relay; the certificate plays no
part in that decision and is not something to distribute or pin. An attacker
who controls the network path to the endpoint can deny service or relay opaque
DTLS packets, and nothing more.

Browsers cannot accept that self-signed listener, so direct mode is for
Terminay Desktop. Operators who want browser access keep a reverse proxy with
a real certificate in front, as before.

Both modes advertise the same one-time pairing room and differ only in the
origin a client reaches it through. A hosted link takes the form
`https://app.<hosted-domain>/?s=<session-id>&hostName=…#<secret>`; a direct
link takes the form `https://<direct-origin>/v1/?hostName=…#<secret>`. The
secret is always in the fragment, so it never reaches a request line, a proxy
log, or the signaling endpoint. A device paired one way reconnects the other
without pairing again.

## Network, pairing, and revocation

The default endpoint policy is `loopback`. Expose a standalone server only
through an explicit remote-access configuration and a firewall policy that
allows the selected signaling/TURN traffic. WebRTC signaling and TURN carry
encrypted transport traffic; they do not grant access by themselves. Keep
STUN/TURN credentials in the server vault or deployment secret store, never in
the connection-manager profile or a public unit file.

Pairing requires the one-time room secret, a new device key, and the
operator's approval of the match code shown on both the device and this
server. Revocation is server-side: revoke the device or
stop exposure in the remote-access administration surface. Forgetting a local
profile only removes client metadata and is not revocation. See
[remote access](../features/remote-access.md) for credential lifetimes,
expiry, reconnect, and live-connection behavior.

Standalone vault unlock is an operator action at startup or through the
configured headless-vault integration. Secret values must only be available to
the provider callback while unlocked. A vault key, browser credential, or
provider credential must not be placed in `TERMINAY_*` environment variables,
service-manager arguments, logs, or support bundles. There is no pairing PIN;
a leftover `TERMINAY_REMOTE_PAIRING_PIN` variable makes the server refuse to
start until it is removed.

## Service-manager examples

Both examples keep the server in the foreground. Replace the paths, user, and
version with values from the installed artifact. The standalone support matrix
currently covers Linux; the launchd example is a reference for a future
macOS-hosted composition and is not evidence of standalone macOS support.

### systemd (Linux)

`/etc/terminay/server.env` should be readable only by the service account:

```ini
TERMINAY_SERVER_ID=workstation-a
TERMINAY_SERVER_VERSION=1.2.3
TERMINAY_DATA_ROOT=/var/lib/terminay
TERMINAY_LOG_SINK=journal
TERMINAY_ENDPOINT=loopback
```

`/etc/systemd/system/terminay-server.service`:

```ini
[Unit]
Description=Terminay Server (foreground)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=terminay
Group=terminay
WorkingDirectory=/var/lib/terminay
EnvironmentFile=/etc/terminay/server.env
ExecStart=/opt/terminay-server/bin/terminay-server
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=15s
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

After creating `/var/lib/terminay` with owner-only permissions:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now terminay-server.service
sudo systemctl status terminay-server.service
journalctl -u terminay-server.service -f
```

### launchd (reference only)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.terminay.server</string>
  <key>ProgramArguments</key>
  <array><string>/opt/terminay-server/bin/terminay-server</string></array>
  <key>WorkingDirectory</key><string>/var/lib/terminay</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TERMINAY_DATA_ROOT</key><string>/var/lib/terminay</string>
    <key>TERMINAY_ENDPOINT</key><string>loopback</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/var/log/terminay/server.out</string>
  <key>StandardErrorPath</key><string>/var/log/terminay/server.err</string>
</dict>
</plist>
```

Do not add a shell wrapper that backgrounds the process. A launchd supervisor
must send `SIGTERM` and retain the exit status for diagnostics.

## Backup, restore, upgrades, and incidents

Before an upgrade, stop the server, copy the complete data root to a separate
backup location, and record the artifact version and server identity. Restore
to a new data root first; never overwrite the only copy of a failed or
corrupt root. Keep the failed root read-only for diagnosis. A rollback changes
the server artifact and points it at the validated restored root; it does not
silently replace a remote server or rotate its identity.

The current composition exposes lifecycle and migration primitives but does
not yet ship a complete archive installer, automated backup command,
rollback command, or service-manager package. Those remain release gates in
[Task 20](../tasks_completed/20-security-release-and-operations.md). The procedure above
is the required operator runbook until those commands are packaged.

For incident diagnostics, collect:

1. `terminay-server --status` output;
2. the service-manager phase/exit status and bounded recent logs;
3. artifact version, target architecture, protocol version, and server
   identity;
4. migration or integrity errors plus the path of the preserved failed root;
   and
5. hosted remote WebRTC JSON lines from stderr and `--log-sink` (peer/ICE
   state, channel readyState, application-lane counters). These lines must
   not contain terminal content. Pair them with the Desktop Diagnostics
   folder when the host is Terminay Desktop, and with the browser's
   `[terminay-session]` console lines when the client is a framed PWA.

Remove pairing URLs, PINs, device keys, browser credentials, vault material,
provider credentials, terminal output, command history, project paths, and
filenames before sharing a support bundle. Terminay diagnostics are local and
telemetry-free by default.

## Local Docker server

The repository includes a local standalone-server image and Compose example. The
image runs the foreground CLI as an unprivileged `terminay` user, keeps the root
filesystem read-only when Compose is used, and persists only `/var/lib/terminay`.
The unauthenticated probe surface is limited to lifecycle status:
`GET /healthz` is liveness and `GET /readyz` is readiness. Neither endpoint
returns paths, credentials, project data, or runtime diagnostics.

From the repository root:

```sh
docker compose -f apps/terminay-server/docker-compose.local.yml build
docker compose -f apps/terminay-server/docker-compose.local.yml up -d
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
docker compose -f apps/terminay-server/docker-compose.local.yml ps
docker compose -f apps/terminay-server/docker-compose.local.yml logs -f terminay-server
docker compose -f apps/terminay-server/docker-compose.local.yml down
```

To run the image without Compose:

```sh
docker build -f apps/terminay-server/Dockerfile -t terminay-server:local .
docker run --rm --init --read-only --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --publish 127.0.0.1:8080:8080 \
  --volume terminay-data:/var/lib/terminay \
  terminay-server:local
```

This is a local lifecycle/health vertical slice. The plain standalone CLI does
not yet compose an authenticated UI/protocol listener, so this image is not
evidence that a Desktop client can connect to a remote server over the health
port. Remote UI transport remains a separate server-composition/release gate.
Do not publish port 8080 to an untrusted network; it is an orchestration probe,
not an authenticated application endpoint.
