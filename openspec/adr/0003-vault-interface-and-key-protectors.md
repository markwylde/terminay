# ADR-0003: Hold server secrets in a vault with AES-256-GCM entries and platform key protectors

Status: accepted
Date: 2026-07-27

## Context

Server services need provider credentials, SSH keys, and similar secret
material. Those secrets must survive restarts, must not be readable from a
process listing or a crash artifact, and must never be handed to server code as
a long-lived plaintext value. Desktop and headless servers have different
protection available: Desktop can reach OS keychain services through Electron,
whereas a headless Linux server has no user session to unlock.

Convenience unlock mechanisms — a command-line argument, an environment
variable, or a plaintext key file beside the database — defeat the purpose,
because each of them leaks the key into process metadata, logs, or a backup of
the data root.

## Decision

Server services use a vault interface providing status, unlock and lock, list
secret metadata, put, replace, delete, rewrap of the data-encryption key, and
`withSecret`, which supplies plaintext only to a server-side callback.

Vault entries use AES-256-GCM with a unique random nonce and authenticated data
binding server id, secret id, and schema version. A random data-encryption key
is wrapped by a platform-specific key protector and is never stored raw.

Embedded Desktop uses Electron safe storage to wrap the key only where the
selected backend provides real OS protection. Linux `basic_text` is rejected as
a secure protector. Headless servers wrap the key with a passphrase-derived key
using scrypt, read interactively from `/dev/tty` or once from an inherited
key-file descriptor suitable for service-manager credentials.

Command-line arguments, environment variables, and plaintext key files beside
the database are not accepted unlock mechanisms.

## Consequences

- Plaintext secrets exist only inside a scoped `withSecret` callback, so
  callers cannot retain them by accident.
- Headless deployment requires an operator interaction or a service-manager
  credential descriptor; there is deliberately no unattended
  environment-variable path.
- Rejecting Linux `basic_text` means Desktop on some Linux configurations
  cannot use the embedded protector at all, rather than appearing to be
  protected when it is not.
- Envelope authentication makes the vault tamper-evident but not
  rollback-resistant on its own: a complete older valid envelope stays
  cryptographically valid, so freshness is a state-repository concern and
  requires the expected canonical revision in the transactional repository
  (see [ADR-0002](./0002-sqlite-state-repository.md)).

### Evidence

`scripts/vault-reference.mjs` provides the extraction-shaped vault interface and
two executable key protectors without selecting a production repository. Its
version-1 envelope fixes AES-256-GCM, 96-bit nonces, 128-bit tags, canonical
tuple AAD, a 256-bit data-encryption key, and scrypt at N=32768, r=8, p=1 with a
128-bit random salt and a 64 MiB resource ceiling. The parser accepts exactly
those parameters before doing KDF work, preventing persisted metadata from
inflating unlock resources. Serialized envelopes are limited to 8 MiB, 4096
entries, and 1 MiB per secret. A data-encryption key is limited to fewer than
2^32 AES-GCM invocations, every entry uses a random nonce, and currently active
same-key nonce duplication is rejected.

An AES-GCM manifest under an HKDF-SHA-256 key derived from the data-encryption
key authenticates the envelope revision plus exact entry membership, ids, names,
order, and encrypted fields, so renaming, deleting, reordering, or changing an
entry fails unlock.

`scripts/vault-reference.test.mjs` exercises lock, unlock, status, metadata
listing, put, replace, delete, scoped `withSecret`, rewrap, snapshot reload,
passphrase rotation, wrong-passphrase rejection, authenticated manifest
tampering, same-key nonce uniqueness across entry changes and rewrap, bounded
input, and best-effort buffer zeroization. An atomic two-snapshot fixture is
killed after temporary-file sync, previous-snapshot rotation, and current-file
installation; every state recovers a complete authenticated snapshot, resumes to
the new snapshot, and falls back from an authenticated-corrupt current snapshot.
This is envelope persistence evidence, not repository evidence. The test also
runs the embedded protector against real Electron safe storage and rejects Linux
`basic_text`.

Headless input accepts only an echo-disabled `/dev/tty` read or an inherited
descriptor numbered 3 or higher. Both paths are bounded to 4096 bytes and close
the descriptor. Injected system-call tests prove echo suppression, restoration,
closure, and short-input zeroization; a real pseudo-terminal proves `/dev/tty`
input is not echoed, and a real child descriptor proves one-shot consumption and
closure. Unlock-owned buffers and authenticated-decryption intermediates are
cleared on success and failure.

`scripts/safe-storage-import.test.mjs` creates a real safe-storage secret and
fault-injects the source-read, decrypt, vault-encryption, key-wrap, transaction,
entry-write, key-write, ledger-write, and post-commit boundaries. Each case
recovers twice and proves one committed vault entry, one wrapped key, one
completed import-ledger row, and a decryptable matching value. The proof scans
the complete isolated profile, temporary, log, protocol-trace, and crash area
after seeding, failure, recovery, and repeated recovery; the plaintext sentinel
does not persist. Linux `basic_text` returns an insecure-protector rejection
before the legacy secret or vault state is created.
