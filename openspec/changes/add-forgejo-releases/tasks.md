## 1. Release transport

- [x] 1.1 Implement canonical-forge draft preparation, immutable tag checks, retry-safe asset uploads and verified publication; verify with a local mock API covering failure cases.

## 2. Build workflow

- [x] 2.1 Add Trigger Release for native macOS arm64 and Linux x64 with existing signing and packaged checks; verify workflow structure and GitHub workflow preservation.

## 3. Operations and validation

- [x] 3.1 Document runner prerequisites, secrets, dispatch and draft retries; verify commands and inputs against the workflow.
- [x] 3.2 Run release transport tests, workflow contract checks and openspec validate --all; record results.
- [x] 3.3 Dispatch a release on configured canonical-forge runners and verify both published platform assets; requires installed workflow and signing credentials.

Verification on 2026-11-04: `npm run test:release-config` passes all 45 tests; Biome passes for changed JS/package files; workflow YAML and all 23 shell steps parse; `git diff --check` passes. The new OpenSpec change validates. `openspec validate --all` reports four existing unrelated failures in linked-folders, one-window-one-server, outbound-bot-triggers, and server-notification-manager. Apple secret names and APPLE_ID/APPLE_TEAM_ID are present on the canonical forge. Live release verification completed in run 23424: all four jobs passed and v6.0.1 was published with all eight verified assets. PRs #493 and #494 each passed all 28 CI checks.


## 4. Automatic semantic versions

- [x] 4.1 Remove version input and reuse the existing semantic-version helper, preserving draft retries and published no-ops; verify feature, fix, breaking-change and retry cases.
- [x] 4.2 Update operator instructions, run release tests and lint, and validate the OpenSpec change and workflow; verify the follow-up PR checks pass.


## 5. macOS release runner compatibility

- [x] 5.1 Replace setup-node on the macOS VM with a checksum-pinned shell installation of Node 24.15.0, retaining Linux setup-node and existing signing checks; verify shell/workflow syntax, release tests, direct execution on macOS, and the packaged macOS PR check using the same installer script.

Run 23419 passed preparation and created draft v6.0.0, then the macOS runner transport failed with `write |1: broken pipe` while starting actions/setup-node. No macOS build or publication occurred.


## 6. AI release notes

- [x] 6.1 Wire the shared AI generator and fallback into publication, enforce non-empty notes and retain provenance; verify publication content and missing-notes failure cases.
- [x] 6.2 Update operator notes and validate release tests, lint, OpenSpec and workflow syntax; create the follow-up PR and read back all CI statuses.


## 7. Early live AI preflight

- [x] 7.1 Generate notes before dependencies/tests/builds, fail preparation on AI errors, and persist successful notes in the draft for publication; verify a real preflight process with mocked HTTP 401 and successful provider responses, plus saved-note publication tests.
- [ ] 7.2 Validate the workflow ordering, release tests and lint, and push directly to origin/main as explicitly requested.

PR #498 passed all 28 checks, including the workspace retry. Run 23448 exposed HTTP 401 only after its builds; this revision moves the actual credential request before that work.
