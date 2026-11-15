## Context

The compact workspace (compact chrome at 640px and below) is the phone layout:

- a single chrome row: Command Bar control, title block, Notifications, Pixel's
  dock, and a trailing panel button;
- a left-hand switcher drawer whose rail holds a server control, Home, and the
  projects.

Each Home section draws its own header and toolbar inside the page. There is no
shared toolbar component:

- Tabs: `WorkspaceDashboard`
- Bots: `BotsSection`
- Automations: `AutomationPanels`
- Workflows: `WorkflowsHome`
- Recordings: `SharedRecordingsLibraryPane`
- Pull Requests and Issues: `ForgeViews`

`isCompactChrome` is measured once in `App.tsx` and reaches only the automation
and bot tab hosts, through `HomeWorkspace`'s private context. While Home is
selected, the trailing panel button calls `toggleHomeSidebar`, which shows the
Home sidebar. Below 720px, that sidebar is a full-screen navigation drawer.

## Goals / Non-Goals

**Goals:**

- Close the Command Bar by touch.
- Make the server control a rail tab with a panel.
- Make the launcher's folder picker scale to many folders.
- Remove the duplicate Home section list.
- Move every Home section's filters and view options off the page and into one
  right-hand panel.
- Tidy Bots.

**Non-Goals:**

- Settings category pages.
- Any change at widths above the compact breakpoint, except the Command Bar
  close control, which applies at every width.
- Any change to stored view options or server state.

## Decisions

### 1. Command Bar close control

The `ESC` hint becomes a `<button>` with the accessible name "Close command
bar". It keeps its key-cap look and calls the dialog's existing `onClose`. It
applies at every width: a desktop pointer user benefits as well, and one code
path is simpler than two.

### 2. Servers as a rail tab

The rail item keeps its place at the top and its reachability dot, and gains a
`Servers` label like Home's. Its accessible name still names the current server,
so the existing scenario that "the rail's server control names that server"
holds. Selecting it sets the switcher's selection to a `SERVERS` key, as Home
uses `HOME`. The panel body reuses the rows the sheet menu built:

- the server rows, with the current one checked and a "Connecting…" hint while
  switching;
- the `serverUpgrades` node.

**Add connection** moves into the panel's bottom bar, where **New project** sits
on Home, so that it stays reachable however long the list is. The panel has no
search, no edit control, and no Tabs/Agents strip.

The `server` sheet layer is deleted. The selection is not remembered: like any
rail selection, the switcher opens on the item in front.

### 3. Launcher folder picker

The chip radiogroup becomes a disclosure button: "Open in" plus the folder name
and its branch glyph, with `aria-expanded`. Expanding it replaces the launcher
list in the dropup with:

- a search field labelled "Filter folders", focused on open;
- a `listbox` of matching folders, with the current target marked.

Matching is case-insensitive substring matching on the displayed name. ↑/↓ move
the highlight, Enter or a tap chooses it, and Escape collapses the picker
without closing the dropup, consistent with the layered-dismissal rule.
Choosing a folder sets the target and collapses back to the launcher list.

With one folder, the control is drawn without the disclosure, because there is
nothing to pick. With no folders, the header is absent, as now.

### 4. No Home sidebar on a compact workspace

`HomeView` receives `isCompact` and never shows its sidebar when it is true. The
remembered Home sidebar visibility is not read or written at compact width, so
returning to a wide window restores the user's wide choice. The switcher's Home
panel already opens sections, so nothing becomes unreachable.

### 5. Home options panel

A new `HomeOptionsPanel` host lives in `HomeWorkspace`. A context exported from
it gives sections a `<HomeSectionOptions active={boolean}>` slot.

**Ownership.** Home keeps several tabs mounted at once, so every slot registers
under its own Home tab's id. `HomeWorkspace` already knows each tab's id and
which tab is in front. It provides the tab id to each section through the
existing tab-host context. The host reads only the registration of the tab in
front: its title, whether it has options, and its `active` flag.

- A background tab's registration is kept but ignored.
- A tab that unmounts removes its registration.
- A tab with no slot, such as the overview or a bot's own tab, has no
  registration, so the toggle is not offered.

**Placement.**

- **Wide:** the slot renders its children inline, so nothing changes.
- **Compact:** the panel element exists, closed and `inert`, whenever the
  workspace is compact. The front tab's slot always portals its children into
  it, so the controls stay mounted while the panel is closed.
- **Why it matters:** child-local state, such as an expanded picker or a typed
  but uncommitted field, survives closing and reopening the panel.
- **What does not survive:** switching to another tab, or crossing the
  breakpoint, remounts the children. Their filter values survive because they
  are section state. Disclosure state and the panel's scroll position reset,
  which the spec allows.

