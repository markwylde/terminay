# Verification

## Reproduction before implementation

`npm run test:e2e -- e2e/terminal-touch-tui.spec.ts --workers=1 --retries=0`

Both SGR and binary mock TUIs accepted desktop input (`clicks=1 releases=1`) but remained at those counters after a real Chromium touch tap; both tests failed waiting for `clicks=2 releases=2`. Touch emulation was enabled before terminal initialization, which is necessary for xterm to register its gesture target.

Red-run artifacts: `.docker-cache/e2e/20261104T090216Z-35983/`.

## Focused tests

`node --test scripts/terminal-touch-selection-and-links.test.mjs scripts/terminal-mobile-keyboard-interaction.test.mjs`

27 passed, covering tap/drag/cancellation recognition, selection, link activation, primary press/release coordinates, and no synthetic press outside mouse reporting mode.

## Desktop regressions

`npm run test:e2e -- e2e/terminal-touch-tui.spec.ts e2e/terminal-mouse-restore.spec.ts --workers=1 --retries=0`

All three existing desktop mouse tests passed: SGR and binary restoration plus Codex-style wheel capture across window activation and tab switching. New link-menu assertions initially used the wrong accessibility role; corrected from menuitem to button before the final touch run.

## Specification validation

`openspec validate --all`: 107 passed, zero failures.

`openspec validate --all --archived`: 204 passed; four pre-existing archived changes have incomplete task lists: `2026-09-06-agent-provider-status-conformance`, `2026-10-07-notifications-icon-and-project-dot`, `2026-10-10-macros-script-editor`, and `2026-10-27-github-worktree-status`.

The user tested the worktree build through Terminay Development and confirmed the mobile fix works. Device and browser details were not recorded. Automated Chromium touch input exercises xterm's real gesture handlers and the real PTY transport rather than dispatching only synthetic pointer events.

## Final touch regression run

`npm run test:e2e -- e2e/terminal-touch-tui.spec.ts --workers=1 --retries=0`

All four tests passed: SGR/pointer, binary/pointer, SGR/legacy touch, and plain-terminal scrolling/focus/selection. TUI tests also assert preserved panning, cancellation, and link menus without extra button reports.

Artifacts: `.docker-cache/e2e/20261104T090532Z-38033/`.
