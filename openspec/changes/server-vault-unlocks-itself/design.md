## Context

The standalone server composes a `HeadlessPassphraseVaultAdapter`. Its data key
is wrapped by a key derived with scrypt from an unlock secret, and the envelope
lives at `<data-root>/vault/headless-v1.json`. The only wired unlock input is
`--vault-unlock-fd`. The controlling-terminal reader exists in code but is not
called at startup, and the CLI help claims it is the default. The installed
systemd unit passes no descriptor, so the vault is locked on every start, and on
most installs it was never created.

## Goals / Non-Goals

**Goals:**

- A default install has a working vault from its first start, across restarts
  and upgrades, with no operator input.
- An operator who manages the vault secret keeps doing so, unchanged.
- An existing passphrase vault can become self-unlocking on request.
- A locked vault is diagnosable from the client and from the server log.

**Non-Goals:**

- Changing the envelope format, cipher, or KDF parameters.
- Changing the embedded Desktop vault.
- TPM or `systemd-creds` sealing. An operator who wants that keeps using
  `--vault-unlock-fd` with a service-manager credential.
- Controlling-terminal unlock. It was never reachable at startup; the spec and
  CLI help now say what the server does.

## Decisions

### The unlock secret is a server-generated key file in the data root

The key is 32 random bytes, base64url-encoded (43 characters), in
`<data-root>/vault/headless-v1.key`, mode 0600, written with
`writeFileDurably`. It is passed to the adapter's existing `unlock`, so the
envelope still wraps its data key with scrypt and nothing about the envelope
changes. scrypt adds no strength to a random key, but one protector avoids a
second envelope format.

Rejected: a key outside the data root (`/etc/terminay`). The server runs
unprivileged and cannot create one there; a user-scope install and the
container image have no such place. Rejected: `systemd-creds`. It is not
available in the container image or on a user-scope install, and needs root.

Boundary: the vault's confidentiality now rests on the data root's
confidentiality. A copy of the data root, including an operator backup, can
decrypt every vault secret. ADR-0118 records this. ADR-0011's "backups contain
redacted metadata" concerns the server's own migration backups, which do not
include the `vault/` directory, so it still holds.

### Key file reads are bounded and validated

A key file is read with `lstat` first: it must be a regular file (not a symlink
or directory) of at most 4096 bytes, or it is "present but unusable". Trailing
CR/LF is trimmed. A key file readable by group or others is tightened to 0600
and logged. An unusable or non-matching key file is never deleted, rewritten, or
replaced; the vault stays locked and the log names the file.

### Startup state machine

Inputs: an envelope (present or not), `headless-v1.key`, `headless-v1.key.pending`,
a descriptor (`--vault-unlock-fd`), and `--vault-convert-to-key-file`.

1. **Open.** If the envelope cannot be read, the vault is `unavailable`; log and
   stop.
2. **Pending recovery.** If a pending file exists and an envelope exists, try
   it. If it unlocks, promote it (rename over `headless-v1.key`, then fsync the
   directory) and go to 7. If promotion fails, keep the pending file (it unlocks
   the vault and is retried next start), log, and go to 7.
3. **Descriptor.** If a descriptor is given, read it once and try it. If it
   unlocks, go to 6. If not, log and continue to 4: an operator who converted
   still supplies the old descriptor, and the key file now holds the secret.
4. **Key file.** If the key file exists, validate and try it. If it unlocks, go
   to 7. If not, log and stop locked.
5. **New vault.** If there is no key file and no envelope, generate a key, write
   it, and unlock (creating the envelope); go to 7. If there is an envelope but
   no key file, log that it needs `--vault-unlock-fd`, and stop locked.
6. **Conversion.** Only when `--vault-convert-to-key-file` is given and no key
   file exists: write a new key durably to the pending path, re-wrap the data
   key under it (the commit point), then promote the pending file as in 2. A
   failure before the re-wrap persists leaves the envelope on the descriptor's
   secret; a failure after leaves the pending file holding the only secret that
   opens it. Either way the pending file is kept, and step 2 resolves it on the
   next start. Without the flag, a descriptor-unlocked vault stays
   operator-managed, and no key file is written.
7. **Pending cleanup.** If the vault is unlocked by any secret other than a
   pending file that still exists, that pending file is a candidate that never
   committed: remove it. A pending file is never removed while the vault is
   locked.

No path writes the envelope except a first unlock (5) and a re-wrap (6), and no
path removes or rewrites a key file that might be the only one opening the
envelope.

### Re-wrap is a new adapter operation

`HeadlessPassphraseVaultAdapter.rewrap(secret)` derives a new protector key with
a fresh salt, wraps the current data key, and persists the envelope at the next
revision. It requires the vault to be unlocked. If persistence fails, the
adapter keeps its previous envelope and keys. Entries are not re-encrypted;
`rotate` covers a new data key.

### Vault errors are named on the wire

`dispatchError` maps `VaultServiceError`: `locked` and `unavailable` become
`unavailable` with "The server vault is locked" or "The server vault is
unavailable"; `missing` becomes `not_found`. All are not retryable. The message
is fixed text and carries no secret.

## Risks / Trade-offs

- Anyone with read access to the data root, or a copy of it, can decrypt the
  vault. Accepted per ADR-0118. Operators who need more keep
  `--vault-unlock-fd` and do not convert.
- A lost key file leaves a vault locked for good. The log names the file and
  says to move the envelope aside to start an empty vault.
