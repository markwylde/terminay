## 1. Adapter

- [x] 1.1 Add `HeadlessPassphraseVaultAdapter.rewrap(secret)` and an `initialized` getter: `rewrap` requires unlocked, derives a protector key under a fresh salt, wraps the current data key, persists at the next revision, zeroizes its own buffers, and leaves the adapter unchanged when persistence fails. Verified by `packages/server-core/test/headless-vault.test.mjs`: after `rewrap` a reopened adapter unlocks with the new secret and reads every entry; the old secret fails; a locked adapter refuses; a short secret is rejected; a storage that throws on write leaves the adapter unlocked and reading its entries under the old envelope.

## 2. Standalone composition

- [x] 2.1 In `apps/terminay-server/src/headlessVault.ts`, implement the startup state machine in design.md (open, pending recovery, descriptor, key file, new vault, conversion, pending cleanup). Write key files with `writeFileDurably` at 0600 and fsync the directory after a promotion rename. Verified by `apps/terminay-server/test/headless-vault.test.mjs`: first start creates a 0600 key and an unlocked vault; restart reads a stored secret; a descriptor unlock writes no key file; a descriptor with `convertToKeyFile` writes one, and later starts with and without the old descriptor unlock; a descriptor that fails falls through to a valid key file; a passphrase envelope with no key and no descriptor stays locked with a log line and unchanged files.
- [x] 2.2 Crash safety. Verified by the same file with injected faults at: pending write, envelope write during re-wrap, and promotion rename. After each, a fresh start (with the old descriptor where it applies) unlocks and reads every secret, and no pending file is deleted while the vault is locked.
- [x] 2.3 Key file validation: `lstat` regular file, at most 4096 bytes, trailing CR/LF trimmed, group/other bits removed with a log line, an unusable file left untouched. Verified by tests for a directory at the key path, an oversized file, a 0644 file (tightened and unlocked), and a mismatched key (locked, file unchanged, no key bytes in any log line).
- [x] 2.4 Add `--vault-convert-to-key-file` to `cliOptions.ts`, rejected without `--vault-unlock-fd`, and pass it through `cli.ts`. Fix the help text for `--vault-unlock-fd`, which claims a controlling-terminal default. Verified by `apps/terminay-server/test/headless-vault.test.mjs` CLI cases.

## 3. Errors

- [x] 3.1 Map `VaultServiceError` in `dispatchError`: `locked` and `unavailable` to `unavailable` with fixed messages, `missing` to `not_found`. Verified by `packages/server-core/test/vault-service.test.mjs` asserting all three and that other errors are not mapped.

## 4. Docs

- [x] 4.1 Update `docs/operations/standalone-server.md`: the vault paragraph (automatic key file, descriptor, conversion, recovery), the environment-file paragraph, and the backup section (the data root holds the vault key). Verified by review against ADR-0118.

## 5. Verification

- [x] 5.1 `openspec validate server-vault-unlocks-itself` passes, and `openspec validate --all` reports no failure from this change (its seven failures are in other open changes and are identical on `main`). Verified by both runs.
- [x] 5.2 `npx turbo run build --filter=@terminay/server...` then, each under `timeout 600`, `node --test --test-force-exit --test-timeout=120000` over `packages/server-core/test/{headless-vault,vault-service,vault-import,extension-provider-vault}.test.mjs` and `apps/terminay-server/test/headless-vault.test.mjs`, plus `scripts/electron-safe-storage-vault.test.mjs` as the embedded-protector regression. Verified by exit status 0.
- [ ] 5.3 Pull request CI statuses on Gitea are all `success` or `skipped`. Verified with `tea`.
