## MODIFIED Requirements

### Requirement: Server secret vault

Server secrets SHALL use a pluggable vault. Embedded mode SHALL use an
OS-backed protector for its server vault wrapping key without exposing plaintext
to a renderer or workspace bundle. Electron safe storage SHALL protect
embedded-vault wrapping keys only when the platform reports an OS-backed
encryption backend; Linux `basic_text` storage SHALL be unavailable for this
purpose.

#### Scenario: Platform reports no OS-backed backend

- **WHEN** the platform reports only Linux `basic_text` storage
- **THEN** Electron safe storage is not used to protect the embedded vault
  wrapping key

#### Scenario: Renderer requests vault plaintext

- **WHEN** a renderer or workspace bundle requests a vault wrapping key
- **THEN** no plaintext is exposed to it

### Requirement: Headless vault envelope and unlock

A headless vault SHALL wrap its data-encryption key in a versioned, bounded
passphrase envelope using the specified scrypt parameters. Unlock input SHALL
come only from an echo-disabled controlling terminal or a one-shot inherited
file descriptor. Command-line arguments, environment variables, ordinary stdin,
and a plaintext key stored beside the ciphertext MUST NOT be unlock mechanisms.

#### Scenario: Unlock attempted through an environment variable

- **WHEN** a passphrase is supplied through a command-line argument, environment
  variable, or ordinary stdin
- **THEN** it is not accepted as an unlock mechanism

#### Scenario: Interactive unlock

- **WHEN** the operator unlocks through an echo-disabled controlling terminal or
  a one-shot inherited file descriptor
- **THEN** the vault unlocks

### Requirement: Headless vault persistence and hygiene

The selected server-core headless adapter SHALL persist the vault envelope
through an injected server storage boundary, whose file implementation uses
mode-0600 replace-by-rename writes. It SHALL authenticate the envelope's
metadata, zeroize passphrase, derived-key, and scoped plaintext buffers, and
SHALL start locked after restart. Its protocol-facing status and references SHALL
contain metadata only. Electron safe storage SHALL remain a separate embedded
protector boundary. The canonical state repository SHALL reject a complete but
stale vault envelope using its expected revision.

#### Scenario: Restart

- **WHEN** a headless server restarts
- **THEN** its vault starts locked and its protocol-facing status exposes
  metadata only

#### Scenario: Stale envelope write

- **WHEN** a complete but stale vault envelope is submitted
- **THEN** the canonical state repository rejects it on its expected revision

### Requirement: Settings classification and revisioned broadcast

Settings SHALL be classified as server, connection-host, or temporary client
state rather than stored in one undifferentiated Electron JSON file. Server
settings SHALL be normalized and migrated by the server and broadcast with
revisions.

#### Scenario: Server setting changes

- **WHEN** a server setting is changed
- **THEN** the server normalizes it and broadcasts it with a revision to every
  authorized client
