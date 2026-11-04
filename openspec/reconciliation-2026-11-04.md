# OpenSpec reconciliation and completion audit — 2026-11-04

## Result

The cleanup is prepared on `chore/openspec-refresh` in the existing
`terminay-openspec-reconcile` worktree. The main clone is unchanged.

- Archived **46** demonstrably complete changes: the 21 already task-complete
  entries and 25 more completed by resolving stale checks and spec dependencies.
- **21 changes remain active**, with **92 unchecked tasks**. These include
  implementation work, specific missing tests, manual/device probes and
  external-repository evidence. They are not 92 missing coding tasks.
- Canonical inventory: **53 specs, 1442 requirements**.
- Reconciled completed contracts before moving each change. Used
  `openspec archive --yes --skip-specs` only after comparing every selected
  requirement with its canonical counterpart, so archive cannot replay older
  deltas over newer contracts. Canonical hashes were checked around the moves.

## Evidence and limits

Reviewed every initially unchecked task, the source/test references, Git history,
merged pull-request descriptions and available comments. Queried 81 relevant
Gitea PR head status sets through `tea api`; [the CI ledger](reconciliation-2026-11-04-ci.md)
records the heads, counts and failures. No messages, PRs or CI reruns were sent.

The head of merged PR #487 is an ancestor of the reviewed main revision
`602b9053`. Its 28 statuses are all success or skipped, including every Docker
E2E shard, workspace tests, the fast gate and Linux floor. The existing test
sources were inspected to establish coverage before using that run as evidence.
That is evidence for the integrated application code, not a new CI run of this
documentation-only branch. Historical failed heads are not relabelled green.

For example, the project-start chooser E2E journeys and the macro queue's
three-prompt advancement case were already implemented and covered by that
later green run. The Linux floor job explicitly builds both artifacts, checks
ELF requirements and starts terminals on clean glibc 2.31. Later green regression
coverage replaces those changes' stale original-PR checkpoints, with historical
failures recorded in their task evidence.

Directory archive-order tasks were rewritten as performed canonical-contract
reconciliation checks where their prerequisites are already synced. This does
not complete unrelated implementation or acceptance tasks in those prerequisite
changes. Superseded delete prompts, folder grips and sidebar placements are not
reintroduced merely to replay an older change.

Unchecked combined tasks were split where needed: bot desktop implementation
and protocol tests are complete while remote-browser proof remains open;
extension-installer CI is complete while external alert closure remains open.
Existing task evidence now states the source of each completion.

## Validation

- `openspec validate --all`: **74 passed, 0 failed** (53 specs and 21 changes).
- `git diff --check`: passes.
- The auxiliary-window placement/close-command Node suite was rerun locally:
  **4 passed, 0 failed**. No Electron suite was run on the host.
- Archive task validation: **251 passed, 3 failed**. Every newly archived change
  has all tasks checked. The existing GitHub-status archive's stale CI check
  was resolved with merged PR #450's 26 green/skipped statuses.

The three remaining historical archive failures are deliberately not marked
complete without evidence:

| Archived record | Unchecked tasks | Reason |
| --- | ---: | --- |
| `2026-09-06-agent-provider-status-conformance` | 8 | Explicit implementation and real-provider measurement/conformance gaps in its original task record. |
| `2026-10-07-notifications-icon-and-project-dot` | 1 | Exact same-project-id, two-server dismissal test not established. |
| `2026-10-10-macros-script-editor` | 1 | Archived at the owner's instruction despite the documented one-window/server-selector prerequisite not being met. |

These are historical completion-record failures, not newly failing application
tests. This audit does not silently erase an owner's prior archive exception.

## Remaining active changes

