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
| Address or name devices reach the server at | `--public-host HOST` | `TERMINAY_PUBLIC_HOST` | *(unset)* |
| Advertised direct signaling origin | `--direct-origin URL` | `TERMINAY_DIRECT_ORIGIN` | derived from the public host |
| Advertised ICE address | `--advertise-address HOST:PORT` | `TERMINAY_WEBRTC_ADVERTISE_ADDRESS` | derived from a literal public host |
| First port of a pinned ICE range | `--ice-port PORT` | `TERMINAY_ICE_PORT` | *(unpinned)* |
| Length of the pinned ICE range | `--ice-port-span N` | `TERMINAY_ICE_PORT_SPAN` | `4` |
| Source revision reported by the build | *(none)* | `TERMINAY_SERVER_REVISION` | *(unset)* |

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
and wrong for one behind NAT — so the derived value is printed at install.
`--public-host <host>` names the address or name devices reach the machine at
and derives both the direct origin and, for a routable literal address, the
advertised ICE address; `--direct-origin https://<host>:<port>` and
`--advertise-address <host>:<port>` override either one. `--expose`, `--port`,
`--hosted-domain`, and `--project-root` set the rest.

#### Running in a container

The official image, `markwylde/terminay`, runs the server in the foreground as
the container's main process, with hosted and direct exposure on. It needs no
init system, no privilege, and no added capability, and it carries the
`terminay` command, so pairing is one more line:

```bash
docker run -d --name terminay -v terminay-data:/var/lib/terminay markwylde/terminay
docker exec -it terminay terminay daemon qr-code
```

`daemon qr-code` shows the pairing links and waits; when a device opens one it
shows the device name and match code and asks for approval. `daemon approvals`,
`daemon approve <id>`, `daemon deny <id>`, and `daemon status` work the same way
through `docker exec`. `daemon install`, `upgrade`, `start`, `stop`, and
`uninstall` refuse inside the image: the container runtime manages the server,
so an upgrade is a newer image and a recreated container.

Which ports and settings a container needs depends on what connects to it.

**Terminay Desktop, on the same machine or the same network.** Nothing more.
The two lines above are the whole setup: open the hosted link in Desktop. To
use the direct link as well, publish the signaling port with `-p 8443:8443`.
No address is named and no UDP port is published.

**Browsers and phones.** Name the address they reach this machine at, once,
and publish the signaling port and the pinned UDP range:

```bash
docker run -d --name terminay -v terminay-data:/var/lib/terminay \
  -p 8443:8443 -p 51000-51015:51000-51015/udp \
  -e TERMINAY_PUBLIC_HOST=192.168.1.20 \
  markwylde/terminay
```

On macOS `$(ipconfig getifaddr en0)` prints that address; on Linux
`hostname -I` lists the machine's addresses.

**A Linux host.** Host networking gives the server the machine's real
interfaces, so it needs no address and no published port:

```bash
docker run -d --name terminay --network host \
  -v terminay-data:/var/lib/terminay markwylde/terminay
```

This applies to Linux only. On macOS and Windows the container runs inside a
Linux virtual machine, and `--network host` joins that machine's network, not
yours.

##### Why the cases differ

WebRTC carries the session over UDP, separately from HTTPS signaling, and a
connection needs one side to send a packet the other receives.

A server in a container cannot observe the address a client reaches it on. Its
own interface belongs to the container network; the name the runtime gives for
the host resolves to a gateway inside the runtime; and STUN reports the
router's public address. On macOS and Windows that container network exists
only inside a virtual machine. So every address the server can offer about
itself is one a client outside cannot route to.

Terminay Desktop does not need the server to be reachable. It offers its own
real addresses, and a container can send UDP out to them, so the server opens
the path from its side. That is why Desktop connects with nothing configured.

A browser conceals its local addresses behind names only its own machine can
resolve, so the server has nothing to send to, and the browser has to reach the
server instead. `TERMINAY_PUBLIC_HOST` names an address it can reach, and the
published UDP range is where that address answers. The public host must be a
routable literal address for this: a host name, `localhost`, or a loopback
address names the direct origin and nothing else, because a candidate is a
literal address and a browser need not probe a remote loopback one — Firefox
does not. The server says so at startup when no candidate was derived.

`TERMINAY_PUBLIC_HOST` sets two things an operator would otherwise set
separately: the direct origin, `https://<host>:8443`, and the advertised ICE
address, `<host>:51000`. `TERMINAY_DIRECT_ORIGIN` and
`TERMINAY_WEBRTC_ADVERTISE_ADDRESS` still override either one.

