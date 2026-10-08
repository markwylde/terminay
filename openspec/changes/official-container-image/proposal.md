## Why

Running Terminay Server in a container today means choosing between a systemd-in-a-container recipe and a hand-assembled foreground command, then typing the host's address twice (`--direct-origin` and `--advertise-address`) and publishing five ports. A person trying Terminay on their Mac, a VM, or a homelab should type one `docker run` line and one pairing command. Measurement on 2026-10-03 showed most of that configuration is unnecessary for Terminay Desktop, which connects to a container with no address and no published UDP port at all.

## What Changes

- Publish an official image, `markwylde/terminay`, that runs the standalone server in the foreground with hosted and direct exposure on, so `docker run -d --name terminaydemo markwylde/terminay` yields a server a device can pair with.
- Ship the `terminay` CLI in the image so `docker exec -it terminaydemo terminay daemon qr-code` shows pairing links and approves devices, with no systemd, no `sudo`, and no install record.
- Run the server and its terminals as an unprivileged account that has passwordless `sudo`, so a terminal can install packages without the server running as root.
- Add one public-host setting (`--public-host` / `TERMINAY_PUBLIC_HOST`) that derives both the direct origin and the advertised ICE address, so the host address is given once.
- Let the ICE port range be pinned without an advertised address, so published UDP ports are meaningful even when the server does not know its reachable address.
- In direct mode, the client offers itself a candidate at the host it signalled through, on the server's pinned ports, so a server reachable only through a forwarded address needs no advertised address for Desktop.
- Make "Desktop reaches a container that publishes no UDP port" a required, tested behaviour: Desktop offers its real host addresses and the server opens the path outbound.
- Record that Terminay operates no media relay. People behind a network that defeats direct connectivity are directed to an overlay network such as Tailscale.
- Keep the server's identity stable across container recreation when the data volume is kept, and report the real build version and revision from the image.
- Rewrite the container section of the standalone runbook and the image release contract around the image, with one run line each for a local machine, browser and phone access, and a Linux host.

## Capabilities

### New Capabilities

- `container-image`: the official image's contract — what a bare `docker run` produces, its defaults, ports, volume, user, identity, health, bundled CLI, and where it is published.

### Modified Capabilities

- `daemon-cli`: pairing, approval, and status commands work against a foreground server with no systemd install; the installer accepts the single public-host setting; the documented container flow is the image, not systemd in a container.
- `remote-access`: a single public-host setting; a pinned ICE port range independent of an advertised address; a client-derived direct-mode candidate; Desktop host candidates and server-initiated connectivity; no Terminay-operated media relay.

## Impact

- `apps/terminay-server`: `Dockerfile`, `entrypoint.sh`, option parsing (`cliOptions.ts`), peer configuration (`remote/hostedPeerLifecycle.ts`), identity persistence, version reporting.
- `apps/terminay-cli`: data-root and socket resolution without an install record; lifecycle commands that refuse inside the image with a pointer to the container runtime; `--public-host` on `install` and `upgrade`.
- `electron/remote/desktopHostedConnection.ts`: the direct-mode derived candidate; a regression test for the no-UDP-port container path.
- `.github/workflows/server-image.yml` and its contract test: publication to Docker Hub as `markwylde/terminay` beside the existing GHCR name; a Docker Hub credential.
- `docs/operations/standalone-server.md`, `docs/operations/docker-image-release.md`, and the installation page on `terminay.com`.
- New ADR-0034; evidence under `openspec/adr/evidence/`.
- No change to pairing, host-key pinning, approval, or any credential path: every address added here is a routing hint.
