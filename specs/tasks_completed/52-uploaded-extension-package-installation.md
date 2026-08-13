# Uploaded extension package installation

## Goal

Install and update unpublished Terminay extensions from safe npm-pack `.tgz`
uploads on the selected Terminay Server.

## Governing specifications

- [Server extension platform](../features/extension-platform.md)
- [Extension operations](../operations/extensions.md)

## Current gap

The official SSH and Puzed catalogue entries cannot be installed before their
npmjs publication, and the manager has no safe package-file upload path.

## Delivery checklist

- [x] Add a bounded binary application-protocol command that uploads one `.tgz`
  to the selected server and returns an exact expiring preview.
- [x] Inspect npm-pack archive structure and manifest before confirmation;
  reject traversal, links, malformed/oversized archives, and identity drift.
- [x] Materialize the uploaded root archive with scripts disabled while keeping
  all transitive dependency resolution integrity-pinned to public npmjs.
- [x] Bind install/update confirmation to archive integrity, clean staging on
  success/failure/restart, and keep active-slot rollback semantics unchanged.
- [x] Present **Install package file…** in Extensions Settings for Desktop and
  browser, including uploaded/unverified source facts and useful errors.
- [x] Cover permission, payload/size/integrity/replay, hostile archive,
  transactional failure, client parsing, and Settings UI behavior.
- [x] Run focused builds/unit tests and Electron acceptance through Docker.

## Acceptance checks

- An `npm pack` archive for an unpublished provider can be previewed and
  installed without publishing the root package.
- The archive is uploaded to the currently selected Terminay Server; neither a
  renderer path nor package bytes are persisted in client state.
- A spoofed official name remains visibly uploaded/unverified.
- Failure never changes the active extension pointer or executes lifecycle code.

## Definition of done

The same reviewed transactional extension lifecycle accepts public npmjs specs
and bounded npm-pack uploads without weakening server authority or dependency
supply-chain constraints.
