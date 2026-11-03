## Reproduction

Before implementation, the long-history held-session recovery case failed three times. The short-history control passed. The same process PID still answered a key and redrew, but DECRQM reported mode 1003 disabled, the PTY wheel count stayed unchanged, and the renderer exposed old terminal rows after a wheel gesture. The observed trigger was app relaunch/session recovery; macOS unlock causality remains unconfirmed.

## Verification after implementation

- Docker Electron tests: **12 passed**, using `npm run test:e2e -- e2e/terminals-survive-restart.spec.ts e2e/terminal-mouse-restore.spec.ts e2e/holder-relaunch.spec.ts --retries=0`. This includes the originally failing long-history case, the short-history control, SGR/default mouse encoding, disabled-mode shell selection and scrolling, native focus, tab switching, renderer reload, session moves, and holder relaunch.
- Server-core: **164 passed** across `session-holder*.test.mjs`, `terminal-presentation-*.test.mjs`, `terminal-adopted-presentation.test.mjs`, and `terminal-replay-cost.test.mjs`. Tests ran in the Docker image after building protocol-conformance and server-core. Coverage includes frozen versions 1/2 and version 3, detached output/mode changes beyond the ring, fragmented UTF-8/CSI and resizes, bounded malformed transfers, exhaustion, disconnect races, raw offset preservation without duplicate parsing, authentication, and replay cost.
- Copied holder runtime: **10 passed** with `node --experimental-strip-types --test scripts/session-holder-runtime.test.mjs`, on macOS and in Docker. The new test removes the original installation and resolves both headless presentation dependencies from the copied runtime.
- `npm run build:app` passed in Docker, including TypeScript and the Desktop/server UI builds. Biome lint passed on changed server modules and the new presentation recovery test. `git diff --check` passed.
- `openspec validate preserve-held-terminal-presentation --strict` passed.
- `openspec validate --all`: **105 passed, 0 failed**.
- `openspec validate --all --archived`: **204 passed, 4 pre-existing failures**, all incomplete archived task lists: `2026-09-06-agent-provider-status-conformance`, `2026-10-07-notifications-icon-and-project-dot`, `2026-10-10-macros-script-editor`, and `2026-10-27-github-worktree-status`.

## Scope and rollout

The owner requested proposal and implementation in one PR and explicitly waived the proposal-on-main checkpoint. All work stays in the worktree. The change remains unarchived until merged. New holder generations capture presentation from session creation; older generations retain their frozen raw protocol and cannot reconstruct modes already evicted before this implementation.
