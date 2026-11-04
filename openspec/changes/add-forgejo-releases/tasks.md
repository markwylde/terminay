## 1. Release transport

- [x] 1.1 Implement canonical-forge draft preparation, immutable tag checks, retry-safe asset uploads and verified publication; verify with a local mock API covering failure cases.

## 2. Build workflow

- [x] 2.1 Add Trigger Release for native macOS arm64 and Linux x64 with existing signing and packaged checks; verify workflow structure and GitHub workflow preservation.

## 3. Operations and validation

- [x] 3.1 Document runner prerequisites, secrets, dispatch and draft retries; verify commands and inputs against the workflow.
- [x] 3.2 Run release transport tests, workflow contract checks and openspec validate --all; record results.
- [ ] 3.3 Dispatch a release on configured canonical-forge runners and verify both published platform assets; requires installed workflow and signing credentials.

Verification on 2026-11-04: `npm run test:release-config` passes all 45 tests; Biome passes for changed JS/package files; workflow YAML and all 23 shell steps parse; `git diff --check` passes. The new OpenSpec change validates. `openspec validate --all` reports four existing unrelated failures in linked-folders, one-window-one-server, outbound-bot-triggers, and server-notification-manager. Apple secret names and APPLE_ID/APPLE_TEAM_ID are present on the canonical forge. Live release verification remains pending deployment of this branch's workflow.


## 4. Automatic semantic versions

- [x] 4.1 Remove version input and reuse the existing semantic-version helper, preserving draft retries and published no-ops; verify feature, fix, breaking-change and retry cases.
- [ ] 4.2 Update operator instructions, run release tests and lint, and validate the OpenSpec change and workflow; verify the follow-up PR checks pass.
