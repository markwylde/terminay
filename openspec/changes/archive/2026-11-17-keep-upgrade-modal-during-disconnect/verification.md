# Verification

- Docker application build: passed (17 build tasks successful).
- Docker Electron regression: `npm run test:e2e -- e2e/server-upgrade.spec.ts --grep 'a server that restarts and rolls back'`: Playwright reports 1 passed in 33.3 seconds. The test observed a session-connect timeout, preserved the same modal DOM node and card position, verified its backdrop intercepts the Retry control, and recovered automatically into the rollback outcome. Dark/light captures are in `.docker-cache/e2e/20261117T233021Z-1415960/`.
- Upgrade UI/model tests in that exact Docker image: 65 passed, 0 failed. The initial host UI run could not bundle because the shared local protocol dist was stale; model tests passed there too.
- Biome check on both changed TypeScript files: passed (local CLI emits a pre-existing schema-version notice).
- `git diff --check`: passed.
- `openspec validate --all`: this change passed; 124 items passed and seven unrelated active changes failed: add-terminay-bots, linked-folders, one-window-one-server, outbound-bot-triggers, phone-review-fixes, server-notification-manager, unified-settings-window.

Review confirms one stable provider/board/modal tree for ready, reconnecting, unavailable, and incompatible presentations. No transport, retry, privileged action, or server behaviour changed. Outcome cards use the existing initiated-here visibility/close policy.

Specs synced and change archived. `openspec validate --all --archived`: this archive passed; 302 items passed, eight unrelated historical changes failed validation.
