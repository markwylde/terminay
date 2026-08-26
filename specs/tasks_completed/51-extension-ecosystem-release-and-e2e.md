# Extension ecosystem release and end-to-end convergence

## Goal

Ship author documentation, reproducible official packages, upgrade/migration
evidence, and complete Local/SSH/Puzed acceptance across server/client modes.

## Delivery phase

Phase 6 release convergence after Tasks 41–50.

## Dependencies

- Tasks [41](../tasks_completed/41-project-environment-domain-and-local-provider.md),
  [42](../tasks_completed/42-extension-api-manifest-and-host.md),
  [43](../tasks_completed/43-environment-routed-project-services.md),
  [44](../tasks_completed/44-extension-installation-and-management.md),
  [45](../tasks_completed/45-project-environment-and-extension-ui.md),
  [46](../tasks_completed/46-official-ssh-extension.md),
  [47](../tasks_completed/47-official-puzed-extension-foundation.md),
  [48](../tasks/48-puzed-vm-provisioning-experience.md), and
  [49](../tasks_completed/49-puzed-to-ssh-environment-composition.md), plus
  [50](../tasks_completed/50-ssh-environment-service-parity.md).

## Governing specifications

- [Server extension platform](../features/extension-platform.md)
- [Project environments](../features/project-environments.md)
- [Extension operations](../operations/extensions.md)

## Parallel work streams

### Author and operator experience

- [x] Publish Extension API reference, manifest/permissions/UI/provider guides,
  trusted-code security model, conformance CLI, example provider, and separate
  official repository workflows.
- [x] Document embedded/standalone install, backup, restore, update, rollback,
  disable/remove, npmjs availability requirements, diagnostics, and compromise
  response.

### Release supply chain

- [x] Exercise server upgrade with compatible/incompatible extensions, registry/
  data migrations, failed activation, rollback, and retained unavailable projects.

### Acceptance and security

- [x] Add hostile package/IPC/auth/project-claim/secret/host-key/redirect/
  cross-environment/no-fallback sentinel suites and crash/resource recovery.
- [x] Measure bounded menus/forms/inventories, SFTP traversal, provider IPC,
  connection pools, event streams, and provisioning concurrency.

The first two acceptance items were reopened on 2026-08-13 after the shipped
UI exposed that installed provider creation actions and Puzed dynamic options
were not connected end to end. Task 53 owns the corrective journey and evidence.

## Acceptance checks

- A clean supported server needs no system Node/npm/compiler and installs
  official/custom packages from npmjs with an actionable offline failure.
- A third-party author can build/pack/test/install a conformant provider using
  public docs only, with no internal imports or renderer code.
- Mixed environments survive client disconnect and preserve every authority,
  session, draft, VM, and failure boundary specified by the feature contracts.

## Definition of done

Official packages and the public ecosystem contract are reproducible,
documented, migration-safe, security-reviewed, and accepted end to end across
supported server and client distributions.
