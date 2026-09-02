# Task 19/20 release and migration audit

Date: 2026-07-27

This is a bounded evidence ledger for the unchecked migration gates and the
non-checkbox operational release follow-ups. It records what the current tests prove and what they do not prove; it
does not promote a checklist item merely because a related implementation or
workflow exists.

The machine-checked inventory is produced by
`scripts/task19-20-audit.mjs` and tested by
`scripts/task19-20-audit.test.mjs`.

## Evidence that is present

### Migration

- `packages/server-core/test/migration-compatibility.test.mjs` proves that
  sanitized manager metadata retains the canonical
  `https://<session>.terminay.com` origin and excludes pairing fragments,
  reconnect grants, and device keys from manager/trust output.
- `packages/server-core/test/remote-reconnect.test.mjs` proves exact-origin
  reconnect challenge/proof behavior for the current reconnect-grant store.
- `scripts/task19-migration-reconnect.test.mjs` combines the real
  `MigrationRunner` with the persisted Electron reconnect store. It proves
  that the clean session origin survives manager migration, the origin-bound
  grant reloads unchanged, and a fresh challenge/proof remains valid after
  migration. It does not claim hosted deployment or full pairing E2E parity.
- `packages/server-core/test/migration-recovery.test.mjs` proves a direct
  server-bundle recovery descriptor and reports legacy preload and
  terminal-only adapters as `retain-until-parity`. The Desktop compatibility
  runtime tests prove that `TERMINAY_LEGACY_COMPATIBILITY` is fail-closed,
  enables only the named renderer/terminal-only path, and exposes explicit
  server replacement/removal descriptors. They do not prove full feature
  parity or final legacy-authority removal.
- `scripts/one-server-model-boundary.test.mjs` now fixes the connected
  renderer authority baseline at exact zero. The compatibility matrix records
  that gate as architecture evidence, not as rendered parity: partial and open
  cells remain explicit until their stated four-surface runs exist.
- `packages/server-core/test/migration-compatibility.test.mjs` proves a
  redacted backup, resumable progress, explicit restore, and a typed
  no-restore failure. `packages/server-core/test/migration-electron-rollback.test.mjs`
  additionally proves that an opaque Electron snapshot is restored before the
  server-only commit boundary, while a committed migration refuses implicit
  Electron rollback and requires explicit backup recovery.
- The compatibility matrix test proves deterministic version failures before
  backup/import.
- `scripts/hosted-deployment-order.test.mjs` proves the local hosted rollout
  contract: the next bootstrap/signaling compatibility window covers every
  currently deployed client and every dependent client release, hosted
  publication and verification precede client publication, and previous-hosted
  retirement follows the dependent clients. It deliberately does not claim
  that the separately deployed hosted service has executed the rollout.

### Release and operations

- `scripts/task20-release-lifecycle.test.mjs` proves the release state
  transition policy, while `scripts/task20-release-artifact.test.mjs` stages
  file-backed Desktop/standalone-like artifacts and verifies manifest hashes,
  complete file sets, active-pointer switching, rollback, target separation,
  and incompatible-candidate recovery. These checks do not install or upgrade
  a signed Desktop/server archive.
- `scripts/task20-supply-chain-audit.test.mjs` proves deterministic lockfile
  metadata, SPDX output, and fail-closed integrity/license handling. The
  accompanying evidence records a zero JavaScript advisory run and the
  unresolved native OpenSSL candidate blocker; it does not prove native ABI,
  signing, notarization, or publication.
- `scripts/task20-direct-ui-mismatch.test.mjs` proves that a direct server UI
  remains serveable while an incompatible Desktop version is rejected.
- `specs/operations/release-update-policy.md` defines independent update
  targets and recovery behavior. It is policy evidence, not a packaged
  installer execution record.
- `scripts/release-readiness.test.mjs` and the repository release workflow
  prove configured ordering and local manifest checks. They do not prove that
  the configured native release lanes or hosted deployment have executed.

## Remaining implementation and operational work

Task 19 retains its locally actionable unchecked checklist items. Task 20's
repository implementation checklist is complete; its externally executed
release requirements remain explicit non-checkbox operational follow-ups:

- Four-surface rendered parity, real hosted pairing/reconnect E2E, and final
  legacy-authority removal are incomplete. The deterministic
  application-protocol inventory and full checked-in serial Playwright suite
  are green local evidence, not substitutes for those external surface gates.
- Signed/notarized publication, supported-platform standalone publication,
  native release-runner probes, and selected WebRTC artifact certification are
  absent.
- Clean install/upgrade/rollback of a packaged signed artifact remains absent;
  the new evidence is deliberately limited to unsigned file-backed artifacts.
- Task 20 is archived in `tasks_completed/`; archiving records completion of
  local implementation and does not claim that these external release
  follow-ups have executed.

## Focused audit command

```sh
node --test scripts/task19-20-audit.test.mjs
```

The audit intentionally has no runtime imports and makes no release,
deployment, or filesystem changes outside its read-only test fixtures.

## Audit run

On 2026-07-27, the shared packages built successfully, then these focused
checks passed:

```text
21 migration/inventory/recovery/reconnect tests passed
4 hosted compatibility-order tests passed
14 release/readiness/lifecycle/supply-chain/direct-UI tests passed
1 task-19/20 checklist-boundary test passed
```

The production dependency audit also passed with 543 lockfile records and
zero info, low, moderate, high, or critical advisories. These results update
the evidence record only; they do not satisfy the operational release follow-ups listed
above.

## Rollback boundary verification

The focused rollback slice was reverified on 2026-07-27:

```text
16 migration compatibility, recovery, and Electron-boundary tests passed
server-core TypeScript build passed
task-19/20 checklist-boundary audit passed
git diff --check passed
```

The tests cover pre-commit Electron restoration, persisted uncertain-commit
fail-closed behavior, committed-state refusal of implicit Electron rollback,
and explicit server-backup recovery without Electron restoration.
