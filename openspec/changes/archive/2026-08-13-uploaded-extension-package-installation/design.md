## Context

See proposal.md. Extensions already had a reviewed transactional lifecycle for
public npmjs specs. The gap was purely the input: an unpublished provider
package could not enter it.

## Goals / Non-Goals

Goals:
- An `npm pack` archive for an unpublished provider can be previewed and
  installed without publishing the root package.
- The same reviewed transactional lifecycle accepts both public npmjs specs and
  bounded uploads.

Non-Goals:
- Weakening server authority or the dependency supply-chain constraints. Only
  the root archive comes from the upload.

## Decisions

### The server owns the archive, not the client

The archive is uploaded to the currently selected Terminay Server through a
bounded binary application-protocol command. No renderer path and no package
bytes are persisted in client state. The command returns an exact expiring
preview, and install or update confirmation is bound to the archive's integrity
so a different archive cannot be substituted between preview and confirmation.

### Inspection fails closed

Archive structure and manifest are inspected before confirmation. Traversal
entries, links, malformed or oversized archives, and identity drift between the
preview and the confirmed archive are rejected.

### Only the root package comes from the upload

The uploaded root archive is materialized with scripts disabled. All transitive
dependency resolution stays integrity-pinned to public npmjs, so the upload does
not become a channel for unpinned dependencies.

### Uploaded extensions are visibly unverified

The Extensions surface reports the uploaded and unverified source facts. A
package that spoofs an official name still shows as uploaded and unverified
rather than adopting the official catalogue entry's standing.

## Risks / Trade-offs

- Accepting an uploaded root package is a real trust decision by the server
  administrator. The mitigation is honest labelling, scripts-disabled
  materialization, pinned transitive resolution, and confirmation bound to
  archive integrity.
- Failure must never change the active extension pointer or execute lifecycle
  code, so staging is cleaned on success, failure, and restart, and the
  existing active-slot rollback semantics are unchanged.