| Change | Checked tasks | What is still open |
| --- | ---: | --- |
| [add-terminay-bots](changes/add-terminay-bots/tasks.md) | 58/60 | Implementation and RFB protocol tests exist. Remote-browser desktop acceptance and the multi-engine/model smoke checklist remain unverified. |
| [durable-state-files](changes/durable-state-files/tasks.md) | 22/24 | Windows VM verification timing and hard-reset recovery evidence remain unverified; implementation and Gitea CI are complete. |
| [extension-installer-on-npm-libraries](changes/extension-installer-on-npm-libraries/tasks.md) | 15/16 | Implementation, tests and CI are complete. Closure of the two external mirror Dependabot alerts has not been independently verified. |
| [linked-folders](changes/linked-folders/tasks.md) | 39/43 | Redundant project model fields still exist. Inventory/miniature, selected-folder Changes and two-client capture-offer acceptance checks remain open. File-scope plumbing and the current delete flow are implemented and accounted for. |
| [merge-documentation-into-file-viewer](changes/merge-documentation-into-file-viewer/tasks.md) | 13/16 | Document implementation exists. The requested linked-worktree save coverage and manual three-entry-point screenshots remain unverified; the combined session/save acceptance task stays open. |
| [merged-pull-request-on-both-forges](changes/merged-pull-request-on-both-forges/tasks.md) | 9/10 | Implementation and all PR #450 statuses are green. The named atlas worktree screenshot remains unverified. |
| [native-windows-desktop](changes/native-windows-desktop/tasks.md) | 29/32 | Windows build/release workflow wiring exists. Published release/update assets and the requested native probe/tag evidence have not been verified; the archive-validation gate also encounters historical failures. |
| [notifications-clear-only-on-interaction](changes/notifications-clear-only-on-interaction/tasks.md) | 9/10 | Implementation and CI are complete. The Desktop-plus-phone announcement check remains unverified. |
| [official-container-image](changes/official-container-image/tasks.md) | 31/33 | The extension-host startup-stop diagnosis/handoff and the manager-repository installation page remain unresolved or unverified. |
| [one-connection-per-window](changes/one-connection-per-window/tasks.md) | 17/20 | Implementation exists. The exact two-window E2E/update-of-takeover-tests acceptance and manager-repository changes remain unverified. |
| [one-window-one-server](changes/one-window-one-server/tasks.md) | 11/27 | Only part of the implementation is complete. Attach/composition structures and several multi-server surfaces remain in code; do not treat the cleanup and integration tests as done. |
| [pairing-install-instructions-and-beta-image](changes/pairing-install-instructions-and-beta-image/tasks.md) | 21/23 | Outstanding tasks belong to the manager-repository Add connection and published installation pages; this audit does not prove those external changes. |
| [phone-notifications-menu](changes/phone-notifications-menu/tasks.md) | 5/6 | Implementation and CI are complete. Real-phone confirmation remains unverified. |
| [pwa-push-notifications](changes/pwa-push-notifications/tasks.md) | 22/54 | Server-side implementation and local docs exist. Real-phone platform experiments, hosted manager/service/VAPID work and end-to-end security/notification acceptance remain unverified. Other-repository task boxes are not assumed incomplete code merely because their evidence is absent here. |
| [remote-server-in-app-upgrade](changes/remote-server-in-app-upgrade/tasks.md) | 31/36 | Implementation exists. Real detached user/container upgrades and Docker-in-Docker recreate acceptance remain unverified; the PR explicitly records fake-driver coverage for these paths. |
| [second-agent-in-a-terminal-is-heard](changes/second-agent-in-a-terminal-is-heard/tasks.md) | 3/4 | Implementation and CI are complete. The Desktop second-chat Dock/banner confirmation remains unverified. |
| [server-notification-manager](changes/server-notification-manager/tasks.md) | 32/34 | Implementation and CI are complete. A supported real agent CLI calling send_notification and the manual settle/interaction recording remain unverified. |
| [shared-sidebar-widths](changes/shared-sidebar-widths/tasks.md) | 12/13 | Implementation, model tests and E2E are recorded. The explicit hand check across projects, relaunch and a second window remains unverified. |
| [terminal-command-defaults](changes/terminal-command-defaults/tasks.md) | 22/23 | Implementation and contribution contracts are present. The real-Codex two-terminal status observation remains unverified. |
| [terminals-survive-restart](changes/terminals-survive-restart/tasks.md) | 41/46 | Core implementation exists. Linux AppImage/FUSE, macOS privacy, packaged Linux and architecture reattach probes and their design conclusions remain unverified. The update-confirmation contradiction is fixed. |
| [unified-settings-window](changes/unified-settings-window/tasks.md) | 25/29 | Implementation exists, but the exact spacing-token condition is not met (literal margins/padding remain), close confirmation currently exercises keep/discard rather than every proposed choice, a RecordingsWindow path remains, and visual acceptance is unverified. |

