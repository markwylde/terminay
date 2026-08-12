# Extension operations

## Purpose

This runbook governs server-side extension installation and recovery for both
Desktop's embedded Terminay Server and standalone deployments. Extension state
belongs to the selected server data root; never install packages in a project,
the application bundle, Electron's renderer storage, a global npm prefix, or a
user's current working directory.

## Runtime prerequisites

Every supported Terminay Server artifact includes its pinned Node runtime and
matching pinned npm installer. Operators do not install system Node/npm or a
compiler. Official SSH and Puzed entries are hardcoded catalogue metadata, but
their packages are fetched from the public npmjs registry and are not available
for a fresh offline installation.

Every package installation requires outbound HTTPS access from Terminay Server
to the public npmjs registry. It does not use client/browser network access or
npm credentials. Private/custom registries are outside v1.

## Data-root layout

The implementation uses safe server-generated/content-addressed names beneath
the configured data root, conceptually:

```text
extensions/
  registry.v1.json
  packages/<content-id>/
  staging/<operation-id>/
  data/<extension-id>/
  cache/
```

Package names never become unchecked filesystem paths. Registry/active-pointer
writes are schema-versioned, atomic, revisioned, and recoverable. Immutable
version slots contain an exact production dependency closure, lockfile, receipt,
and validated package entry. Extension data is separately namespaced so code
rollback cannot silently replace external/provider state.

## Install procedure

Use **File → Extensions…** on the exact selected server. The initiating device
must have extension-management permission.

For custom npm packages:

1. Enter a public npm package name and optional version/range/tag.
2. Review the resolved exact package/version, publisher/repository, integrity,
   provenance/audit facts, dependency footprint, Extension API compatibility,
   permissions, and trusted-code warning.
3. Confirm against the named Terminay Server.
4. Wait for Resolve, Download, Validate, Install, Probe, and Activate status.

Terminay uses a sterile internal npm configuration, exact lock, production
dependencies only, disabled lifecycle scripts, and no binary links. It rejects
Git/file/URL/alias dependencies, missing integrity, native modules/build files,
required install scripts, escaping entrypoints/symlinks, incompatible manifests,
and bounded file/size/count violations.

Do not bypass a rejection by manually running npm in the extension directory.
Such state is unsupported and is not admitted by the extension registry.

## Update and rollback

Updates are manual and exact. Terminay stages them beside the active slot,
validates and probes them, then atomically switches after provider use is
drained/restarted. Expanded permissions require a new confirmation. A failed or
interrupted update leaves the prior active slot intact.

At least one known-good slot is retained. **Rollback** selects and probes that
slot; it does not undo VMs, files, connections, or other external actions. Data
migrations take a namespaced snapshot. Restoring incompatible old data is a
separate explicit operation with a loss warning.

## Disable and uninstall

Disable stops new provider use and makes dependent environments/projects
explicitly unavailable; it never retargets them. Profiles, data, and secret
references remain for re-enable/reinstall. Active sessions require an explicit
drain/restart flow and become interrupted only when their provider transport is
actually closed.

Uninstall is blocked while enabled, referenced by another extension, profile,
environment, or project, or used by an active operation. Code removal never
cascade-deletes projects, provider data, secrets, VMs, or remote files. Bundled
official baseline slots remain available for rollback even when disabled.

## Failure recovery

- A staging/download/validation/probe failure leaves active code unchanged and
  records a bounded safe failure.
- On restart, the server reconciles registry, staging, active pointers, and
  immutable slots before activation. It never executes an uncommitted slot.
- A crashing extension uses bounded restart/backoff, then remains failed until
  manual retry. This server and other extensions stay available.
- An incompatible extension remains installed/disabled with its dependent
  projects represented. Upgrade, rollback, or reinstall resolves it.
- Deleting extension files manually is unsupported; restore the server data
  root backup or reinstall the exact package through the manager.

Backups include registry records, receipts, versioned extension data, profiles,
trust records, and encrypted vault state according to normal server backup
policy. Support bundles include only extension ids, versions, integrity/state,
and bounded failure classes—not endpoints, roots, credentials, provider bodies,
or terminal data.

## Security posture

Custom npm extensions are trusted code with the Terminay Server account's
effective filesystem/network authority. Separate processes and broker
permissions improve failure containment and API discipline but are not an OS
sandbox. npm integrity/provenance/audit metadata does not constitute Terminay or
npm code approval.

Install only packages whose source and publisher you trust. Rotate affected
server/environment credentials and review audit records if an installed package
is suspected of compromise; merely uninstalling it cannot retract data it may
already have accessed.
