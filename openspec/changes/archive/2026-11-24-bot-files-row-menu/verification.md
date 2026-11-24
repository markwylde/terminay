# Review and verification — bot-files-row-menu

Reviewed on 2026-11-16 against `git diff main...HEAD`, `git diff`, and the change's proposal, design, ADR manifest, tasks, and bot-environment delta. The committed branch differences also include inherited clipboard, terminal-overlay, and saved-server settings work; no additional actionable issue was identified in those differences.

## Findings fixed

- **P2 — stale listing rows can target the wrong folder.** Navigation previously retained the old rows while loading, and late responses could overwrite the current listing. Rows now belong to a specific Files client and directory. Inactive and superseded requests cannot update them. The Docker regression deliberately delivers an old home listing after navigating into `notes` and verifies that only `notes` entries remain actionable.
- **P2 — switching keyboard menus loses first-item focus.** Reusing the mounted menu while `autoFocus` stays true did not rerun its focus effect. Row identity now keys the menu. A Chromium component regression switches directly from a file's keyboard menu to a link's keyboard menu and checks focus.
- **P2 — global padding collapses the trigger icon.** The global button rule reserves 24px of horizontal padding inside a 28px trigger, shrinking the icon to about 4px. The Files trigger now has zero padding. Docker coverage asserts the rendered icon is 16px in both dimensions, alongside the trigger's hit-target size.
- **P2 — live entry-kind changes leave stale actions available.** A same-name replacement could retain the previous entry's menu, including when replaced by a credential link. A changed kind now closes the menu, and a credential-link replacement clears delete confirmation.
- Added missing coverage for link/special-entry action sets, disabled-item skipping, and the shared menu's keyboard opt-out. The new shared-menu component test runs through `npm run test:bots-ui`.
- Increased the long row-menu workflow's test budget to 90 seconds. Also refreshed the existing Containers test's relative timestamp at test start: its module-load timestamp became three minutes old in a longer suite while the assertion required two minutes.

## Contract and boundary review

| Dimension | Assessment |
| --- | --- |
| Completeness | One modified Files requirement; all seven new UI scenarios implemented and exercised. 11/11 tracked tasks complete. |
| Correctness | File/folder/link/special-entry action sets, locked credentials, parent row, rename, preview, navigation, delete confirmation/cancellation, focus restoration, live removal and stale listing responses covered. |
| Coherence | Shared ContextMenu, 14px menu icons, danger styling, opt-in keyboard semantics and existing Files-client flows match the design. |

Renderer changes introduce no Node/Electron imports, IPC channels, filesystem access, or direct network service. File actions continue through the existing bot-bound Files client and server helper. There is no change to project/window authorization, terminal-session identity, protected-path checks, symlink confinement, or server-side authority. The inherited Electron test hooks remain gated by TERMINAY_TEST and bound server-UI sender validation.

## Validation

- TypeScript: `npx tsc --noEmit` passed.
- Files service/protocol: 8 passed, 1 skipped (the existing opt-in real container integration).
- Workspace model command passed after building its CLI/server workspace dependencies: 244 passed, 1 skipped across its constituent runs (the existing old-release interoperability check).
- Chromium components: `npm run test:bots-ui` passed, 56 tests.
- Docker: all 31 bots-suite tests passed (3.6 minutes). After the final padding fix, the focused row-menu, delayed-listing, and file-explorer context-menu run passed all 3 tests, including the rendered 16px icon assertion. Screenshots under screenshots/ show dark/light system preferences and keyboard focus; the existing Bots and shared-menu palettes stay dark under both preferences.
- Biome check passed for the seven formatted changed files; lint passed for App.css and the existing bots component test file. The latter retains 35 pre-existing warnings. Whole-file formatting of App.css and the existing component test contains unrelated baseline differences and was not applied.
- `openspec validate bot-files-row-menu` passed.
- `openspec validate --all`: 118 passed, 8 failed. The same eight failures were reproduced on local main (117 passed, 8 failed): add-terminay-bots, bot-chat-image-attachments, linked-folders, one-window-one-server, outbound-bot-triggers, phone-review-fixes, server-notification-manager, unified-settings-window.
- `git diff --check` passed.

The initial superseded full Docker run hit the original 30-second budget during the row workflow while another build was running; it was stopped. The fixed workflow passed in the subsequent targeted Docker run.

No unresolved findings remain from this review. The skipped real-container ownership integration and old-release interoperability checks are existing optional coverage limits; the eight baseline OpenSpec validation failures are unrelated to this change. No commit, push, PR, spec sync, or archive was performed.
