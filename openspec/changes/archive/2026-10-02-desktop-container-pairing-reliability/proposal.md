## Why

Desktop pairing can fail after the server has already enrolled the device, leaving a credential that has no saved connection. Direct links printed by the server also fail for loopback addresses, while repeated links, dropped ICE paths, and container-specific setup errors leave users without a useful recovery path.

## What Changes

- Accept direct HTTPS pairing links on loopback and preserve direct-origin classification on reconnect.
- Save a sanitized server profile as soon as enrollment succeeds, retain it when initial loading fails, and surface live connection loss with a recoverable state.
- Rotate a pairing room as soon as approval consumes it; explain expired or used links clearly.
- Make pairing progress, approval, connection, and failure states explicit; prevent overlapping attempts and show friendly errors.
- Log selected ICE candidate-pair diagnostics without logging pairing secrets or credentials.
- Prefer hosted links for terminal QR output when both modes are enabled; serve an explanatory page at the direct `/v1/` URL.
- Correct ready-log pairing URL classification and validate unsafe container networking configuration with actionable warnings.
- Document a supported foreground container setup, direct-link browser behavior, and UDP/advertised-address requirements; improve CLI diagnostics for missing `sudo` and unreadable execution paths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: Desktop pairing persistence, direct-link acceptance, visible progress, and user-facing recovery.
- `remote-access`: pairing-room consumption, peer liveness diagnostics, and direct listener behavior.
- `daemon-cli`: QR selection, container validation, foreground/container guidance, and actionable CLI errors.
- `server-runtime-and-protocol`: direct listener root and pairing-page behavior.

## Impact

Affected code includes `packages/protocol`, `electron/remote`, `electron/main.ts`, shared connection UI, `apps/terminay-server`, `apps/terminay-cli`, and their focused tests. Operator guidance changes in `docs/operations/standalone-server.md`; browser guidance changes in the sibling `terminay.com` remote-access page.
