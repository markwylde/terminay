## 1. Author and operator experience

- [x] 1.1 Publish the Extension API reference, manifest, permissions, UI, and
  provider guides, the trusted-code security model, the conformance CLI, an
  example provider, and separate official repository workflows, verified by
  building, packing, testing, and installing the example provider from the public
  documentation alone
- [x] 1.2 Document embedded and standalone install, backup, restore, update,
  rollback, disable and remove, npmjs availability requirements, diagnostics, and
  compromise response, verified by walking each documented procedure against a
  clean supported server

## 2. Release supply chain

- [x] 2.1 Exercise server upgrade with compatible and incompatible extensions,
  registry and data migrations, failed activation, rollback, and retained
  unavailable projects, verified by the upgrade exercise leaving unavailable
  projects intact and the active installation recoverable

## 3. Acceptance and security

- [x] 3.1 Add hostile package, IPC, authentication, project-claim, secret,
  host-key, redirect, cross-environment, and no-fallback sentinel suites plus
  crash and resource recovery coverage, verified by each sentinel asserting a
  named boundary refusal
- [x] 3.2 Measure bounded menus, forms, inventories, SFTP traversal, provider
  IPC, connection pools, event streams, and provisioning concurrency, verified by
  each measurement staying inside its declared bound
- [x] 3.3 Verify a clean supported server needs no system Node, npm, or compiler
  and installs official and custom packages from npmjs with an actionable offline
  failure
- [x] 3.4 Verify mixed Local, SSH, and Puzed environments survive client
  disconnect and preserve every authority, session, draft, VM, and failure
  boundary the feature contracts specify
