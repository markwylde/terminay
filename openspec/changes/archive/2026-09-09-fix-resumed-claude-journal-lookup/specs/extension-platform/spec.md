## MODIFIED Requirements

### Requirement: Terminal-scoped directory list and watch operations

The public observation broker SHALL offer terminal-scoped directory listing and
directory watching for the exact terminal's environment, with bounded results,
cancellation, and atomic-replacement handling. These operations SHALL be
available only through the broker, SHALL be routed through the terminal's
project environment, and SHALL NOT read a directory outside the broker-issued
scope.

A listing MAY declare the exact filenames it is looking for. Where it does,
only files with those names SHALL be considered, and only they SHALL be charged
against the declared limits, so a caller that already knows the filename it
wants is bounded by that file rather than by everything sharing the directory
with it. Each declared name SHALL be a single path segment; a name that is not
SHALL be refused rather than resolved.

#### Scenario: Bounded directory watch

- **WHEN** an extension watches a directory through the broker
- **THEN** results are bounded, replacement is handled, and cancellation
  disposes the watcher

#### Scenario: Out-of-scope directory

- **WHEN** an extension lists or watches a directory outside its broker-issued
  terminal scope
- **THEN** the request is refused

#### Scenario: Listing that declares the filename it wants

- **WHEN** a listing declares an exact filename and the directory also holds
  files large or numerous enough to exhaust the declared limits
- **THEN** only the declared filename is considered and charged, and the
  listing is not truncated by the files it never asked for

#### Scenario: Declared name that is not a single segment

- **WHEN** a declared name contains a path separator or a traversal segment
- **THEN** the request is refused
