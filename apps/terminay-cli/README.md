# Terminay CLI

The command-line interface to [Terminay](https://terminay.com), a local-first
terminal workspace for software projects.

Today it installs and controls **Terminay Server** on a Linux host, under the
`daemon` command group. One command takes a clean machine to a running,
pairable server:

```bash
sudo npx terminay daemon install
```

Then pair a device with it:

```bash
sudo npx terminay daemon qr-code
```

That shows a scannable code, waits for the device that scans it, and asks you
to approve it after comparing the match code shown on both sides.

## Requirements

64-bit GNU/Linux on x64 or arm64, with systemd, and glibc 2.31 or newer
(Debian 11, Ubuntu 20.04, or anything newer). The CLI refuses to run `daemon` commands
anywhere else, naming the requirement rather than failing part-way through.

The CLI itself needs Node 20 or newer. The server does not need Node at all:
each release archive carries its own pinned Node runtime, the native PTY addon,
and the workspace UI it serves, so the target needs neither Node nor a compiler
to run the server.

## Commands

```
terminay daemon install [ref]     Resolve, verify, install, start
terminay daemon upgrade [ref]     Follow the installed channel
terminay daemon upgrade --check   Say what an upgrade would move to, as JSON
terminay daemon upgrade --recreate Replace a container with one on a newer image
terminay daemon uninstall         Remove the service; keep the data root
terminay daemon start | stop
terminay daemon status            Unit state, version, channel, exposure
terminay daemon qr-code           Pairing code and approval, in one terminal
terminay daemon approvals         List devices waiting for approval
terminay daemon approve <id>
terminay daemon deny <id>
terminay daemon reset-identity    Rotate the host key; revoke every device
```

`terminay daemon pairing-url` is an alias for `qr-code`. Run `terminay --help`
for the full flag list.

## Choosing what to install

```bash
sudo npx terminay daemon install            # the newest tagged release
sudo npx terminay daemon install v4.2.1     # a specific release
sudo npx terminay daemon install main       # the rolling main channel
sudo npx terminay daemon install my-branch  # built from source on the target
```

A branch or commit has no published archive, so the CLI builds one on the
machine. It checks for `git`, `python3`, `make`, and a C++ compiler before
downloading anything.

`upgrade` with no reference re-resolves whatever channel the machine is already
on, so a host tracking `main` never silently moves onto the tag stream.

## The upgrader ships with the server

Every server archive carries this CLI, bundled to run on the Node runtime the
archive already has, as `<version>/bin/terminay`. An installed server can
therefore be upgraded with no Node.js, npm, or registry access on the host:

```bash
sudo /opt/terminay/current/bin/terminay daemon upgrade --system
~/.local/share/terminay/current/bin/terminay daemon upgrade --user
```

It is the same source as this package and embeds the same release key, and the
release fails if the two ever differ. `npx terminay daemon upgrade` keeps
working and is how an install from before the archive carried a CLI moves
forward.

`daemon upgrade --check` changes nothing. It prints one line of JSON — what is
installed, whether the channel has something newer, and whether this machine
can upgrade itself — and exits zero whenever it could describe the
installation, even with no network. It reads only what the account the server
runs as can read, and it is what a running server asks before it offers an
upgrade to a connected device.

A system-scope service runs as an unprivileged account that cannot restart its
own unit or write `/opt/terminay`. `daemon install --system` therefore also
writes a small root-owned helper: `terminay-upgrade.path` watches one request
file that only the run-as account can write, and starts
`terminay-upgrade.service`, which runs `daemon upgrade --system` as root with
no other argument. The request's contents are never read, so the account can
ask for an upgrade to the newest signed release on the installed channel and
for nothing else. An install made before the helper existed gains it the next
time `sudo terminay daemon upgrade --system` runs. A user-scope service
upgrades as itself and has no helper. `daemon uninstall` removes it.

Each upgrade that moves, or tries to move, the active version leaves
`upgrade-result.json` beside `versions/`: the release it moved from, the one it
moved to or attempted, whether it succeeded or rolled back, why, and when. The
next attempt replaces it.

## Verification

Every downloaded archive is checked against its published SHA-256 and then
against its Ed25519 signature, using a public key committed to this package's
source. There is no flag and no environment variable that skips it: the
boundary crossed is "release pipeline → your machine", and that key is the only
thing that makes the download trustworthy.

This package is published from CI with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements), so
you can verify which commit and workflow built the version you installed.