## Archived in this audit

- [add-agent-chat-and-pixel](changes/archive/2026-11-04-add-agent-chat-and-pixel/tasks.md)
- [agent-done-clears-on-view](changes/archive/2026-11-04-agent-done-clears-on-view/tasks.md)
- [auxiliary-windows-fit-and-close](changes/archive/2026-11-04-auxiliary-windows-fit-and-close/tasks.md)
- [bots-proxy-engine-socket](changes/archive/2026-11-04-bots-proxy-engine-socket/tasks.md)
- [bots-use-container-socket](changes/archive/2026-11-04-bots-use-container-socket/tasks.md)
- [bots-use-message-log](changes/archive/2026-11-04-bots-use-message-log/tasks.md)
- [compact-header-pixel-and-home](changes/archive/2026-11-04-compact-header-pixel-and-home/tasks.md)
- [compact-switcher-project-cards](changes/archive/2026-11-04-compact-switcher-project-cards/tasks.md)
- [dashboard-cards-show-pull-request](changes/archive/2026-11-04-dashboard-cards-show-pull-request/tasks.md)
- [doc-edits-after-view-switch](changes/archive/2026-11-04-doc-edits-after-view-switch/tasks.md)
- [electron-45-macos-13-floor](changes/archive/2026-11-04-electron-45-macos-13-floor/tasks.md)
- [every-live-terminal-has-a-panel](changes/archive/2026-11-04-every-live-terminal-has-a-panel/tasks.md)
- [fix-bot-engine-recovery](changes/archive/2026-11-04-fix-bot-engine-recovery/tasks.md)
- [fix-folder-card-deleting-state](changes/archive/2026-11-04-fix-folder-card-deleting-state/tasks.md)
- [folder-card-pulling-state](changes/archive/2026-11-04-folder-card-pulling-state/tasks.md)
- [folder-rows-take-tab-colour](changes/archive/2026-11-04-folder-rows-take-tab-colour/tasks.md)
- [folders-dirty-means-unpushed](changes/archive/2026-11-04-folders-dirty-means-unpushed/tasks.md)
- [folders-pane-strip-and-agent-launchers](changes/archive/2026-11-04-folders-pane-strip-and-agent-launchers/tasks.md)
- [folders-sidebar-cards](changes/archive/2026-11-04-folders-sidebar-cards/tasks.md)
- [guided-claude-bot-login](changes/archive/2026-11-04-guided-claude-bot-login/tasks.md)
- [harden-terminal-stream-boundaries](changes/archive/2026-11-04-harden-terminal-stream-boundaries/tasks.md)
- [kernel-held-data-root-lock](changes/archive/2026-11-04-kernel-held-data-root-lock/tasks.md)
- [left-column-agents-pane](changes/archive/2026-11-04-left-column-agents-pane/tasks.md)
- [left-column-tabs](changes/archive/2026-11-04-left-column-tabs/tasks.md)
- [linux-glibc-floor](changes/archive/2026-11-04-linux-glibc-floor/tasks.md)
- [macro-queue-shows-current-step](changes/archive/2026-11-04-macro-queue-shows-current-step/tasks.md)
- [mcp-drives-the-agents-view](changes/archive/2026-11-04-mcp-drives-the-agents-view/tasks.md)
- [mcp-full-app-control](changes/archive/2026-11-04-mcp-full-app-control/tasks.md)
- [mcp-token-follows-moved-terminal](changes/archive/2026-11-04-mcp-token-follows-moved-terminal/tasks.md)
- [mcp-token-lives-with-terminal](changes/archive/2026-11-04-mcp-token-lives-with-terminal/tasks.md)
- [mobile-tui-touch-taps](changes/archive/2026-11-04-mobile-tui-touch-taps/tasks.md)
- [new-project-start-chooser](changes/archive/2026-11-04-new-project-start-chooser/tasks.md)
- [one-dialog-deletes-a-folder](changes/archive/2026-11-04-one-dialog-deletes-a-folder/tasks.md)
- [open-folder-shell-line](changes/archive/2026-11-04-open-folder-shell-line/tasks.md)
- [pixel-dock-ghost-while-out](changes/archive/2026-11-04-pixel-dock-ghost-while-out/tasks.md)
- [preserve-held-terminal-presentation](changes/archive/2026-11-04-preserve-held-terminal-presentation/tasks.md)
- [preserve-terminal-mouse-after-restore](changes/archive/2026-11-04-preserve-terminal-mouse-after-restore/tasks.md)
- [project-tab-joins-only-a-strip](changes/archive/2026-11-04-project-tab-joins-only-a-strip/tasks.md)
- [reorder-any-folder](changes/archive/2026-11-04-reorder-any-folder/tasks.md)
- [settings-fullscreen-drops-titlebar-band](changes/archive/2026-11-04-settings-fullscreen-drops-titlebar-band/tasks.md)
- [terminal-input-survives-attachment-handoff](changes/archive/2026-11-04-terminal-input-survives-attachment-handoff/tasks.md)
- [untracked-terminal-tabs](changes/archive/2026-11-04-untracked-terminal-tabs/tasks.md)
- [windows-menu-switcher-scrollbars](changes/archive/2026-11-04-windows-menu-switcher-scrollbars/tasks.md)
- [workspace-change-fanout](changes/archive/2026-11-04-workspace-change-fanout/tasks.md)
- [worktree-capture-survives-restart](changes/archive/2026-11-04-worktree-capture-survives-restart/tasks.md)
- [worktree-folder-single-line](changes/archive/2026-11-04-worktree-folder-single-line/tasks.md)

