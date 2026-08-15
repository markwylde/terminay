# Standalone Server operations

This guide describes the foreground `terminay-server` process and the
operator boundaries around it. The server is a supported standalone artifact
on GNU/Linux x64 and arm64 with a Debian 12-compatible userspace. It does not
daemonize itself, and a service manager must supervise the foreground process.

Server-installed project-environment extensions follow the canonical
[extension operations](./extensions.md) runbook. Supported artifacts include
the pinned internal npm installer; extension packages are fetched from npmjs.
Operators do not install system Node/npm or place packages in a project
checkout. Extension packages, receipts, profiles, data, and encrypted secret
references live under the configured server data root.

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
| Remote pairing PIN | *(none)* | `TERMINAY_REMOTE_PAIRING_PIN` | required for pairing/exposure |

The data root is the server's authority boundary. Keep it on a local disk
with owner-only permissions, back it up as one unit, and do not put it below a
project checkout. Project files and explicitly configured recording roots may
remain outside this directory. The current runtime accepts the configured
paths at composition time; packaging is responsible for creating directories
and applying platform permissions.

The foreground readiness record may include the configured data and log paths
so a local operator can find them. `--status` is intentionally redacted: it
reports phase, identity, version, runtime mode, and whether paths/bundles are
configured, but not their values or workspace data. Do not redirect readiness
or diagnostics to a public endpoint.

## Foreground commands

```sh
terminay-server --help
terminay-server --version
terminay-server --status --data-root /var/lib/terminay
terminay-server --pairing --server-id workstation-a --endpoint loopback
terminay-server --data-root /var/lib/terminay --log-sink /var/log/terminay/server.jsonl
```

`--pairing` requires `TERMINAY_REMOTE_PAIRING_PIN` to be configured as exactly
six digits in a protected environment file. It emits a short-lived handoff
record and never prints that PIN, a private key, durable browser credential,
or application token.

Stop the foreground process with `SIGTERM` for a bounded graceful shutdown.
`SIGINT` is equivalent for an interactive terminal. A supervisor must not
start a second process against the same data root while the first one is
stopping.

## Network, pairing, and revocation

The default endpoint policy is `loopback`. Expose a standalone server only
through an explicit remote-access configuration and a firewall policy that
allows the selected signaling/TURN traffic. WebRTC signaling and TURN carry
encrypted transport traffic; they do not grant access by themselves. Keep
STUN/TURN credentials in the server vault or deployment secret store, never in
the connection-manager profile or a public unit file.

Pairing requires the one-time room secret, the configured PIN, and a new device
key. Revocation is server-side: revoke the device or
stop exposure in the remote-access administration surface. Forgetting a local
profile only removes client metadata and is not revocation. See
[remote access](../features/remote-access.md) for credential lifetimes,
expiry, reconnect, and live-connection behavior.

Standalone vault unlock is an operator action at startup or through the
configured headless-vault integration. Secret values must only be available to
the provider callback while unlocked. A vault key, browser credential, or
provider credential must not be placed in `TERMINAY_*` environment variables,
service-manager arguments, logs, or support bundles. The sole exception is
`TERMINAY_REMOTE_PAIRING_PIN`, which must be set only in a protected operator
environment file and never passed as a command-line argument.

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
TERMINAY_REMOTE_PAIRING_PIN=736941
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
   identity; and
4. migration or integrity errors plus the path of the preserved failed root.

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
