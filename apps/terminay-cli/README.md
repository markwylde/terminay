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

64-bit GNU/Linux on x64 or arm64, with systemd, and a Debian 12-compatible
userspace (glibc 2.36 or newer). The CLI refuses to run `daemon` commands
anywhere else, naming the requirement rather than failing part-way through.

The CLI itself needs Node 20 or newer. The server does not need Node at all:
each release archive carries its own pinned Node runtime, the native PTY addon,
and the workspace UI it serves, so the target needs neither Node nor a compiler
to run the server.

## Commands

```
terminay daemon install [ref]     Resolve, verify, install, start
terminay daemon upgrade [ref]     Follow the installed channel
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

`--expose off|hosted|direct|hosted,direct` and `--port` control the rest.

## Where things live

| | System scope | User scope |
| --- | --- | --- |
| Versions | `/opt/terminay/versions/<version>` | `~/.local/share/terminay/versions/<version>` |
| Active version | `/opt/terminay/current` | `~/.local/share/terminay/current` |
| Configuration | `/etc/terminay/server.env` | `~/.config/terminay/server.env` |
| Data root | `/var/lib/terminay` | `~/.local/share/terminay/data` |

Installed versions are immutable once verified. `current` is a symlink replaced
atomically, so an upgrade that does not come up healthy puts the previous
version back. `uninstall` keeps the data root — which holds the host key and
your paired device records — unless you pass `--purge`.

## Links

- [Installation guide](https://terminay.com/docs/installation)
- [Standalone server runbook](https://github.com/markwylde/terminay/blob/main/docs/operations/standalone-server.md)
- [Release, install, and update policy](https://github.com/markwylde/terminay/blob/main/docs/operations/release-update-policy.md)
- [Source and issues](https://github.com/markwylde/terminay)

## License

MIT
