## 1. Portable item model (`src/importExport/`)

- [x] 1.1 Define `PortableItem`, `ItemKind`, `itemKey` (kind plus trimmed, case-folded name), and a canonical, sorted-key, case-sensitive `fingerprint`. Verify: unit tests show that key order and ids do not change the fingerprint, that name case does not change the key, and that content case does change the fingerprint.
- [x] 1.2 Define an explicit portable schema and bounds for each kind (`validatePortable`), mirroring the server's limits, and refusing ids, revisions, unknown fields, and unknown kinds. Verify: unit tests refuse each forbidden field and each out-of-bounds value.
- [x] 1.3 Implement the macro adapter: read with revision, toPortable, plan, and apply through `upsert` with `expectedRevision`. A missing category is added through a revision-guarded `replace`. Verify: unit tests with a fake client cover add, replace (keeps the target id), keep-both naming `(2)`/`(3)`, category creation, and a conflict reported as changed since review.
- [x] 1.4 Implement the workflow-template adapter: omit step ids, ensure categories through revision-guarded calls, and write through `upsertTemplate` with `expectedRevision`. Verify: unit tests show that step ids are absent and that a conflict maps to changed since review.
- [x] 1.5 Implement the shell-profile adapter for `kind: "custom"` only (catalogue, detail, create, update, validate), mapping a refused detail to **not permitted**. Verify: unit tests show that system and discovered entries are excluded, that an unavailable target gives a warning, and that a denied detail gives not permitted.
- [x] 1.6 Implement the automation adapter: named references `{macro}`/`{shellProfile}`, `enabled` excluded from the fingerprint, always written disabled, and a warning on `cwd`. Verify: unit tests show that an enabled source and a disabled copy are **same**, and that the write has `enabled: false`.
- [x] 1.7 Implement the settings-category adapter over every field key of the portable categories in `terminalSettingsSections`, writing a nested patch through `SettingsClient.update`. Verify: unit tests show that Replace makes the category **same**, that no key outside the category is written, and that remote, recording, shell, and updates are never produced.
- [x] 1.8 Implement the matrix model: rows by key, and cell states same, differs, missing, duplicate name, not supported, not permitted, and not ready. Verify: unit tests for every spec scenario under the matrix, matching, column-state, and duplicate requirements.
- [x] 1.9 Implement the review planner: per-target nodes, clash choices by kind with none preselected, up to date, dependency nodes, a Replace target picker for duplicates, and blocking of unresolved references. Verify: unit tests show that Apply is blocked until every clash is decided, that settings offer only Replace and Skip, and that a missing dependency is added.
- [x] 1.10 Implement the apply runner: topological order, binding references to dependency outcomes (Replace, Keep both, Skip or up to date, failed), revision updates after each write, results for each item, and no rollback. Verify: unit tests cover a Keep both binding to the new copy, a failed dependency blocking its automation, independent items continuing after a failure, and a revision conflict injected between read and write.
- [x] 1.11 Implement the selection model: default source (active project's server, otherwise the primary connection), source change clearing the selection, and review invalidation on connection change. Verify: unit tests for each of these.

## 2. Bundle codec

- [x] 2.1 Implement the encoder for `{format:"terminay.import-export",version:1,…}`, which adds dependencies, and the decoder, which validates in full and refuses with a reason (4 MiB cap, malformed, unknown format, version, or kind, forbidden field, duplicate key, out-of-bounds item, dangling reference). Verify: unit tests cover a round trip that is **same** as the source, an automation-only export that includes its macro, and each refusal reason.
- [x] 2.2 Add the npm script `test:import-export` (`node --test --test-force-exit --test-timeout=120000 --experimental-strip-types`) and chain it from `test:workspace-models`. Verify: `npm run test:import-export` passes.

## 3. Desktop host integration

- [x] 3.1 Add the `open-import-export` menu command and the **Import & Export…** item directly under **Settings…** in the Terminay menu on every platform. Verify: extend the application-menu tests run by `test:window-menu-policy` to assert its position and dispatch.
- [x] 3.2 Add the bounded `import-export.bundle.save` host action (bytes plus sanitized filename, user gesture, save dialog, 4 MiB cap) to the bridge allow-list and `src/host/nativeActions.ts`. Verify: extend `test:security-boundaries` to cover acceptance and the refusal of oversize payloads and path-like names.
- [x] 3.3 Route `open-import-export` from the native menu and the Command Bar to `openSettings('import-export')`, on Desktop only. Verify: a test shows that the Command Bar entry is absent when `hostKind` is `browser`.

## 4. Settings category UI

- [x] 4.1 Register `import-export` in the Connections group, on Desktop only, with the server selector hidden for it. Verify: update `settingsCategoryGroups.test.ts` and the settings selection tests.
- [x] 4.2 Build the matrix page following mockup concept A: kind chips with counts, a text filter, **Only differences**, the source marker, target checkboxes, glyph-and-word cells, row checkboxes, a summary bar, and **Review**. All controls are native and keyboard reachable. Verify: E2E 5.1 asserts the cells, the filters, the default source, and keyboard selection.
- [x] 4.3 Build the review view: per-target groups, a diff for each clash, choices by kind with none selected, a duplicate target picker, dependency and warning notes, and Apply gated on every decision. Verify: E2E 5.1 asserts that Apply is disabled until a decision is made, and the dependency note.
- [x] 4.4 Build the results view and the matrix refresh driven by each kind's change events. Verify: E2E 5.1 asserts the per-item results and that the matrix shows **same** after the copy without a manual reload.
- [x] 4.5 Add **Export selected…**, with the plain-text warning, and **Import file…**, which adds a read-only column that can only be a source and shows a reason when a file is refused. Verify: E2E 5.2.

## 5. End-to-end and specs

- [x] 5.1 Add `e2e/import-export.spec.ts` (Desktop harness, Local plus a second attached server). Open the category from the menu command. Check the default source and the filters. Attach the remembered second server from its **Not attached** column. Copy new macros, then a differing macro with Replace. Assert Apply gating, the results, and the matrix converging to **same** without a reload. Templates, settings categories, and automations (disabled on arrival, with a missing macro dependency) are covered by the 1.x unit tests against the same apply runner. Verify: `timeout 1500 npm run test:e2e -- e2e/import-export.spec.ts` passes.
- [x] 5.2 Extend the E2E with a bundle export and import round trip, and the refusal of a bundle containing an id. Verify: the same command passes.
- [x] 5.3 Run `openspec validate --all`, `npm run lint`, and the typecheck. Verify: the change validates with no errors, there are no failures beyond the 7 that already exist on `main`, and there are no new lint or type errors.
