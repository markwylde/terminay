## Why

Bots can create Compose workloads that Terminay cannot attribute to them, because the current label wrapper covers only selected Docker CLI commands. The owner wants all bots to use the shared engine by default and track creators consistently without restricting access to other containers.

## What Changes

- Provide a per-bot Docker-compatible proxy at /var/run/docker.sock on every new/recreated bot container; remove the Share engine socket toggle and confirmation.
- Inject trusted server/bot ownership labels into container, network and volume creation requests, preserving application and Compose labels.
- Pass other requests and streams through without ownership filtering, including operations on other bots' containers.
- Run the proxy with the container lifecycle, independently of agent sessions, with bounded request buffering and connection resources.
- Ship Docker Compose and the standard Docker client instead of the CLI label wrapper.
- **BREAKING**: remove mutable socket-sharing fields from the bot settings protocol; saved idle/limit settings and bot homes remain readable and intact. Running old containers require explicit recreation.

## Capabilities

### New Capabilities
- `bot-engine-proxy`: default shared-engine access, API-level attribution, transparent streams, lifecycle and truthful UI.

### Modified Capabilities
None in canonical specs. Reconcile the pending bot-environment and bot-container-engine contracts that prescribe opt-in raw socket access and CLI attribution.

## Impact

Bot image/bootstrap, environment lifecycle/settings/protocol/client/UI, engine resource attribution, Docker-isolated E2E and real Compose/Podman verification. A new ADR narrowly supersedes the prior opt-in/raw-socket and CLI-labelling decisions. This is attribution, not a security sandbox. The owner authorizes specs and implementation together on the existing branch/PR.
