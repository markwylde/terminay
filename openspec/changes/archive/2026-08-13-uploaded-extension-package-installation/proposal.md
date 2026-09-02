## Why

The official SSH and Puzed catalogue entries could not be installed before
their npmjs publication, and the extension manager had no safe package-file
upload path.

## What Changes

- Add a bounded binary application-protocol command that uploads one npm-pack
  `.tgz` to the selected server and returns an exact expiring preview.
- Inspect npm-pack archive structure and manifest before confirmation, rejecting
  traversal, links, malformed or oversized archives, and identity drift.
- Materialize the uploaded root archive with scripts disabled while keeping all
  transitive dependency resolution integrity-pinned to public npmjs.
- Bind install and update confirmation to archive integrity, clean staging on
  success, failure, and restart, and leave active-slot rollback semantics
  unchanged.
- Present **Install package file…** in Extensions Settings for Desktop and
  browser, including uploaded and unverified source facts and useful errors.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `extension-platform`: installing and updating an extension from an uploaded
  package file, its archive inspection rules, dependency resolution, and source
  labelling.

## Impact

The application protocol gains one bounded binary upload command; the server
extension installer gains an uploaded-archive path through the existing
transactional pipeline; Extensions Settings gains an **Install package file…**
entry on Desktop and browser. Client state persists neither a renderer path nor
package bytes.
