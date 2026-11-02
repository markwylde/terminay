# Bot container engine connection

Terminay Server connects to a Docker-compatible HTTP API over a local Unix
socket. The server account needs access to that socket. Docker and Podman use
one operation backend; installing a host Docker CLI is not required when the
socket is already available. A Dock/Finder launch does not need a login-shell
PATH.

Discovery reads the server's `DOCKER_HOST`, selected Docker context metadata,
standard Docker Desktop/OrbStack/Podman socket locations, and local Podman
machine socket metadata. Optional `podman machine list/inspect` commands only
locate provider-specific forwarded sockets. For a nonstandard socket, start the
server with `DOCKER_HOST=unix:///absolute/path/to/socket`. Configure this on the
server, not in a bot shell. TCP and arbitrary SSH engine endpoints are refused.

The dashboard identifies Docker or Podman from the server API. Aliases resolving
to the same socket are deduplicated; already identified engines also share a
persistent marker. Distinct available engines require a selection. Default
context changes do not redirect an existing selection.

Engine selection creates a small volume named `terminay-engine-identity` with a
`terminay.engine.identity` label. It holds no bot home data or secrets. Keep it
with the engine's state. Removing the marker, replacing the engine, or restoring
an incompatible pin requires **Use this engine** confirmation. Saved native Podman or Docker CLI pins are upgraded automatically when their
original endpoint and identity can be verified. Unverifiable CLI pins require
reselection after this update. Reselection does not delete resources
on the previous engine; bot resources are adopted only when both server and bot
ownership labels match.

A missing `terminay-bot:local` image is normal on first use: choose **Build image**.
An image probe failure is reported separately from the selected engine. The bot
image is built locally from Terminay's shipped Dockerfile.

**Share engine socket** remains off by default. When enabled, the container gets
the daemon-side socket at `/var/run/docker.sock`. On macOS this source path is
inside the engine's Linux VM and differs from the host connection socket. Podman
socket-sharing containers and the socket-stat helper disable SELinux container
labelling so the existing socket inode can be accessed without relabelling it.
The confirmation still applies: socket access gives the bot control of that
engine. Other bots keep their normal security settings.

## Verification

The ordinary Bots E2E suite uses a socket API fixture and runs through
`npm run test:e2e -- e2e/bots.spec.ts --workers=1`.

The opt-in real socket smoke test builds and removes a uniquely tagged test
image, creates and removes a temporary container, and checks exec, TTY resize,
usage, logs and the socket mount:

```sh
TERMINAY_BOT_SOCKET_SMOKE=unix:///var/run/docker.sock \
  node --test packages/server-core/test/bot-socket-live.test.mjs
```

It expects an existing `terminay-bot:local` image by default. Set
`TERMINAY_BOT_SOCKET_BASE_IMAGE` to another locally available Linux image with
`sh`, `sleep`, `id`, `cat`, `stat`, `stty`, and `mkdir` to test the API independently
of the bot image. The test does not install or start an engine and does not
remove an existing identity marker.
