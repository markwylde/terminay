## Context

Moving a terminal between projects already exists end to end. `TerminalTab.tsx` renders **Move to project** with a submenu built from `projectsForMove`; choosing an entry calls `onMoveToProject(projectId)`, which reaches `moveTerminalToProject(sourceProjectId, panelId, targetProjectId)` in `src/App.tsx`. That function exports the terminal from the source workspace (`exportTerminalForMove`), activates the target project, and on the next frame has the target workspace adopt it (`acceptMovedTerminal`, which activates and focuses the panel). The eligible targets come from `panelMoveTargets(project, projects)` in `projectTabComposition.ts`, which is where the same-server rule lives.

Terminal tabs are Dockview tabs, so they are HTML5 drag sources. `useTerminalDockviewWindowController.ts` already listens for `dragstart`/`dragend` on each Dockview window, reads Dockview's `getPanelData()` to record `{ panelId, groupId }` in `draggingTransferRef`, and pops the panel out when the drag ends outside the window.

Project tabs are `framer-motion` `Reorder.Item`s in `ProjectTabList.tsx`. Their reorder and tear-off use pointer tracking, not HTML5 drag, and each tab carries `data-tab-handle`, `data-project-id`, and `data-server-id`. They are not drop targets for anything today.

In-force ADRs that bear on this: ADR-0018 (one bundle, many server connections — project ids are per-server namespaces, so a tab is identified by `(serverId, projectId)`), ADR-0017 (every project executes on its server — a panel never crosses servers), ADR-0011 (project and terminal-session boundaries are security boundaries; the renderer is untrusted).

## Goals / Non-Goals

**Goals:**

- Dropping a terminal tab on a visible project tab performs the existing move, with no second move implementation.
- Drop eligibility is the same set the context menu offers, derived from the same function.
- A clear hover affordance on eligible tabs, and none on ineligible ones.
- The drag does not disturb project-tab reorder, tear-off, or the terminal popout-on-drag-out behaviour.

**Non-Goals:**

- Dropping onto projects that are not visible tabs: overflowed tabs behind the switcher pill, the switcher menu, and the compact switcher. The context menu remains the route there.
- Spring-loading (hovering a project tab to switch to it and then dropping into a specific split or position).
- Moving file or folder tabs, or whole groups, between projects.
- Dragging from a popped-out terminal window, or between native windows.
- Any touch gesture. Dockview tab drag is pointer/HTML5 only; touch users keep the context menu.
- Any server, protocol, or preload change.

## Decisions

### 1. Use HTML5 drop events on the project tabs, keyed off Dockview's own drag payload

Project tabs gain `dragenter`/`dragover`/`dragleave`/`drop` handlers. During `dragover` the handler asks "is a terminal tab of the active project being dragged, and is this tab an eligible target?" and calls `preventDefault()` only when the answer is yes, which is what makes the browser treat the tab as a drop target and show the move cursor. `drop` performs the move.

The dragged panel is identified from the bookkeeping the app already keeps for Dockview drags (`draggingTransferRef`, fed by `getPanelData()`), not from `dataTransfer` contents: Dockview uses an in-process transfer object, and `dataTransfer` data is unreadable during `dragover` anyway.

*Alternative considered — pointer tracking with `elementFromPoint`*, mirroring how project-tab reorder works. Rejected: during a native HTML5 drag the browser suppresses pointer events, so this would mean replacing Dockview's tab drag rather than listening alongside it.

*Alternative considered — a Dockview `onUnhandledDragOverEvent`/external drop hook.* Rejected: those fire for drags over Dockview's own surface; the project bar is outside it.

### 2. Lift "what is being dragged" to the shell so the project bar can read it

`draggingTransferRef` lives inside each project workspace. The project bar is rendered by the shell. The active workspace reports drag start and end upward — `{ sourceProjectId, panelId, kind }` or `null` — and the shell holds it in a ref plus a small piece of state used only to render the affordance. `kind` is resolved at drag start from the panel's tab component so only `terminalTab` panels qualify; a group drag (no `panelId`) reports nothing.

