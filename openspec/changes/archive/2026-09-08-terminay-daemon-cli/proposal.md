## Why

Running Terminay Server on a Linux machine you do not sit at should be one
command. Today it is a runbook: download an archive, verify it, create a
service user, write an environment file and a systemd unit, enable it, watch
the journal for a pairing URL that expires in five minutes, and repeat most
of that by hand for every upgrade. Nobody outside the project has done it.
`npx terminay daemon install` turns the runbook into a supported product
surface, and `daemon qr-code` puts a scannable pairing code and the approval
step in one terminal so Desktop can be paired from a phone or laptop without
reading logs.

## What Changes

- A new public npm package, `terminay`, whose only binary is `terminay`. It is
  a thin installer and controller; it does not bundle the server.
- `terminay daemon install [ref]` resolves `ref` (default: latest tag; a tag
  such as `v4.0.0`; `main`; a branch or commit) to a signed self-contained
  server archive for the machine's architecture, verifies its SHA-256 and
  Ed25519 signature against a public key embedded in the CLI, stages it under
  a versioned directory, and installs a systemd unit. Refs without a prebuilt
  archive fall back to a source build on the target after a toolchain
  preflight.
- Install scope is chosen interactively when a terminal is attached
  (system-wide service, or user-scope unit as the invoking user) and by flag
  otherwise. System-scope installs choose the account terminals run as: a
  dedicated `terminay` account or a named login user.
- `daemon upgrade [ref]` follows the installed channel by default (`main`
  stays on `main`, a tag goes to the latest tag), refuses downgrades without
  `--allow-downgrade`, stages the new version beside the old, stops the unit,
  switches the `current` pointer, starts, waits for readiness, and rolls the
  pointer back on failure. One previous version is kept.
- `daemon uninstall` stops and removes the unit and installed versions and
  keeps the data root unless `--purge` is given.
- `daemon start`, `daemon stop`, and `daemon status` wrap the unit and the
  server's redacted status and readiness.
- `daemon qr-code` (alias `daemon pairing-url`) asks the running server for its
  live pairing URLs, renders a terminal QR for the preferred mode, prints the
  URLs, then waits for the device that scans it and prompts to approve or deny
  the match code. `--no-wait` prints and exits. `daemon approve`, `daemon deny`,
  and `daemon approvals` remain available for non-interactive use.
- `daemon reset-identity` wraps the server's identity rotation with the
  required stop and start.
- The release workflow publishes the `terminay` package to npm on every tag,
  versioned in lockstep with the app.

## Capabilities

### New Capabilities

- `daemon-cli`: the `terminay` command-line installer and controller for
  headless Linux servers: version resolution and verification, install layout,
  service-manager integration, lifecycle commands, upgrade and rollback,
  pairing and approval from the terminal, and its release publication.

### Modified Capabilities

- `server-runtime-and-protocol`: the operational documentation boundary names
  the CLI as the supported install path and the runbook as the manual
  fallback.

## Impact

- New workspace `apps/terminay-cli` (npm name `terminay`), added to the root
  workspaces, turbo graph, boundary checks, and deterministic-build checks.
- `.github/workflows/trigger-release.yml`: `npm publish` step for the CLI.
- `scripts/release-signature.mjs`: export of the public key in a form the CLI
  embeds; a check that the embedded key matches the signing key in CI.
- `docs/operations/standalone-server.md`: CLI as the primary path.
- Depends on change `headless-server-release-and-pairing` for the archives,
  channels, `--expose`, direct mode, and the socket `pairing` op.
- Runtime dependencies of the CLI: `qrcode` (already in the tree) for terminal
  rendering; Node built-ins for everything else.
