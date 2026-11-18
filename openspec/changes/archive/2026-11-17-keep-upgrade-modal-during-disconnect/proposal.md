## Why

An expected server restart during an upgrade can replace the upgrade modal with a full-screen reconnect error. The progress card must remain visible through slow reconnects.

## What Changes

- Keep the upgrade board and modal mounted when the primary connection loses its workspace context.
- Allow the ordinary disconnected screen beneath the modal backdrop; retain normal recovery controls once the card closes.
- Cover a disconnect lasting beyond the session connection timeout.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: Keep upgrade progress above disconnected presentation for the card's entire lifetime.

## Impact

Shared session shell rendering and server-upgrade regression coverage. No protocol, transport, retry, or server changes.