A direct link gives Desktop one more route. Desktop signalled through the
direct origin's host, so it also tries that host on each UDP port the server
offers. With the UDP range pinned and published — `-e TERMINAY_ICE_PORT=51000`
with `-p 51000-51015:51000-51015/udp`, or a public host — a server reachable
only at a forwarded address or a DNS name connects to Desktop with no
advertised address at all. A loopback direct origin, such as the image's
default `https://localhost:8443`, carries signaling only: it derives no
candidate and does not configure the UDP route.

##### The pinned UDP range is a budget

Publishing a port means knowing it in advance, so a public host or
`TERMINAY_ICE_PORT` pins the server's ICE ports to a run of consecutive ports.
Every candidate of every connected device takes its own port from that run; a
device that finds it spent gathers no candidate and cannot connect, and the
server logs `ice-range-exhausted`. A container with one network interface and
an advertised address uses two ports per device.

The image pins sixteen ports, 51000–51015. `TERMINAY_ICE_PORT_SPAN` changes
that; publish the same range. With no public host and no `TERMINAY_ICE_PORT`
the image pins nothing, the server uses ephemeral ports, and there is no such
limit — which is the setup Desktop uses.

##### When it does not connect

- **ICE stays in `checking`, or a peer connects and drops a few seconds
  later.** The client is trying addresses it cannot reach. For a browser or
  phone, check that `TERMINAY_PUBLIC_HOST` is the address that device reaches
  this machine at and that the UDP range is published through Podman/gvproxy
  or Docker. Publishing only the HTTPS listener carries signaling, not the
  session.
- **Desktop does not connect with nothing published.** The server's first
  packet to Desktop is unsolicited inbound UDP. A host firewall that blocks
  inbound connections to Desktop drops it. Allow Terminay in the firewall, or
  use the browser-and-phone command above, which lets Desktop reach the server
  instead.
- **It worked and then stopped after changing network.** A public host given
  as a literal address is the address of the network the machine was on.
  Recreate the container with the new address. Desktop on the same machine
  with nothing published does not depend on it.
- **Several devices, and the newest cannot connect.** The pinned range is
  spent; see above.

Terminay operates no relay for session traffic. When a network defeats every
direct route — client isolation on a guest network, a strict firewall, or
symmetric NAT on both sides — join the server's machine and the device to an
overlay network such as Tailscale. The server gathers the overlay address like
any other and the devices connect over it.

To see which route a peer actually took, compare the selected candidate pair
on both sides. The server writes a `candidate-pair` line to its structured log
(`docker logs`, `--log-sink`, or the journal) with `scope`, `localType`,
`remoteType`, `protocol` and `pairState`; Desktop records the same fields as
`remote.hosted-peer.candidate-pair` in its local diagnostics, beside
`remote.hosted-peer.connection-status` and `remote.hosted-peer.connection-failed`.
Neither side logs candidate addresses or ports. On the server, `host`/`host`
means it reached Desktop's own address; `host`/`prflx` means the client reached
a published port.

One server line is easy to misread. `peerState=connected iceState=disconnected`
about five seconds after an approval, a denial, or a second attempt with the
same link is usually the pairing peer the client has finished with, not a
failing route: pairing uses one short-lived peer and the session a second one,
and a peer that is closed without a goodbye looks exactly like this until the
server retires it. Judge the route by the `candidate-pair` line with
`scope=device`. Desktop closes its pairing peer explicitly, which the server
logs as `peer-closed` instead, and Desktop gives up a peer of its own, and says
so, once ICE has stayed disconnected for 15 seconds.

##### Identity, data, and health

Mount `/var/lib/terminay` as a volume. It holds the server identity, the host
key, the paired devices, and the hosted session origin, so a new container on
the same volume is the same server and paired devices reconnect without
pairing again. The identity is chosen once, on the first start against an
empty volume, and does not follow the container's hostname. The hostname is
only the name shown in pairing links; set it with `--hostname`, since a
container's default hostname is its id.

The server, its terminals, and the `terminay` command all run as the
unprivileged `terminay` account, with `/home/terminay` as the first project
root. That account cannot install system packages; build an image `FROM
markwylde/terminay` to add tools. The image runs with `--cap-drop=ALL`,
`--security-opt no-new-privileges`, and `--read-only` given a writable
`/var/lib/terminay` and `/tmp`.

The image declares a health check against the server's readiness endpoint,
which listens on loopback inside the container and returns lifecycle status
only. `terminay daemon status` reports readiness, the version, and the source
revision the image was built from.

##### The systemd installer in a container

