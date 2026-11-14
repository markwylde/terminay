## Why

On a standalone server, anything that saves a secret fails with
"command failed". A bot's machine never starts, and storing an AI key, a bot
token, an extension credential, or a connected MCP server's credential fails
the same way. The only way out is an operator who knows to start the server with
`--vault-unlock-fd` and a passphrase. The installer never sets that up, so on a
typical install the vault has never been created and every restart or upgrade
leaves it locked. The client is told only "command failed", so nothing points at
the vault.

The headless vault only unlocks from an inherited descriptor (ADR-0003). That
suits an operator with a secret store, but it makes the default install
unusable, and the user never asked for a passphrase.

## What Changes

- A standalone server unlocks its vault on startup with no operator input. On
  first start it generates a random vault key and keeps it in an owner-only file
  in its data root, `vault/headless-v1.key`. Every later start reads that file
  and unlocks.
- An operator who supplies `--vault-unlock-fd` keeps an operator-managed vault:
  the descriptor is tried first and no key file is written.
- `--vault-convert-to-key-file`, given with `--vault-unlock-fd`, converts a
  passphrase vault to a key file once, crash-safely. Later starts need nothing;
  a descriptor that no longer unlocks falls through to the key file.
- A vault that cannot unlock starts locked, its files untouched, and the server
  logs the reason and the fix, never key material.
- A vault failure reaches the client as a named error ("The server vault is
  locked"), not "command failed".
- The spec and the CLI help drop controlling-terminal unlock. It was specified
  but never reachable at startup.
- ADR-0118 supersedes ADR-0003's rule that a key file beside the vault is never
  an unlock mechanism, for the standalone server.

Embedded Desktop is unchanged: its vault stays protected by OS secure storage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-owned-workspace-state`: the headless vault unlocks from a
  server-generated key file; a descriptor stays operator-managed unless
  converted; vault errors reach the client by name.

## Impact

- `packages/server-core/src/settings/headlessVault.ts`: `rewrap` and
  `initialized`.
- `apps/terminay-server/src/headlessVault.ts` and `cliOptions.ts`: the startup
  state machine, key file handling, the conversion flag, and help text.
- `packages/server-core/src/dispatcher.ts`: map `VaultServiceError` to a
  protocol error.
- `docs/operations/standalone-server.md`: vault section, environment-file
  paragraph, and backup note.
- Security: a copy of the data root can decrypt the vault (ADR-0118).
