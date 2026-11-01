# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-31
- Reviewer: Codex
- Change: preserve-terminal-mouse-after-restore

## In-Force ADR Context Reviewed

- `openspec/adr/0002-sqlite-state-repository.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0003-vault-interface-and-key-protectors.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0005-sandboxed-origin-bound-client-hosts.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0011-security-trust-boundary-model.md` — Terminal input stays inside authenticated project/session authority.
- `openspec/adr/0012-pwa-framed-session-host.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0015-self-hosted-direct-signaling-exposure.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0016-self-contained-server-archives-and-release-channels.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0020-per-operation-canonical-roots.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0023-server-owned-clipboard-scratch.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0028-no-polling-without-owner-approval.md` — Event-driven mode capture; no polling.
- `openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0042-file-previews-that-run-script-use-the-app-view-sandbox.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md` — Mode capture does not add history scans per output event.
- `openspec/adr/0045-the-mcp-adapter-may-read-a-document-the-agent-names.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md` — Fix shared workspace/server layers without host protocol logic.
- `openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md` — Input belongs to the current window attachment and lease.
- `openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md` — Agent-neutral repair without hooks, wrappers, or agent settings.
- `openspec/adr/0053-in-page-windows-share-one-modal-frame.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0064-rich-markdown-editing-is-a-file-viewer-view-over-the-panels-own-session.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0065-an-untracked-terminal-is-silenced-where-activity-is-read-never-where-it-is-detected.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0075-management-lives-in-one-settings-surface.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0079-desktop-macos-floor-follows-electron-to-macos-13.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0080-extension-installer-is-built-from-npm-libraries.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0084-on-windows-git-command-reports-arrive-as-files-that-are-deleted-as-they-are-read.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0085-the-server-reaches-win32-apis-through-koffi.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0086-a-windows-pipe-admits-only-the-users-principals-and-a-peer-that-proves-the-credential.md` — Keep authenticated holder IPC and native PTY ownership.
- `openspec/adr/0087-terminay-keeps-powershells-process-directory-in-step-with-its-location-on-windows.md` — Reviewed; no architectural decision changed.
- `openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md` — Reviewed; no architectural decision changed.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Reviewed ADRs 0001–0088 and their Supersedes links; highest sequence is 0088. The list above excludes records targeted by those links. The repair completes existing checkpoint state and routes binary mouse reports through existing terminal input and holder boundaries. A version-specific serializer helper and byte-safe adapter writes are tactical implementation choices. No accepted ADR is edited or superseded. This is a review manifest, not a new durable ADR.
