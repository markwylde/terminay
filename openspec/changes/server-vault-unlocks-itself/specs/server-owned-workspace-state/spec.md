## MODIFIED Requirements

### Requirement: Headless vault envelope and unlock

A headless vault SHALL wrap its data-encryption key in a versioned, bounded
passphrase envelope using the specified scrypt parameters. A standalone server
SHALL unlock its vault at startup without operator input. Its unlock secrets
SHALL be a secret read once from an inherited file descriptor given by
`--vault-unlock-fd`, and the server's vault key file
`<data-root>/vault/headless-v1.key`, tried in that order. When no envelope and
no key file exist and no descriptor is given, the server SHALL generate 32
random bytes, write them base64url-encoded to the key file with owner-only
permissions and a durable write, and unlock with them. A vault unlocked from a
descriptor SHALL stay operator-managed, with no key file written, unless the
operator also gives `--vault-convert-to-key-file`; the server SHALL then
re-wrap the data-encryption key under a newly generated key file such that no
interruption leaves an envelope that no file in the data root can unlock. The
server SHALL read a key file only when it is a regular file of at most 4096
bytes, SHALL restrict a key file readable by others to its owner, and SHALL
never delete or rewrite a key file that does not unlock the vault.
Command-line arguments, environment variables, and ordinary stdin MUST NOT be
unlock mechanisms. The server MUST NOT log, report, or transmit key material.

#### Scenario: Unlock attempted through an environment variable

- **WHEN** a passphrase is supplied through a command-line argument, environment
  variable, or ordinary stdin
- **THEN** it is not accepted as an unlock mechanism

#### Scenario: First start creates a working vault

- **WHEN** a standalone server starts with no vault envelope, no key file, and
  no unlock descriptor
- **THEN** it writes an owner-only key file, the vault is unlocked, and a secret
  can be stored

#### Scenario: Restart unlocks without input

- **WHEN** a standalone server whose data root holds a matching key file
  restarts
- **THEN** its vault is unlocked and its previously stored secrets can be read,
  with no operator input

#### Scenario: Interactive unlock

- **WHEN** the operator supplies the vault's secret through
  `--vault-unlock-fd`
- **THEN** the vault unlocks with that secret, and no key file is written

#### Scenario: Operator converts a passphrase vault

- **WHEN** a vault with no key file unlocks from a descriptor and the operator
  gives `--vault-convert-to-key-file`
- **THEN** a key file is written, and every later start, with or without the
  old descriptor, unlocks the vault with every secret intact

#### Scenario: Conversion interrupted

- **WHEN** a conversion stops at any point before it completes
- **THEN** the next start unlocks the vault with either the old secret or the
  new key, and every secret is intact

#### Scenario: Descriptor does not unlock but the key file does

- **WHEN** the descriptor's secret does not unlock the vault and the key file
  does
- **THEN** the vault unlocks with the key file

#### Scenario: Vault that cannot unlock

- **WHEN** a standalone server starts with an envelope that neither a
  descriptor nor a key file unlocks, or with a key file that is not a regular
  file or exceeds 4096 bytes
- **THEN** the vault stays locked, the envelope and key file are unchanged, and
  the server log names the reason and the fix without any key material

### Requirement: Headless vault persistence and hygiene

The selected server-core headless adapter SHALL persist the vault envelope
through an injected server storage boundary, whose file implementation uses
mode-0600 replace-by-rename writes. It SHALL authenticate the envelope's
metadata, zeroize passphrase, derived-key, and scoped plaintext buffers, and
SHALL start locked when it is opened, before the server supplies its unlock
secret. A failed write SHALL leave the adapter's envelope and keys unchanged.
Its protocol-facing status and references SHALL contain metadata only. Electron
safe storage SHALL remain a separate embedded protector boundary. The canonical
state repository SHALL reject a complete but stale vault envelope using its
expected revision.

#### Scenario: Restart

- **WHEN** a headless server restarts and its adapter opens an existing envelope
- **THEN** it is locked until it is given an unlock secret, and its
  protocol-facing status exposes metadata only

#### Scenario: Stale envelope write

- **WHEN** a complete but stale vault envelope is submitted
- **THEN** the canonical state repository rejects it on its expected revision

#### Scenario: Re-wrap write fails

- **WHEN** re-wrapping the data key under a new secret fails to persist
- **THEN** the adapter stays unlocked under its previous envelope

## ADDED Requirements

### Requirement: Vault failures are named to the client

When a client command fails because the server vault is locked, unavailable, or
missing the requested secret, the server SHALL answer with a protocol error that
names the vault condition, and SHALL NOT answer with a generic failure. The
error SHALL carry no secret material.

#### Scenario: Command needs a locked vault

- **WHEN** a client command needs to read or store a secret while the server
  vault is locked
- **THEN** the client receives an `unavailable` error whose message says the
  server vault is locked

#### Scenario: Command needs an unavailable vault

- **WHEN** a client command needs the server vault while its envelope cannot be
  read
- **THEN** the client receives an `unavailable` error whose message says the
  server vault is unavailable

#### Scenario: Command needs a missing secret

- **WHEN** a client command reads a secret the vault does not hold
- **THEN** the client receives a `not_found` error
