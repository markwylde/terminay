# Verification evidence

## Implemented contract

- `electron/folderLaunch.ts`: literal ordered operands, local file URLs, cwd preservation, syntax rejection, runtime switch separation, 64-request admission bound, readiness/failure queue, and sanitized recovery relaunch arguments.
- `packages/server-core/src/localFolderLaunch.ts`: canonical local roots, exact-root project reuse, explicit-cwd terminal creation through existing server authority. No remote or renderer entry point.
- `electron/nativeFolderPresentation.ts`: tests cover remote/auxiliary exclusion, exact local view reuse, window-close cancellation and presentation timeout without terminal lifecycle authority.
- `electron/main.ts`: early native folder listener; initial and forwarded process arguments; main-only local adapter; exact Local profile/view window selection; addressed presentation with ten-second cancellation and window-close abort.
- `electron/serverTerminalAuthority.ts` and workspace-view relay: wait for the chosen window's authenticated connection without polling; use existing focus operation; preserve visible panel after presentation failure; kill spawned PTY if panel registration throws.
- macOS package declares alternate folder handling; user default associations are never changed.

## Automated results

- `node --test scripts/folder-launch.test.mjs packages/server-core/test/local-folder-launch.test.mjs packages/server-core/test/terminal-launch-resolver.test.mjs packages/server-core/test/workspace-view-composition.test.mjs`: 34 passed.
- `node --test scripts/native-folder-presentation.test.mjs`: 4 passed.
- `node --test --test-name-pattern='native terminal creation' scripts/server-terminal-authority-host-bookkeeping.test.mjs`: 1 passed, including injected panel-persistence failure and observed PTY exit.
- `npm run test:e2e -- e2e/folder-launch.spec.ts`: Docker-isolated, 1 passed (4.4 seconds). Covers cold argv, native warm open, a real second executable invocation with a relative folder, literal hostile-looking folder names, repeated exact-root launches, missing-folder continuation, Home cwd policy override, and targeting the workspace while Settings is present.
- `npm run build:app`: passed. Subsequent main bundle rebuild passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with existing warnings/info; focused new-file lint is clean.
- `git diff --check`: passed.

## Packaged macOS smoke

Built the arm64 directory app with electron-builder and applied an ad-hoc signature for local testing. Read the generated Info.plist and confirmed `CFBundleDocumentTypes` contains alternate folder handling. Launched with `open -n -a <worktree app> <cold folder>` and isolated `TERMINAY_USER_DATA_DIR`, then `open -a <worktree app> <warm folder>`.

Both paths arrived through native Launch Services. `lsof -a -p <zsh pid> -d cwd -Fn` confirmed real zsh working directories, not merely requested launch metadata. The cold path included Unicode, spaces and `$(false)` literally. The warm launch stayed in the same application process. Scratch evidence is `/tmp/terminay-final-native-smoke-result.json`; Docker artifacts are `.docker-cache/e2e/20261109T115622Z-69465`.

Mac update relaunch was checked against Electron’s native updater and Squirrel’s bundle-based relaunch implementation; neither forwards Terminay folder operands. Recovery explicitly supplies sanitized arguments (covered by parser tests).

## Baseline findings

- Repository-wide OpenSpec validation reports 81 passed and seven pre-existing unrelated change failures: add-terminay-bots, bot-chat-image-attachments, linked-folders, one-window-one-server, outbound-bot-triggers, server-notification-manager, unified-settings-window. Their modified requirements omit scenarios now present in canonical specs. This change validates independently.
- Full host-bookkeeping suite: 21 passed, one pre-existing stale assertion failed. The test expects all project moves to revoke MCP capabilities; HEAD already follows ordinary moves under ADR-0074. The new cleanup regression passes separately.
- Built-in extension staging's live-agent discovery test observed the running Codex process as well as its Claude fixture. Resources for the native smoke were staged using the supported `--skip-checks` option; this is not recorded as an extension-suite pass.

## Visual evidence

No visual design changes. Screenshots are omitted; E2E checks terminal behavior and real cwd.


## Scenario audit

All nine added requirements are mapped above. Argument combinations and lifecycle delivery are covered by parser/queue tests and the real-process Docker test. Native registration and cold/warm OS delivery are verified against the final packaged macOS application and actual shell cwd. Local-window exclusion, reuse, timeout, and close cancellation are covered by the presentation adapter tests; the adapter has no API to switch a remote server or terminate a session. Native entry-point isolation is checked against the preload and command registrations. Server terminal cleanup is covered by an injected panel-persistence exception. Existing terminal cwd is never written by this path; each launch calls server create with a fresh session id. No new critical or warning findings remain for this change.

Canonical sync copies this new capability's Purpose and all nine requirement blocks verbatim into `openspec/specs/macos-terminal-integration/spec.md`. No accepted ADR or existing capability is edited.

A packaged cold-start smoke exposed a subscription-order race. The launch now waits for the exact selected local workspace to attach before publishing project and terminal changes. A regression test proves that no project mutation occurs before this readiness gate.

Archived-baseline validation also reports four pre-existing failures in 2026-09-06-agent-provider-status-conformance, 2026-10-07-notifications-icon-and-project-dot, 2026-10-10-macros-script-editor, and 2026-11-04-mcp-workflow-templates. This archive and its canonical spec validate.

Final verification after the readiness fix: 38 focused parser, presentation, server, resolver and relay tests passed, plus the panel-persistence cleanup regression (1 passed). Final TypeScript and lint checks passed. All 13 tasks are complete; the archive validates with its canonical spec.
