## ADDED Requirements

### Requirement: Verified bundle cache
A browser connection host SHALL install a server UI bundle as a generic archive
installer: it streams the archive from the authenticated server, decompresses
it with browser gzip support, unpacks it, and stages its files in Cache Storage
beneath a generated per-bundle namespace. All files supplied by the
authenticated server SHALL be authoritative for that exact session subdomain.
The host SHALL NOT maintain filename allowlists, build-tool layout knowledge,
per-file transfer requests, per-file content-hash requirements, or assumptions
about canonical entry filenames.

#### Scenario: Arbitrary generated filenames
- **WHEN** a server supplies an archive with arbitrary nested generated
  filenames
- **THEN** the host installs and launches it without any host-side change

#### Scenario: Server entry renamed
- **WHEN** a server renames its UI entry file
- **THEN** the host installs the bundle without rejecting it as an unsafe path

### Requirement: Bundle content stays out of the manager origin
The host SHALL retain only containment and denial-of-service boundaries when
unpacking an archive. It SHALL reject absolute paths, parent traversal, links,
duplicate normalized paths, paths that would occupy protected bootstrap or
signaling routes, excessive compressed or expanded byte totals, excessive entry
counts, and excessively large individual entries. Staged files SHALL live only
in the exact session origin's cache namespace.

#### Scenario: Traversal entry
- **WHEN** an archive entry uses a parent-traversal or absolute path
- **THEN** the entry is rejected and the installation fails

#### Scenario: Protected route collision
- **WHEN** an archive entry would occupy a protected bootstrap or signaling
  route
- **THEN** the entry is rejected

#### Scenario: Expansion limit exceeded
- **WHEN** an archive expands beyond the configured byte or entry limits
- **THEN** the installation fails rather than continuing to write

### Requirement: Bundle manifest compatibility
Activation SHALL be atomic: a staged archive becomes active only after complete
extraction and valid metadata. Cancellation, disconnect, malformed gzip or tar,
an unsupported archive-format version, and any resource-limit failure SHALL
retain the previously installed complete bundle and present a precise recovery
message. The host SHALL launch the entry path declared by the archive metadata
without interpreting its filename. A refresh SHALL recreate the authenticated
transport owner before executing cached server code, while subresources may
continue to be served from the exact session-origin cache.

#### Scenario: Transfer interrupted mid-install
- **WHEN** the connection drops during extraction
- **THEN** the previously installed bundle remains active
- **AND** a precise recovery message is shown

#### Scenario: Unsupported archive version
- **WHEN** the archive declares an archive-format version the host does not
  support
- **THEN** installation fails and the previous bundle is retained

#### Scenario: Refresh of an installed bundle
- **WHEN** the user refreshes a session running an installed bundle
- **THEN** the authenticated transport owner is recreated before cached server
  code executes
