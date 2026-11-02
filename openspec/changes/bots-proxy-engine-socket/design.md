## Context

The existing CLI wrapper injects a bot label only for run/create. Compose and SDKs bypass it, and an opt-in raw socket mount makes ordinary container work unavailable by default. The owner explicitly permits bots to control other engine resources and requests reliable creation attribution, not owner-based authorization. Docker uses Labels on creation bodies; native Podman uses labels. Debian trixie ships Docker Compose 2.26.1 as docker-compose.

## Goals / Non-Goals

**Goals:** default engine access through every bot's standard socket; trusted creation attribution independent of client; unrestricted engine control; correct Compose, API and streaming behavior; independent container-owned lifecycle.

**Non-Goals:** multi-tenant security isolation, owner-based filtering/authorization, separate nested engines, relabelling existing resources, remote engines, publishing host ports or changing session/MCP authority.

## Decisions

Run a small Node HTTP proxy in each bot container under PID 1, before desktop readiness. The standard client socket belongs to bot; the real daemon-side socket is mounted beneath a root-only runtime directory. Bootstrap supplies the server/bot identity, not client-controlled environment variables. No new host listener or server relay is needed, and engine access outlives agent sessions and app reconnects. A proxy failure is fatal to the container, using existing init supervision. Rootless namespace/socket permissions remain part of engine integration verification.

Rewrite bounded POST container/network/volume create JSON at versioned and unversioned Docker-compatible routes, plus native Podman libpod equivalents. Stamp terminay.server, terminay.bot, terminay.workload=1 and terminay.managed=0; preserve other metadata. Container lists recognize the workload marker even when an image carries an inherited helper label. Other requests remain transparent, without ownership filtering or arbitrary endpoint restrictions. Use streaming pipes and HTTP hijack handling rather than buffering image/build/log/archive/exec traffic. Limit creation buffers, connections, headers and in-flight requests; return bounded generic errors without logging credentials or request data.

Ship the standard Docker CLI and Compose package; remove the label wrapper. Configure both Docker and Podman remote clients to use the proxy socket. Resource attribution happens at the API boundary on Docker and Podman; a native Podman client still requires a Podman engine, as expected.

Remove mutable socket-sharing settings and their confirmation UI. Existing saved records are read for idle/limits/revision while obsolete sharing data is discarded. Overview reports proxy readiness versus explicit recreation required. Existing running containers are not silently replaced; the image fingerprint and existing recreate action perform the update while preserving home and sign-in.

## Risks / Trade-offs

- Full engine authority is intentional and documented; a root-only raw socket path is not a security boundary against an agent allowed to control the engine.
- Proxy HTTP behavior can break Compose, builds or interactive terminals: protocol tests cover framing, streaming, cancellation, upgrades and backpressure; real Docker-compatible Podman and Compose tests verify end-to-end attribution and labels.
- Creation endpoints added by engines need explicit attribution support; unknown requests remain transparent and no universal security guarantee is claimed.
- A raw mount makes the daemon-side path and rootless namespace relevant; preserve local pinning/path normalization and verify mount payloads and available real engine modes.
