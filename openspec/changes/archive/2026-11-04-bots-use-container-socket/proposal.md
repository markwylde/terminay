## Why

Bots cannot start on a working Podman installation: the dashboard misidentifies a Docker-compatible endpoint, rejects a changing identity, or fails while checking an image that has not been built. Connecting to the engine's socket directly removes the host CLI and PATH dependency and gives Docker and Podman one container-operation implementation.

## What Changes

- Discover local Unix sockets from explicit server configuration, Docker context files, Podman machine metadata and standard install locations, independent of the host CLI and login shell.
- Use the Docker-compatible HTTP API for discovery, images, container/network/volume lifecycle, events, logs, statistics, exec, shells, file helpers and desktop tunnels.
- Identify the server implementation from its API response; deduplicate aliases; persist an engine identity that does not depend on Podman's changing compatibility `info.ID`.
- Keep engine switching explicit and resource adoption restricted to server and bot ownership labels.
- Report missing images as buildable, preserve engine status on image errors, and clear stale dashboard status after failed reads.
- Resolve host connection sockets separately from sockets mounted inside the engine's VM.
- Preserve local-only engines, existing supported engine modes, bounded streams, secret redaction and supervised session cleanup.

- Start Chromium automatically with the bot desktop, independently of agent tool lifetimes, with DISPLAY available to commands.

- Add right-click edit/delete for user and assistant messages and confirmed Clear chat; future bot context follows the revised conversation.
- Replace background-browser launch guidance with observe/act/verify instructions grounded in the tools actually installed.
- Use the available Triggers panel width and keep Terminay-managed helpers out of bot workload lists and actions.

## Capabilities

### New Capabilities

- `bot-container-engine`: Shared socket transport, local endpoint discovery, stable pinning, status recovery, API operation and stream contracts.

### Modified Capabilities

None in canonical specs. `bot-environment` currently exists only in the unarchived `add-terminay-bots` change. This change reconciles its two engine requirements to reference the new capability so the active proposals do not prescribe contradictory transports.

## Impact

Server bot engine, image, environment, shell, file-helper, agent and desktop services; dashboard engine status; test fixtures and E2E setup; server packaging of dependencies. A new ADR supersedes only the engine transport aspect of ADR-0089 and explicitly preserves its bot/ACP security decisions. Existing CLI-shaped saved pins require explicit reselection if their endpoint or identity cannot be verified safely. No bot image is downloaded and no engine is installed or started by Terminay.

The owner explicitly authorizes proposal and implementation together in one branch/PR, overriding the separate proposal merge checkpoint for this change.
