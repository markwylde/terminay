## Context

Home's Pull Requests and Issues sections (`ForgeHomeSection`) show a list and
a detail pane. A project's Git tab (`useProjectGitPanes`) shows Issues and
Pull Requests sidebar panes whose rows, for a client not bound to the project,
select Home's section with the item selected. The detail is fetched by
`useForgeDetail` from a source id and an item reference alone, and
`ProjectForgeDetail` already draws a full detail from just those two.

A folder's tabs are drawn by that folder's `ProjectWorkspace` Dockview. File
and folder tabs there are Dockview panels this device adds (`openFile`,
`openFolder`); they are not canonical workspace panels and the server does not
know them. Home's tabs are device-local presentation in their own Dockview
(ADR-0040), named by a descriptor that maps to one id.

## Goals / Non-Goals

**Goals:**
- Double click opens an item as a tab: in Home from Home, in the selected
  folder from a project's Git tab.
- One tab per item per place; opening it again brings it forward.
- A way to open a tab without double-clicking.

**Non-Goals:**
- A canonical, server-stored panel type for forge items. File and folder tabs
  are not canonical either, and a new canonical type would change the
  workspace schema, its reconciliation in every client, and MCP.
- Restoring a folder's item tabs after a reload; a folder's file tabs are not
  restored either. Home's item tabs are restored with Home's arrangement, as
  every Home tab is.

## Decisions

1. **A folder's item tab is a device-local Dockview panel, as a file tab is.**
   `ProjectWorkspace` registers a `forgeItem` component and `forgeItemTab` tab
   component and adds the panel to the active group, carrying only
   `{ sourceId, reference }` in its parameters. Its content reads the forge
   client and environment from a `ForgeTabContext` provided around the
   Dockview, so nothing that is not plain data enters panel parameters. No
   Electron, protocol, or server boundary is crossed: the tab asks for the
   item's detail through the same `forge.detail` operation, under the same
   project-binding narrowing, as the detail pane.

2. **A Home item tab is a new Home tab descriptor, `forge-item`.** It carries
   the server id, source id, item kind, origin, owner, repository name, and
   number, each escaped into its id, so the same item maps to one tab and is
   restored with Home's arrangement. It belongs to the Pull Requests or Issues
   section. A remembered tab for a server other than the window's says so
   instead of asking the window's server about it.

3. **A project row's single click waits out a double click.** Its single click
   leaves the list (it selects Home), so a double click would otherwise act on
   a list that is no longer on screen. `createForgeClickIntent` holds the
   single click for 250 ms and drops it when a second click arrives; a click
   with no count, as from the keyboard, acts at once. Home's rows select in
   place, so their single click is not delayed: the double click's first click
   has already selected the row and the second opens the tab.

4. **Open in tab is an icon action in the detail header.** It is offered only
   where the caller can open a tab, so the action never does nothing.

5. **The inventory, Tabs dashboard, and Folders tree name the new kind.** The
   inventory used to take any panel without a file or folder path for a
   terminal; an item tab is inventoried as `forge-item`, with its own icon and
   label, and never counts as a terminal.

## Risks / Trade-offs

- [A 250 ms delay on a project row's single click] → only where a double click
  is offered; keyboard activation is immediate.
- [A folder's item tabs are gone after a reload] → the same as its file tabs;
  the Git tab is one double click away.
