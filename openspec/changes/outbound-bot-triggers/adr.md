# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-04
- Reviewer: Codex
- Change: `outbound-bot-triggers`

## In-Force ADR Context Reviewed

All existing ADR files were inventoried and reviewed through their status and supersession relationships. The following unsuperseded accepted records form the inventory; relevance is detailed in design.md. Partial supersessions retain only the clauses explicitly carried forward by their successors.

- `openspec/adr/0002-sqlite-state-repository.md` - retained architectural context.
- `openspec/adr/0003-vault-interface-and-key-protectors.md` - retained architectural context.
- `openspec/adr/0005-sandboxed-origin-bound-client-hosts.md` - retained architectural context.
- `openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md` - retained architectural context.
- `openspec/adr/0011-security-trust-boundary-model.md` - retained architectural context.
- `openspec/adr/0012-pwa-framed-session-host.md` - retained architectural context.
- `openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md` - retained architectural context.
- `openspec/adr/0015-self-hosted-direct-signaling-exposure.md` - retained architectural context.
- `openspec/adr/0016-self-contained-server-archives-and-release-channels.md` - retained architectural context.
- `openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md` - retained architectural context.
- `openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md` - retained architectural context.
- `openspec/adr/0020-per-operation-canonical-roots.md` - retained architectural context.
- `openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md` - retained architectural context.
- `openspec/adr/0023-server-owned-clipboard-scratch.md` - retained architectural context.
- `openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md` - retained architectural context.
- `openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md` - retained architectural context.
- `openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md` - retained architectural context.
- `openspec/adr/0028-no-polling-without-owner-approval.md` - retained architectural context.
- `openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md` - retained architectural context.
- `openspec/adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md` - retained architectural context.
- `openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md` - retained architectural context.
- `openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md` - retained architectural context.
- `openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md` - retained architectural context.
- `openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md` - retained architectural context.
- `openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md` - retained architectural context.
- `openspec/adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md` - retained architectural context.
- `openspec/adr/0042-file-previews-that-run-script-use-the-app-view-sandbox.md` - retained architectural context.
- `openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md` - retained architectural context.
- `openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md` - retained architectural context.
- `openspec/adr/0045-the-mcp-adapter-may-read-a-document-the-agent-names.md` - retained architectural context.
- `openspec/adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md` - retained architectural context.
- `openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md` - retained architectural context.
- `openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md` - retained architectural context.
- `openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md` - retained architectural context.
- `openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md` - retained architectural context.
- `openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md` - retained architectural context.
- `openspec/adr/0053-in-page-windows-share-one-modal-frame.md` - retained architectural context.
- `openspec/adr/0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md` - retained architectural context.
- `openspec/adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md` - retained architectural context.
- `openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md` - retained architectural context.
- `openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md` - retained architectural context.
- `openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md` - retained architectural context.
- `openspec/adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md` - retained architectural context.
- `openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md` - retained architectural context.
- `openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md` - retained architectural context.
- `openspec/adr/0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md` - retained architectural context.
- `openspec/adr/0064-rich-markdown-editing-is-a-file-viewer-view-over-the-panels-own-session.md` - retained architectural context.
- `openspec/adr/0065-an-untracked-terminal-is-silenced-where-activity-is-read-never-where-it-is-detected.md` - retained architectural context.
- `openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md` - retained architectural context.
- `openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md` - retained architectural context.
- `openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md` - retained architectural context.
- `openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md` - retained architectural context.
- `openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md` - retained architectural context.
- `openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md` - retained architectural context.
- `openspec/adr/0075-management-lives-in-one-settings-surface.md` - retained architectural context.
- `openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md` - retained architectural context.
- `openspec/adr/0079-desktop-macos-floor-follows-electron-to-macos-13.md` - retained architectural context.
- `openspec/adr/0080-extension-installer-is-built-from-npm-libraries.md` - retained architectural context.
- `openspec/adr/0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md` - retained architectural context.
- `openspec/adr/0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md` - retained architectural context.
- `openspec/adr/0084-on-windows-git-command-reports-arrive-as-files-that-are-deleted-as-they-are-read.md` - retained architectural context.
- `openspec/adr/0085-the-server-reaches-win32-apis-through-koffi.md` - retained architectural context.
- `openspec/adr/0087-terminay-keeps-powershells-process-directory-in-step-with-its-location-on-windows.md` - retained architectural context.
- `openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md` - retained architectural context.
- `openspec/adr/0093-bots-communicate-through-a-durable-message-log.md` - retained architectural context.
- `openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md` - retained architectural context.
- `openspec/adr/0095-claude-bots-sign-in-through-their-own-cli.md` - retained architectural context.
- `openspec/adr/0095-session-holders-retain-bounded-terminal-presentation-in-memory.md` - retained architectural context.

### Carried-forward bot clauses

- ADR-0092 retains bot isolation and engine transport; ADR-0094 changes socket exposure/attribution only.
- ADR-0093 retains concurrent admission, explicit communication and scoped tools; the older single-session/no-tools clauses do not apply.
- ADR-0091 retains credential separation, as extended by ADR-0095-claude; host-login ADR-0090 is not in force.
- ADR-0088 complements ADR-0002 for canonical files; it does not replace it.

## Repository-Level ADRs Created

- [ADR-0096](../../adr/0096-bot-trigger-sources-execute-in-the-owning-container.md) - proposed container-source/server-acceptance boundary and scoped owner-approved polling exception.

## Notes

- Re-read design.md before completing this manifest. ADR-0028 remains in force; its specific owner-approved exception mechanism is used, so no accepted record is edited or superseded.
- Two distinct existing files have sequence 0095. Both were preserved; the highest existing number was 0095 and the new record is 0096.
- No prior ADR file, index entry, project code or workflow configuration was modified.
- Proposed resource caps and worker choices are reviewable defaults, not measured guarantees.

## Planning Validation

- `openspec status --change outbound-bot-triggers`: 5/5 planning artifacts complete.
- `openspec validate outbound-bot-triggers --strict`: passed. Informational archive notices identify the three prerequisite bot capabilities not yet in main specs; the proposal records their archive order.
- `openspec validate --all`: 108 passed, 0 failed, including this change.
- `openspec validate --all --archived`: 204 passed, 4 pre-existing failures for incomplete archived tasks: `2026-09-06-agent-provider-status-conformance`, `2026-10-07-notifications-icon-and-project-dot`, `2026-10-10-macros-script-editor`, `2026-10-27-github-worktree-status`. Unrelated archives were not edited.
- All MODIFIED requirement names match their active `add-terminay-bots` baseline blocks. Artifact realpaths remain inside the scaffolded change; the new durable ADR is inside this worktree's `openspec/adr/`.
- At proposal validation, the main clone remained clean and no implementation was created. The owner subsequently requested a single PR; planning is submitted from the separate worktree.