**Shell.** Per ADR-0125, the panel is a compact edge drawer. It reuses the
switcher's drawer shell, extracted into a shared `CompactEdgeDrawer` component
and mirrored for the right edge:

- `width: min(360px, 100% - 52px)`, a scrim, and the same slide-in that
  reduced motion turns off;
- a header with the section title and a close button;
- a body that scrolls;
- it closes on the scrim, on Escape, and on the close button;
- focus is contained while it is open, starting on its first control.

**Closing and focus.** It closes on its own when:

- the front Home tab changes;
- Home is left;
- the workspace stops being compact;
- the switcher or the Command Bar opens.

`App.tsx` holds the open flag, so all four triggers are plain state changes.
When the panel closes, focus returns to the toggle if it is still drawn, or to
the compact title block, or, once the workspace is no longer compact, to the
page body.

In `App.tsx`, the trailing panel button branches on Home:

- **Home selected:** it toggles the panel. It is drawn only when the front
  section has registered options. Its accessible name is "Show options" or
  "Hide options", with ", filters applied" appended when `active`. A dot marks
  `active`.
- **Project in front:** it keeps toggling the project sidebar as now.

The keyboard shortcut and the "Hide/Show sidebar" command toggle the same panel
on a compact Home, so they never reveal the removed sidebar.

What each section moves into the slot, and what stays on the page:

| Section | In the panel | On the page |
|---|---|---|
| Tabs | filter field, Group by project, view-mode switcher, summary chips | title and the rows |
| Bots | filter field, status chips, Container engine card | title row with **New bot**, the list, and Needs you below the list |
| Automations | server selector | title row with **New automation** |
| Workflows | the whole toolbar, every option shown directly (no View options disclosure, layout, or Narrow columns) | header and columns |
| Recordings | search and server selector | header and list |
| Pull Requests / Issues | scope chips, state and group segmented controls, and the repository filter | title, count, refresh, and list |
| Home overview | — (no panel button; its Edit layout control stays on the page) | everything |

`active` means "the section shows fewer items than it would with its filters
at their defaults". Each section computes it:

| Section | Counts as a filter |
|---|---|
| Tabs | the filter text, a summary-chip filter |
| Bots | the filter text, a status chip other than All bots |
| Workflows | the text filter, the status filter, an excluded project, Show finished off |
| Recordings | the search text |
| Pull Requests / Issues | the scope, state, or repository differing from the default |
| Automations | nothing (the server selector picks a source; it does not filter) |

Grouping, sorting, notes, and view mode never count.

**Empty filter results.** Every section needs an on-page "nothing matches"
state with a clear control while compact. Some sections need work to get one:

- **Workflows and Tabs** already have one.
- **Recordings** shows a message only; it gains a clear-search button.
- **Bots** keeps its "Clear filter" action in the toolbar, so the toolbar moves
  into the panel, and Bots gains an on-page clear in its empty list.
- **Forge** gains a "Show all" reset in its empty state that restores the
  default scope, state, and repository.

### 6. Bots on a compact workspace

`BotsSection` already receives `host.compact`. When it is set:

- the header becomes one row of the title and **New bot**;
- the description stays under it;
- the right rail is not drawn in the page. `EngineSummary` goes into the panel
  slot and `NeedsYouList` moves below the bot list.

Gutters follow the compact gutter used by the other Home sections: 16px sides
and 12px between blocks.

### 7. Servers panel scope

The panel reuses `servers` (saved profiles this window can show) and
`serverUpgrades` (rows produced only for attached connections). It shows the
following only for attached connections (ADR-0047 decision 6):

- reachability;
- upgrades.

A saved server that is not attached shows only its name and a switch action.
Nothing in the panel renames, edits, or forgets a saved server; Settings stays
the only place for that (ADR-0075, ADR-0115).

### Boundaries

All of this is renderer presentation. The one architectural decision is
ADR-0125: compact edge drawers are not in-page windows. No decision crosses the
server, protocol, preload, or security boundaries. The panel and the switcher only
re-arrange controls that already exist, and every action they take goes through
the same calls as before.

## Risks / Trade-offs

- **Two pending changes.** `simplify-phone-header` and `workflows-home-on-phones`
  add requirements that this change modifies (`Compact chrome row`, `Workflows
  toolbar on a narrow width`). They must be archived first. Proposal Impact
  records this.
- **Hidden filters.** A filter applied in the panel is not visible on the page.
  The dot and accessible-name suffix on the panel button mitigate this. Each
  section also keeps its existing "no matches" or "Clear filter" empty state on
  the page.
- **Portal focus.** Moving inputs into a portal must not steal focus from the
  page while the panel is closed. The slot renders nothing at compact width
  while the panel is closed.