`daemon install` is a systemd installer, and a stock `node:*` image does not
run systemd; `daemon install` refuses it. Running systemd as a container's
PID 1 is possible and is not the supported container path — use the image.
Where it is done deliberately, the installer's pinned range is four ports, and
the advertised address must be a routable one, never loopback:

```bash
docker run -d --name terminay-systemd \
  --privileged --tmpfs /run --tmpfs /run/lock \
  --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 8443:8443 -p 51000-51003:51000-51003/udp \
  node:24-bookworm \
  /bin/sh -c 'apt-get update -qq && apt-get install -y -qq systemd dbus && exec /lib/systemd/systemd'

docker exec -it terminay-systemd bash
npx terminay daemon install --system --run-as root --public-host 192.168.1.20
npx terminay daemon qr-code
```

`--public-host 192.168.1.20` is shorthand for `--direct-origin
https://192.168.1.20:8443 --advertise-address 192.168.1.20:51000`.
`daemon qr-code` for an installed systemd service, run as root against a
service owned by another account, uses `sudo` to reach that account's
owner-only socket, so `sudo` must be installed and the Node.js binary must be
one the service account can execute. QR output defaults to a hosted,
browser-compatible link; use `--mode direct` only when copying a link into
Terminay Desktop.

The foreground server can also be run by hand from an unpacked archive, under
any supervisor, with the same options the image sets:

```sh
terminay-server \
  --data-root /var/lib/terminay \
  --expose hosted,direct \
  --http-host 0.0.0.0 --http-port 8443 \
  --public-host 192.168.1.20
```

From a second shell, as the same user and with the same `--data-root`:

```sh
terminay-server --pairing --data-root /var/lib/terminay   # hosted and direct links
terminay-server approvals --data-root /var/lib/terminay   # pending match codes
terminay-server approve <approval-id> --data-root /var/lib/terminay
```

#### Pairing from the terminal

`daemon qr-code` (alias `daemon pairing-url`) asks the running server for its
live pairing URLs over the data root's owner-only socket, renders a terminal
QR for the hosted URL when hosted exposure is on and the direct URL otherwise,
prints every URL with its expiry and mode, and then waits. A hosted link opens
in a browser or in Desktop; a direct link is for Desktop only, so a phone
camera is never pointed at one by default. When a device requests
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
KillMode=process
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

`KillMode=process` is required when terminal sessions are kept across restarts
(see [Terminal sessions across restarts](#terminal-sessions-across-restarts)).
With the default kill mode, stopping the unit ends the session holder and every
shell it holds. `terminay daemon install` writes it, and `terminay daemon
upgrade` adds it to a unit that predates it before it stops the service.

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

## Terminal sessions across restarts

This applies when the server is started with `TERMINAY_SESSION_HOLDER=1`. It is
off by default.

Shells are not children of the server. They run in a **session holder**, a
small detached process per data root that the server starts on demand. When the
server stops, restarts, upgrades, or crashes, the holder keeps the shells
running and buffers up to 1 MiB of each one's most recent output. The next
server to start on the same data root reattaches to them, and every terminal
tab comes back with its output and its running process.

The holder ends its sessions and exits when no server has attached for longer
than the **Keep terminals running after quit** setting (5 minutes by default,
or until the machine restarts). A machine restart or logout ends them.

What it keeps in the data root, all owner-only:

| Path | Contents |
| --- | --- |
| `session-holder/<generation>.sock` | The holder's local socket. Never a network listener. |
| `session-holder/<generation>.json` | The holder's pid, build, protocol versions, and the credential a server must present. Treat it like a key. |
| `session-tails/<session-id>` | The last output of a session that ended while no server was attached. Deleted when its tab is closed. |

`session-tails/` is the one place terminal output is written to disk outside
recordings. It holds at most 1 MiB per ended session and nothing for a session
that is running. Include or exclude it from backups accordingly, and leave it
out of support bundles.

A server from a newer build does not replace a holder that still has sessions.
It asks the old one to accept no new sessions, starts a second holder for new
ones, and the old one exits when its last session ends. Seeing two holders after
an upgrade is expected.

To end every held session by hand, stop the server and run:

```sh
terminay-server end-sessions --data-root /var/lib/terminay
```

It prints how many holders and sessions it found and how many remain, and exits
non-zero if a running server still owns them. `terminay daemon uninstall` runs
it for you. If the server binary is gone, `kill <pid>` (SIGTERM) on the pid in
`session-holder/<generation>.json` does the same: the holder saves each
session's last output, ends its shells, and exits.

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

This section describes a development image built from
`apps/terminay-server/Dockerfile`, not the official image. To run Terminay in
a container, use `markwylde/terminay` as described under
[Running in a container](#running-in-a-container).

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
