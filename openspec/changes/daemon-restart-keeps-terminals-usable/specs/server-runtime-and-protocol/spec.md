## ADDED Requirements

### Requirement: Server scratch directories in the shared temporary directory are owner-only

On macOS and Linux, the server's fixed-name scratch directories (clipboard, drops, attachments) SHALL live under one owner-only root in the temporary directory, named for its account. Before each use, the server SHALL verify the root is a real directory it owns with no group or other access, or refuse to write. Files SHALL be created exclusively, owner-only, never through a symlink. On Windows they SHALL live in the user's own temporary directory.

#### Scenario: Pre-created by another account

- **WHEN** another account has created the server's scratch root path before the server first uses it
- **THEN** the server writes nothing there and reports that the scratch directory is not safe to use

#### Scenario: Symlink planted at the root

- **WHEN** the scratch root path is a symlink
- **THEN** the server writes nothing through it and reports the problem

#### Scenario: File permissions

- **WHEN** the server writes a clipboard image, a dropped file, or an attachment
- **THEN** the file is readable and writable by the server's account only, and its directory is accessible by that account only

#### Scenario: Windows

- **WHEN** a server on Windows writes a clipboard image
- **THEN** the file is written under the user's own temporary directory, and no POSIX ownership check is required
