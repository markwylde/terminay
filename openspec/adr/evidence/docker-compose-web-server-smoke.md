# Docker Compose web + server smoke evidence

## Development repository workspace

The local Compose server now receives the active checkout as its canonical
project root instead of falling back to the image implementation directory
(`/opt/terminay`). Run `docker compose` from the repository/worktree root:

- `TERMINAY_PROJECT_ROOT=${PWD}` seeds the shared workspace, file service,
  terminal working directory, and Git project binding with the active checkout.
- The checkout's containing directory is bind-mounted at the same absolute
  host path. Preserving the path is required for linked Git worktrees because
  their `.git` files contain absolute pointers to the common repository.
- The runtime image includes the Git CLI, and the exact project root is
  admitted through Git's `safe.directory` process configuration.
- The image still runs as UID 10001 with a read-only root filesystem,
  `no-new-privileges`, and all capabilities dropped. Only the explicit project
  bind and `/var/lib/terminay` data volume are writable.

The bind is intentionally a local-development facility. Production deployments
must replace it with an explicit project volume/path and must not expose an
arbitrary host parent directory.

Date: 2026-07-27

Command:

```sh
npm run build --workspace @terminay/client-core
node --test scripts/docker-compose-web-server-smoke.test.mjs
node scripts/docker-compose-web-server-smoke.mjs --strict
```

Result: passed.

What this proves:

- `docker-compose.yaml` starts a hardened `terminay-server` service and the
  static `terminay-web` service on loopback-only host ports.
- The server readiness log contains a structured pairing URL whose token is
  present only in the URL fragment; recorded evidence stores only the redacted
  fragment length and token length.
- The web container proxies `/protocol/*` to `terminay-server:4317` with an
  nginx resolver generated from the container's own `/etc/resolv.conf`.
- A browser-equivalent `HttpByteTransport` connects through
  `http://127.0.0.1:8080`, completes the protocol handshake with admin scope,
  verifies `server.health`, and sees the default running terminal session.
- Restarting only `terminay-server` produces a fresh pairing handoff, and the
  existing `terminay-web` container reconnects through the proxy without being
  restarted.

Redacted smoke summary:

```json
{
  "status": "passed",
  "webOrigin": "http://127.0.0.1:8080",
  "serverOrigin": "http://localhost:4317",
  "nginx": {
    "dynamicResolverConfigured": true,
    "resolverLine": "resolver 10.89.7.1 ipv6=off valid=5s;"
  },
  "initial": {
    "readiness": {
      "serverId": "compose-local",
      "protocolEndpoint": "http://0.0.0.0:4317",
      "healthEndpoint": "http://0.0.0.0:4318",
      "pairingUrl": "http://localhost:4317/#<redacted:147>",
      "tokenLength": 43
    },
    "connection": {
      "serverId": "compose-local",
      "authScope": "admin",
      "healthReady": true,
      "defaultTerminalRunning": true
    }
  },
  "afterServerRestart": {
    "readiness": {
      "serverId": "compose-local",
      "protocolEndpoint": "http://0.0.0.0:4317",
      "healthEndpoint": "http://0.0.0.0:4318",
      "pairingUrl": "http://localhost:4317/#<redacted:147>",
      "tokenLength": 43
    },
    "connection": {
      "serverId": "compose-local",
      "authScope": "admin",
      "healthReady": true,
      "defaultTerminalRunning": true
    }
  },
  "lifecycle": {
    "webContainerStableDuringServerRestart": true,
    "serverRestartedWithoutRestartingWeb": true
  }
}
```

Limitations:

- This is local Docker Compose evidence only.
- It does not prove public `web.terminay.com` DNS, TLS, CDN, or deployment.
- It does not prove WebRTC/TURN routing.
- It does not prove full shared workspace UI parity.
