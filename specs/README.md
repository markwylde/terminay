# Terminay specifications

This folder is the product source of truth for Terminay. It follows a simple
delivery loop: describe a feature, break unimplemented work into an active task,
implement and verify it, then retain the completed plan as history.

## Map

- [CORE.md](./CORE.md) — product purpose, core model, architecture boundaries,
  and feature map.
- [features/](./features/) — canonical, detailed feature specifications.
- [tasks/](./tasks/) — active delivery work only.
- [tasks_completed/](./tasks_completed/) — completed task history.

## Working agreement

Update the governing feature spec before changing product behaviour. Feature
specifications describe the required product contract in present tense,
independent of delivery status. Implementation gaps and sequencing belong in
`tasks/`, not in a feature document. When a task is done, move it to
`tasks_completed/` and keep the feature contract accurate.

## Feature catalogue

| Area | Canonical specification |
| --- | --- |
| Server/client architecture | [server-runtime-and-protocol](./features/server-runtime-and-protocol.md), [server-owned-workspace-state](./features/server-owned-workspace-state.md), [connections-and-client-hosts](./features/connections-and-client-hosts.md) |
| Workspace and native terminals | [workspace-and-project-tabs](./features/workspace-and-project-tabs.md), [terminal-workspace](./features/terminal-workspace.md) |
| Navigation and files | [file-explorer-and-folder-tabs](./features/file-explorer-and-folder-tabs.md), [file-viewer](./features/file-viewer.md) |
| Git workflows | [git-worktrees-and-quick-push](./features/git-worktrees-and-quick-push.md) |
| Automation and AI | [macros](./features/macros.md), [dictation](./features/dictation.md), [ai-tab-metadata](./features/ai-tab-metadata.md), [agent-status-and-sidebar](./features/agent-status-and-sidebar.md), [mcp-server](./features/mcp-server.md) |
| Terminal signals and recordings | [terminal-activity-signals](./features/terminal-activity-signals.md), [recording](./features/recording.md) |
| Remote access | [remote-access](./features/remote-access.md) |
| Cross-cutting preferences | [settings-shortcuts-and-desktop-integration](./features/settings-shortcuts-and-desktop-integration.md) |