## Skill refresh on the same branch

The latest stable npm release and installed CLI are both OpenSpec 1.16.0.
The six configured generated workflows were refreshed with
`npx --yes --package=@fission-ai/openspec@1.16.0 openspec update --force`;
they already matched that release. No additional workflows were enabled.

The custom `openspec-git-discipline` skill and AGENTS.md now keep planning,
implementation, verification, sync and archive in one worktree and PR. They no
longer require a proposal-only merge, commits between planning artifacts, or a
checkout of main before archive. Planning, verification evidence and Gitea CI
requirements remain.

## Review scope

The earlier spec reconciliation combined completed and implemented requirements,
created missing canonical capabilities and rebased overlapping deltas. This audit
then reconciled additional completed contracts and archived eligible changes.
MCP's Purpose was deliberately updated as its full-app change explicitly required;
other established Purpose sections were preserved. No accepted ADR or application
code was changed. Original delta wording remains available in Git history.

## Integration before delivery

Main advanced to `e130b271` with merged PR #488 (native bot CLI runtime,
shared desktop and build timeline) after the audit snapshot. That change and
ADR-0096 are preserved. Its six unchecked acceptance tasks remain active; it is
not included among the 46 archives from this audit. The delivery branch therefore
has 22 active changes, and active spec validation reports 75 passed.

The overlapping bot image, extension/native-driver and Claude login wording is
reconciled into the canonical contracts without restoring ACP-specific behavior.
No application implementation or accepted ADR is changed relative to that newer
main. This delivery integration does not claim the new change’s outstanding
architecture, creative-app or real-engine acceptance is complete.
