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

Registry installation and uploaded packages with production dependencies
require outbound HTTPS access from Terminay Server to public npmjs. A package
file with no external dependencies can be installed while npmjs is unavailable.
Private/custom registries are outside v1.

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

For an unpublished or locally packed package, choose **Install package file…**,
select the `.tgz` emitted by `npm pack`, review the exact uploaded filename,
name/version, archive SHA-512 integrity, permissions, and unverified trusted-code
warning, then confirm. The browser/Desktop uploads bytes to the selected server;
the server never interprets a client filesystem path. Files above 12 MiB and
archives that are not safe npm-pack trees are rejected before preview.

Terminay uses a sterile internal npm configuration, exact lock, production
dependencies only, disabled lifecycle scripts, and no binary links. It rejects
Git/file/URL/alias transitive dependencies, missing integrity, native modules/build files,
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

## Backup and restore

Stop new administrative operations and record the server version before taking
a consistent backup of the complete server data root. For Desktop this is the
embedded server data root, not renderer storage; for standalone deployments it
is the configured persistent volume. Include the extension registry, immutable
package slots and receipts, namespaced data/migration snapshots, profiles,
environment/project registry, trust records, and encrypted vault. Keep the
vault's external unlock material separately; neither backup is useful as a
substitute for the other.

Restore into a stopped server of the recorded compatible version, with the same
ownership/mode protections. Start without accepting clients, inspect recovery
and compatibility diagnostics, then test one profile/environment per provider
before reopening access. Never copy only `packages/` or rewrite active pointers
by hand. If npmjs is unavailable, retained immutable slots can start, but a
missing package cannot be freshly restored until the registry returns.

## Server update and disaster rollback

Before updating Terminay, take the backup above and verify installed extensions'
API/Node/Terminay ranges. The updated server preserves incompatible extensions
and their projects as unavailable; it never falls back to This server. Allow
registry/data migrations to finish before client admission. A failed activation
leaves the extension failed and other providers available.

To roll back the server, stop it, restore the whole pre-update data-root snapshot
and matching server artifact, then verify diagnostics. Do not run an older
binary against data already migrated by a newer version unless that migration
explicitly declares backward compatibility. Extension **Rollback** changes only
the selected code slot and is not a server/data rollback.

Embedded and standalone flows have the same rules. Desktop operators must quit
all application windows so the embedded server is stopped; standalone operators
must drain clients and stop the service/container while preserving its volume.

## Compromise response

If an extension is suspected of compromise:

1. Disable it on every affected Terminay Server and prevent new activation or
   installation of the package/version at the registry/network boundary.
2. Preserve registry receipts, package/lock/inventory hashes, bounded audit and
   process diagnostics, and the immutable slot for investigation. Do not execute
   the suspect entrypoint to collect evidence.
3. Assume every file/network resource available to the server account and every
   secret intentionally brokered to that extension may be exposed. Rotate API
   keys, SSH keys/agent identities, passwords, server access credentials, and
   downstream tokens accordingly; revoke sessions and review provider audit.
4. Inspect external resources for mutation. Uninstalling code does not undo VM,
   filesystem, network, or credential actions.
5. Install a reviewed exact replacement or restore a known-good pre-compromise
   server backup, then explicitly re-enable and validate dependent environments.

Record package name/version/integrity, extension id, server ids, first/last
known execution time, granted permissions, affected profile bindings, response
actions, and credential rotation completion without copying secret values into
the incident record.

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
