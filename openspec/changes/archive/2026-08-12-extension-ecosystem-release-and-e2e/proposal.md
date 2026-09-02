## Why

Tasks 41–50 built the project-environment extension platform and the official
SSH and Puzed providers, but the ecosystem was not yet something an outside
author or an operator could use: there was no published Extension API reference,
no operator runbook for install, backup, and compromise response, no upgrade and
rollback evidence, and no end-to-end security and resource acceptance across the
Local, SSH, and Puzed environments in both server and client modes.

## What Changes

- Publish the Extension API reference plus manifest, permissions, UI, and
  provider guides, the trusted-code security model, a conformance CLI, an example
  provider, and separate official-repository workflows.
- Document embedded and standalone install, backup, restore, update, rollback,
  disable and remove, npmjs availability requirements, diagnostics, and
  compromise response.
- Exercise server upgrade with compatible and incompatible extensions, registry
  and data migrations, failed activation, rollback, and retained unavailable
  projects.
- Add hostile package, IPC, authentication, project-claim, secret, host-key,
  redirect, cross-environment, and no-fallback sentinel suites plus crash and
  resource recovery coverage.
- Measure bounded menus, forms, and inventories, SFTP traversal, provider IPC,
  connection pools, event streams, and provisioning concurrency.

No product requirement changed: this change published documentation, exercised
the release supply chain, and added acceptance and measurement coverage for
behaviour the platform and provider specifications already required.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
_None._

## Impact

Extension author and operator documentation, the conformance CLI and example
provider, the official extension repository workflows, and the extension
platform, SSH, and Puzed acceptance and measurement suites.