## Install scope and the run-as account

With a terminal attached, `install` asks two questions.

The first is whether to install a system-wide service or one owned by your
login. The second is which account the server and its terminals run as — **that
choice decides whose files, keys, and agents a paired device can reach**. A
dedicated `terminay` system account is the default.

Answer both up front with `--system` or `--user` and `--run-as <user>`, which is
also required when there is no terminal to ask on.

## Reaching the server

Exposure defaults to `hosted,direct`, and the direct origin is derived from the
machine's primary address. That is right for a host with a routable address and
wrong for one behind NAT or with a DNS name, so the derived value is printed at
install and can be overridden:

```bash
sudo npx terminay daemon install --direct-origin https://box.example.com:8443
```

`--public-host <host>` is the shorter form when one address or name is how
devices reach the machine: it derives the direct origin and, for a routable
literal address, the advertised connection candidate, and `--direct-origin` or
`--advertise-address` still override either one.

```bash
sudo npx terminay daemon install --public-host 192.168.1.20
```

`--expose off|hosted|direct|hosted,direct` and `--port` control the rest. For a
server reachable only at a forwarded address — a container, or a box behind a
port forward — see [Trying it in a local container](#trying-it-in-a-local-container).

## Trying it in a local container

Use the official image. It runs the server in the foreground, carries this
CLI, and needs neither systemd nor `sudo`:

```bash
docker run -d --name terminay \
  -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay \
  markwylde/terminay
docker exec -it terminay terminay daemon qr-code
```

That is the whole setup for Terminay Desktop on the same machine or network:
Desktop offers its real addresses, so the server opens the connection from its
side and no address or UDP port is needed.

Browsers and phones conceal their local addresses, so they have to reach the
server instead, and a server in a container cannot see the address they reach
it at — on macOS and Windows the container runs inside a virtual machine, and
`--network host` does not change that, because the host is the VM. Name that
address once and publish the ports:

```bash
docker run -d --name terminay \
  -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay \
  -p 8443:8443 -p 51000-51015:51000-51015/udp \
  -e TERMINAY_PUBLIC_HOST=192.168.1.20 \
  markwylde/terminay
```

Use this machine's routable address — the one `ipconfig getifaddr en0` or
`hostname -I` prints — not a loopback address: a browser need not send
connectivity checks to a loopback candidate and Firefox does not. A public
host that is a name or loopback sets the direct origin only.

Inside the image `daemon qr-code`, `approvals`, `approve`, `deny`, and `status`
talk to the running server directly. `daemon install`, `start`, `stop`, and
`uninstall` refuse there and name the container action to take instead: the
container runtime manages the server.

`daemon upgrade` works inside the image, and upgrades in place:

```bash
docker exec terminay terminay daemon upgrade
```

The image's own release is a baseline. The upgrade follows the image's
channel, verifies the archive exactly as on a systemd host, and stages it under
`releases/` on the data volume. The entrypoint, which stays the container's
main process, then restarts the server on it. The container does not restart,
so its terminals keep running, and nothing needs the Docker socket or a
writable root filesystem. If the new release does not report ready, the
previous one is started again and the command exits non-zero.

The staged release is what runs after every later restart of the container,
and of any container created from the same image on the same volume, so the
image tag no longer says which version is running: `daemon status` and
`--version` do. A newer image wins over an older staged release. An in-place
upgrade replaces the server release only; the image's operating system
packages change when you pull a newer image and recreate the container.

#### Recreating the container on a newer image

`daemon upgrade --recreate` moves the whole image instead, operating system
packages included, by replacing the container. It is optional, it is never the
default, and it **ends every terminal in the container**.

It needs the Docker socket mounted into the container and usable by the
account the server runs as:

```bash
docker run -d --name terminay \
  -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  markwylde/terminay
docker exec terminay terminay daemon upgrade --recreate
```

**A mounted Docker socket gives every process in the container, including
every terminal a paired device opens, control of the host's Docker daemon,
which is root on the host.** Terminay does not narrow that. Mount it only where
that is acceptable.

The server runs as the unprivileged `terminay` account and never uses `sudo`,
so the socket must be one that account can open: `--group-add` names the group
that owns the socket on the host (on Docker Desktop, where the socket appears
in the container as `root:root`, use `--group-add 0`). A socket the account
cannot open, one nothing answers on, or none at all simply means recreate is
not offered; `daemon upgrade --check` then lists `in-place` alone.

What it moves to follows the reference the container was created from, and
nothing on the command line or from a connected device chooses it:

| Created from | Moves to |
| --- | --- |
| `terminay:latest`, `terminay:main`, or no tag | The same reference, pulled again |
| `terminay:5.1.1` or `terminay:v5.1.1` | The same repository at the newest release on the installed channel, written the same way |
| `terminay@sha256:…`, or an image id | Refused: the container is pinned to one image |

The command pulls that image and starts a short-lived helper container from
it, with the same socket and data volume. The helper stops the old container
within its own stop timeout, renames it to `<name>-terminay-previous`, and
creates the replacement under the original name with the same volumes,
published ports, networks and aliases, restart policy, and the environment
variables and labels you gave it. Anything the old image itself defined — its
environment defaults, labels, entrypoint, health check — comes from the new
image instead. The helper then waits up to two minutes for the image's health
check. When the replacement is healthy the old container is removed, and its
volumes are not. When it is not, the replacement is removed and the old
container is given its name back and started. Either way the outcome is
written to `releases/upgrade-result.json` on the data volume.

It is refused, with the reason, for a container started with `--rm`, one that
shares another container's network (`--network container:…`), one pinned by
digest, and one whose data root is not on a volume. The image is pulled with
the daemon's own access: a private registry the daemon cannot pull from
without credentials fails the pull and changes nothing. A container managed
by Compose keeps its labels, so Compose still recognises it, but the image
tag in the Compose file no longer describes it; update the file.

### With the systemd installer

`daemon install` needs systemd, which a stock container does not run. Where
systemd is deliberately run as a container's PID 1, the same idea applies with
`--advertise-address` (or `--public-host`), and the installer pins four ports:

```bash
docker run -d --name terminay-systemd \
  --privileged --tmpfs /run --tmpfs /run/lock \
  --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 51000-51003:51000-51003/udp \
  node:24-bookworm \
  /bin/sh -c 'apt-get update -qq && apt-get install -y -qq systemd dbus && exec /lib/systemd/systemd'

docker exec -it terminay-systemd bash
npx terminay daemon install --system --run-as root \
  --advertise-address 192.168.1.20:51000
npx terminay daemon qr-code
```

The pinned UDP range is a budget: the WebRTC runtime gives each candidate of
each connected device its own socket from it, so a range that is too short
limits how many devices can connect at once.

This is for a server reachable only at a forwarded address. It is not a general
answer to NAT — it works because someone forwarded a port.

## Where things live

| | System scope | User scope |
| --- | --- | --- |
| Versions | `/opt/terminay/versions/<version>` | `~/.local/share/terminay/versions/<version>` |
| Active version | `/opt/terminay/current` | `~/.local/share/terminay/current` |
| Configuration | `/etc/terminay/server.env` | `~/.config/terminay/server.env` |
| Data root | `/var/lib/terminay` | `~/.local/share/terminay/data` |
| Last upgrade outcome | `/opt/terminay/upgrade-result.json` | `~/.local/share/terminay/upgrade-result.json` |
| Upgrade helper | `/etc/systemd/system/terminay-upgrade.{path,service}`, `/var/lib/terminay-upgrade/request` | none |

In the official image, upgraded releases live on the data volume under
`<data root>/releases/`, beside the same `versions/`, `current`, and
`upgrade-result.json`.

Installed versions are immutable once verified. `current` is a symlink replaced
atomically, so an upgrade that does not come up healthy puts the previous
version back. `uninstall` keeps the data root — which holds the host key and
your paired device records — unless you pass `--purge`.

## Links

- [Installation guide](https://terminay.com/docs/installation)
- [Standalone server runbook](https://github.com/markwylde/terminay/blob/main/docs/operations/standalone-server.md)
- [Release, install, and update policy](https://github.com/markwylde/terminay/blob/main/docs/operations/release-update-policy.md)
- [Source](https://github.com/markwylde/terminay)
- [Issues](https://github.com/markwylde/terminay/issues) — bug reports and
  feature requests are welcome; pull requests are not accepted

## License

AGPL-3.0-or-later