Only the workspace's main window reports. Drags that start in a popout window are out of scope and report nothing, so the project bar ignores them.

### 3. One eligibility function, shared with the context menu

A pure function decides acceptance: given the dragged terminal's source project and the candidate tab, it returns true exactly when the candidate is in `panelMoveTargets(sourceProject, projects)` and is a ready, non-inert tab. The context menu's list and the drop targets therefore cannot drift apart, and the same-server rule (ADR-0017/0018) keeps its single home. Tabs are matched by composed handle `(serverId, projectId)`, never by project id alone, because ids repeat across servers.

This is a presentation rule, not the enforcement point. The boundary crossed is the project boundary (ADR-0011); it is crossed by the existing export/adopt path and the server-owned workspace state behind it, which this change does not touch. The renderer gains no new authority — it can only request the move it could already request from the menu.

### 4. The drop calls `moveTerminalToProject` and nothing else

`drop` resolves the target handle to its project id, and the existing `moveTerminalToProject(sourceProjectId, panelId, targetProjectId)` performs the move. Activation of the target project and focus of the adopted terminal come for free and match the menu exactly, which is the stated requirement.

The call is made when the drag ends rather than inside `drop`. Moving the terminal removes the very tab element being dragged, and a drag whose source has left the document does not deliver `dragend` to the window, which is where both the app's and Dockview's drag bookkeeping are cleared. `drop` therefore only records the target; the drag-end report, which always follows, performs the move.

### 5. Keep the drag from leaking into neighbouring behaviours

- **Popout on drag-out.** The existing `dragend` handler pops a panel out only when the pointer is outside the window. The project bar is inside it, so the two cannot both fire.
- **Project reorder and tear-off.** Those are driven by `framer-motion` pointer drags that start on a project tab. An HTML5 drag that started on a terminal tab never starts one. The drop handlers do not call `onActivate`, so hovering does not switch projects.
- **Dockview's own drop.** Dockview handles drops on its surface only. `drop` on a project tab calls `stopPropagation()` and `preventDefault()` so nothing else interprets it.

### 6. Affordance is a class on the tab

The hovered eligible tab gets `project-tab--terminal-drop-target`, styled from the tab's own `--project-color` so it reads as "this project will receive it". It is driven by state keyed on the tab handle, set on `dragenter`/`dragover` and cleared on `dragleave`, `drop`, and drag end. `dragleave` fires when moving between a tab's children, so the handler ignores leaves whose `relatedTarget` is still inside the tab.

## Risks / Trade-offs

- [Desktop title-bar drag region swallows drag events] → The project bar sits in a `-webkit-app-region: drag` area; project tabs themselves are `no-drag` (they take clicks). Verify early in the packaged-shape Electron run that `dragover`/`drop` reach the tabs; if a tab's hit area is partly `drag`, extend `no-drag` to the full tab box.
- [`getPanelData()` is read a frame after `dragstart`] → A very fast drag could reach a project tab before the record exists. `dragover` fires continuously, so the tab becomes a target on the next event; `drop` re-reads the record and does nothing if it is absent.
- [Playwright HTML5 drag is less deterministic than clicks] → Drive the e2e case with explicit `mouse.down`/stepped `mouse.move`/`mouse.up` and assert on the affordance class before releasing, the same shape the existing Dockview tab-drag cases use.
- [Hidden projects are not reachable by drag] → Accepted for this change; the context menu covers them and the non-goal is stated. Spring-loading or a drop on the switcher pill can follow if wanted.
- [Affordance stuck after a cancelled drag] → Clear on the workspace's drag-end report as well as on `dragleave`/`drop`, so Escape or a drop elsewhere always resets it.

## Migration Plan

None. Renderer-only and additive; reverting the change removes the drop targets and leaves the context menu as it is.

## Open Questions

None. No in-force ADR needs revisiting.
