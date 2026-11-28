# Verification: bot-thread-open-leaves-composer-unfocused

Reviewed on 2026-11-28: the change's working tree on top of `95c4269a`.

## Findings fixed

- **P2: Keyboard menu dismissal restored focus outside the thread.** The root
  appears in both the main stream and the panel. `BotChat` searched the document
  by message ID and focused the main-stream copy, so the next Escape could not
  reach the panel. `MessageMenuRequest` now carries the exact originating DOM
  element, and menu dismissal restores that element if it is still connected.
  The strengthened Docker E2E reproduced the failure against the original code.
- **P2: Escape could dismiss a pointer menu and its panel together.** Pointer
  menus leave focus within the panel. Its key handler closed the panel before
  the menu's window handler dismissed the menu. The panel now defers Escape
  while the chat has a menu or dialog open.
- **Coverage gap:** The previous test manually focused the panel after closing
  its menu, masking the first finding. Coverage now checks focus restoration
  and two consecutive Escape presses for keyboard and pointer menus, plus
  reopening from the reply bar at a narrow window width.
- Corrected task 1.1's verification command: this repository has no
  `npm run typecheck` script; the renderer check is `npx tsc --noEmit`.

## Contract and boundaries

The implementation follows the planned non-text focus target with
`tabIndex={-1}` and `preventScroll`. Opening and switching threads focuses the
panel; explicit composer interaction and Quote retain their focus behavior.
Tab navigation, drafts, attachments, posting, and root deletion retain their
existing paths. The keyboard-open screenshot shows the inset focus ring.

All changes are renderer presentation and DOM focus handling. No Node/Electron
API, preload privilege, server operation, persistence, authorization, project,
window, or terminal-session binding changes. DOM references serve only as local
focus targets and never define authority. The menu focus target is no longer
selected across chat instances by a document-wide query.

## Validation

- `npx tsc --noEmit`: passed.
- Biome check of all five affected code/style/test files: passed, with two
  existing unused-suppression warnings in `BotTranscript.tsx`.
- `git diff --check`: passed.
- `openspec validate --all`: 111 passed, 13 unrelated changes failed. This
  change and all main specs passed. Validation of an exported local `main`
  snapshot produced the identical set of 13 failing changes (106 passed).
  Failures: `add-terminay-bots`, `bot-browser-sandbox-under-apparmor`,
  `daemon-restart-keeps-terminals-usable`, `linked-folders`,
  `one-window-one-server`, `outbound-bot-triggers`, `phone-review-fixes`,
  `server-notification-manager`, `settings-server-rail`,
  `terminal-command-defaults`, `terminals-survive-restart`,
  `unified-settings-window`, and `whats-new-home-section`.
- `timeout 900s npm run test:e2e -- e2e/bots.spec.ts --grep 'any message can grow a thread|Quote puts any message'`:
  2 passed in 17.2 seconds, without retries. Artifacts are in
  `.docker-cache/e2e/20261128T090051Z-2719127/`. The original code failed the
  strengthened focus-restoration assertion on all three configured attempts;
  its artifacts are in `.docker-cache/e2e/20261128T085842Z-2705601/`.

## Assessment

| Dimension | Result |
| --- | --- |
| Completeness | 4/4 tasks complete; both delta requirements implemented |
| Correctness | Changed focus scenarios pass E2E; physical phone keyboard not verified |
| Coherence | Design and code patterns followed; security boundaries preserved |

No outstanding code findings. Physical phone keyboard behavior remains unverified;
the automated focus proxy passes. Repository-wide OpenSpec validation retains
the 13 baseline failures listed above.

## Limits

Actual phone on-screen keyboard behavior is not verified on physical hardware;
the automated acceptance proxy checks that the panel has focus and no textarea
does, including at a narrow width. The full E2E suite runs in pull-request CI.
