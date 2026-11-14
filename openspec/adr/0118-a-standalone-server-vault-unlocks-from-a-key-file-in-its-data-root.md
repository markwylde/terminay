# ADR-0118: A standalone server's vault unlocks itself from a key file in its data root

Status: accepted, supersedes ADR-0003 in part
Date: 2026-11-14
Supersedes: ADR-0003 (headless unlock: "plaintext key files beside the database are not accepted unlock mechanisms", and the consequence that headless deployment requires an operator interaction or a service-manager credential descriptor)

## Context

ADR-0003 lets a headless vault unlock only from a typed passphrase or an
inherited descriptor, and rules out a key file beside the vault. Only the
descriptor was ever wired at startup, and the installer never supplied one, so
on a default install the vault was never created and stayed locked across every
restart and upgrade. Every feature that stores a secret failed: bot machines,
bot tokens, AI keys, extension and MCP credentials. Users had not asked for a
passphrase and had no in-app way to supply one.

The data root is already the standalone server's trust boundary for its
identity: it holds the device and host keys and pairing material in owner-only
files.

## Decision

1. **The standalone server generates its own vault key.** On first start, with
   no envelope, no key file, and no unlock descriptor, it writes 32 random bytes,
   base64url-encoded, to `<data-root>/vault/headless-v1.key` (mode 0600,
   durable write) and unlocks with it. Every later start reads the file and
   unlocks. No operator input is needed.
2. **An operator secret stays operator-managed.** `--vault-unlock-fd` is still
   accepted and tried first. A vault unlocked that way gets no key file unless
   the operator asks for one with `--vault-convert-to-key-file`. Command-line
   arguments, environment variables, and ordinary stdin are still never unlock
   channels.
3. **Conversion is explicit and crash-safe.** It writes the new key aside,
   re-wraps the data key (the commit point), then puts the key in place. A key
   file that might be the only one opening the envelope is never deleted or
   rewritten.
4. **The envelope format is unchanged.** The key file's contents are the unlock
   secret given to the existing scrypt protector.
5. **Embedded Desktop is unchanged.** It stays on OS secure storage, and Linux
   `basic_text` is still rejected there.

## Consequences

- A default standalone install has a working vault from its first start.
- The vault's confidentiality now equals the data root's. Anyone who can read
  the data root, or holds a copy of it such as an operator backup, can decrypt
  every provider secret. Before, such a reader could impersonate the server but
  not read its secrets. Operator backups of the data root must be protected
  accordingly. The server's own migration backups do not include `vault/`, so
  ADR-0011's redacted-backup guarantee is unaffected.
- An operator who wants the vault secret off the data-root disk uses
  `--vault-unlock-fd` with a service-manager credential and does not convert.
- A lost or mismatched key file leaves the vault locked; the server logs the
  reason and the fix at startup and never touches the files.
