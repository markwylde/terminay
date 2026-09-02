# Task 16 shared UI parity matrix

This matrix defines the feature-by-feature target for the shared responsive
Terminay UI. It is intentionally conservative: a feature is not considered
browser/Desktop parity-complete until the same shared implementation renders the
feature body in both hosts, with host capabilities only changing presentation
or native affordances.

| Feature spec | Shared UI surface | Current parity status | Remaining shared UI work |
| --- | --- | --- | --- |
| `agent-status-and-sidebar.md` | Agents sidebar, tab/header indicators, acknowledgement controls | Partial | The production auxiliary Agents body now renders live shared `AgentStatusClient` snapshots in Desktop and browser tests; integrate it into the canonical Workspace sidebar/header and acknowledgement controls. |
| `ai-tab-metadata.md` | AI tab title/metadata actions | Partial | Move AI metadata controls into shared tab/action components instead of Desktop-only renderer state. |
| `connections-and-client-hosts.md` | Connection manager, current connection menu, host capability disclosure | Partial | The shared production Connections body consumes `ConnectionProfileStore` for select, add/import, rename, distinct confirmed forget/revoke actions, capability-gated exposure, and one-time pairing handoff. Desktop has a tested persisted profile/window-registry composition seam; Web composes it with `WebConnectionHost`, exact-origin localStorage, storage-event convergence across two tabs, and connected-workspace route placement without retaining a pairing fragment. Adopt `createDesktopServerUiWindow` from the future server-bundle window caller when that replaces the legacy Electron BrowserWindow bootstrap; no such production caller exists yet. |
| `dictation.md` | Dictation capture/disclosure UI | Partial | Render dictation controls through shared components with browser/Desktop capability gates. |
| `file-explorer-and-folder-tabs.md` | File explorer sidebar, folder tabs, Markdown task views | Partial | The production File-route auxiliary body now lists the selected project through `FileViewerClient` with bounded catalog states in Desktop/browser; integrate folder tabs, gallery/task aggregation, and canonical workspace navigation. |
| `file-viewer.md` | Monaco/Performant/HEX/Preview/shared-draft file panels | Partial | Render the existing migrated file viewer modes as shared route/panel bodies in both hosts. |
| `git-worktrees-and-quick-push.md` | Git sidebar, worktree switching, Quick Push review | Partial | The production Git route now lists server-owned worktrees and drives Pull, confirmation-gated removal, reviewed Quick Push proposal/approval, and host-gated native terminal opening through `TerminayGitClient` in Desktop/browser tests; integrate changed-file diff, switching, rename/copy/reveal, and the canonical Workspace sidebar. |
| `macros.md` | Macro editor, preview, execution controls | Partial | Render macro settings/editor/execution surfaces as shared route components. |
| `mcp-server.md` | MCP status/install/control UI | Partial | Move MCP control surfaces behind `TerminayClient` and render them in the shared workspace. |
| `recording.md` | Recording controls, timeline/list/replay windows | Partial | Render recording list/timeline/replay from shared components; Desktop auxiliary windows become host presentation only. |
| `remote-access.md` | Pairing, remote connection lifecycle, reconnect state | Partial | Unify remote connection lifecycle UI with the shared connection host surface. |
| `server-owned-workspace-state.md` | Projects, logical workspace views, panels, route navigation | Partial | Replace client-local project/Dockview state with server-owned shared workspace snapshots and commands. |
| `server-runtime-and-protocol.md` | Protocol/error/loading state, server bundle launch | Partial | Render protocol compatibility, loading, reconnect, and server-origin errors through shared host-neutral components. |
| `settings-shortcuts-and-desktop-integration.md` | Settings, shortcuts, OS/native capability alternatives | Partial | Move settings route body to shared UI; Desktop-only integration remains host capability/action metadata. |
| `terminal-activity-signals.md` | Activity indicators, command lifecycle, unread/ack states | Partial | Render terminal activity state from shared server snapshots across tab/header/sidebar surfaces. |
| `terminal-workspace.md` | Terminal panels, tabs, input/accessory, resize, replay/errors | Partial | The production project-scoped Terminal route body now uses `TerminayTerminalClient` for list/create and `TerminayTerminalPanelClient` for attach, bounded replay/output, input, resize, and detach in Desktop/browser tests; integrate it into the canonical Dockview terminal panel/tab surface with xterm and accessory parity. |
| `workspace-and-project-tabs.md` | Project tab bar, workspace panels, popout/adoption UX | Partial | Move project tabs, logical view adoption, and workspace panel layout to shared server-driven components. |

## Completion rule

A row can move from `Partial` to `Complete` only when:

1. the feature body is rendered by shared code, not separate Desktop/web copies;
2. state flows through `TerminayClient` and server-owned snapshots/commands;
3. Desktop-only behavior is represented as host capability/action metadata;
4. focused tests cover at least one Desktop host path and one browser host path;
5. the old renderer-only or remote-only fallback is either removed or explicitly
   documented as temporary compatibility.

## Real Desktop visual evidence

`e2e/desktop-shared-route-visual.spec.ts` launches the production Electron
renderer from the per-run immutable generated artifact and records 30
screenshots at 1280px, 900px, and compact 640px widths. It proves all seven
routes mapped by `ResponsiveWorkspaceEntry`. Each retains the complete registry,
reports its production shared route identity, uses the Desktop presentation
adapter, and remains within the Desktop viewport without horizontal page
overflow. Connections and Git now render real shared production bodies;
`e2e/shared-production-routes.spec.ts` additionally covers their ready, loading,
empty, unavailable, failed, and server-capability states at wide and mobile
browser widths.
The same run covers the Workspace-mapped `?view=agents` production body,
which consumes the authenticated live `AgentStatusClient` projection rather
than provider or host events.
It also covers the File-mapped `?view=folder` body, which lists the current
server-owned project through `FileViewerClient` and preserves loading, empty,
unavailable, failed, truncated, and ready catalog states.
The Workspace-mapped `?view=terminal` body lists and creates sessions for that
same current project and drives attachment replay, input, resize, and detach
through the transport-neutral terminal panel client. Browser coverage exercises
the complete lifecycle plus bounded route states; the Electron matrix proves
the production renderer body and viewport contract without duplicating App's
Dockview surface.

Remote pairing is exercised only through the canonical hosted HTTPS session
origin. The local shared-shell matrix does not create a direct loopback remote
server or treat a loopback URL as a Desktop pairing target.
