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
Every section's list starts below several rows of search fields, chips, and
view switchers that a phone has no room for.

## Goals / Non-Goals

**Goals:**

- Close the Command Bar by touch.
- Make the server control a rail tab with a panel.
- Make the launcher's folder picker scale to many folders.
- Remove the duplicate Home section list.
- Give every Home list section a phone-native page: a title row, status tabs
  with counts, dense rows, and a bottom sheet for secondary options.
- Let a workflow be opened into a full detail page on a phone.
- Tidy Bots, and let its Needs you requests be decided from the list.

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

### 5. Compact section pages

The first attempt moved each section's toolbar, unchanged, into a right-hand
options panel. Review rejected it: the page lost its controls but gained
nothing, and the panel was the same header stacked in a drawer. The phone pages
are redesigned instead. The mockups the user approved are the reference.

**One page shape.** A new kit in `src/workspace/compact/` draws every compact
section page:

- `CompactSectionPage`:
  - **Header row:** title, summary, Search, View options with its applied
    marker, and an optional create control.
  - **Search mode:** replaces the header row with a 16px field and Cancel.
  - **Status tabs:** a `tablist` that scrolls sideways.
  - **Applied row:** one token per applied option, plus Clear.
  - **Body:** the list, scrolling as one region under a sticky header and tabs.
- `CompactRow`, `CompactGroupHeader`, `CompactChip`, `CompactEmpty`: the row
  anatomy the spec describes (leading mark, title, trailing age, detail line,
  chips), so seven sections do not draw seven row styles.
- `CompactSheet`: the View options sheet. It is a `CompactEdgeDrawer` with
  `edge="bottom"` (ADR-0125). It has a grab handle, a title, Reset (only when
  something differs from its default), Done, and a scrolling body. It also
  offers small `SheetSegment`, `SheetToggle`, `SheetSelect`, and
  `SheetChecklist` building blocks. Options apply as they change; Done only
  closes.

`CompactEdgeDrawer` gains the bottom edge: full width, `max-height: 80%`,
rounded top corners, and a slide up that reduced motion turns off. Scrim, focus
containment, focus return, and Escape stay as they are.

**Which presentation.** `HomeWorkspace` provides `CompactHomeContext` (a
boolean) from `App.tsx`'s single `isCompactChrome` measurement. A section reads
it with `useCompactHome()`. When it is true, the section returns its compact
page; otherwise it returns its wide page unchanged.

**State lives above the branch.** Each section's filter, search, and option
state already lives in the section component or its stored view, so both
presentations read the same state:

| Section | Tabs map to | Search | Sheet options |
|---|---|---|---|
| Tabs | new `statusTab` state (All, Needs you, Working, Done, Idle, and Untracked when shown) | the dashboard filter text | Layout (List or Projects), Untracked tabs |
| Workflows | new `compactTab` state; the stored multi-choice status filter applies as one applied option | the text filter | Sort, Group, project checklist, Show finished |
| Bots | the existing single-choice filter chip state (All, Needs you, Working, Stopped) | the bot filter text | engine details only, through the engine card |
| Automations | new `automationTab` state | none (no search on a wide window either; Search is not offered) | the server selector |
| Recordings | new `recordingTab` state | the search text | the server selector, Updated, and Refresh |
| Pull Requests / Issues | the existing scope state | none (no search on a wide window; Search is not offered) | State, Group, repository filter, Updated, and Refresh |

Tab, search, and sheet state stays set when the section tab goes behind another
Home tab, and when the window crosses the breakpoint. Home tabs stay mounted,
and the state lives above the presentation branch. The Board layout is not
offered on a compact page; a stored Board view shows as List there, and the
stored choice is not rewritten.

**Counts.** Each tab's count is computed from the same filtered set the list
uses, with every filter applied except the tab itself.

Forge scopes are separate queries, and ADR-0106 forbids extra fetching. A scope
tab therefore shows a count only while the Home pull request cache holds that
scope's result for the current State and repository key. The count is the
result's length, with + when the forge reports more pages. Changing State or
repository changes the key, so other scopes' counts disappear until visited.
Nothing is fetched to show a count.

**Applied options.** Each section declares which sheet options are filters, and
supplies a token label and a reset for each:

- Workflows: the project filter (one token naming the included projects), Show
  finished off, and a stored wide status filter (one token naming its tones).
- Forge: a state other than Open, a chosen repository.
- Tabs: Untracked tabs is not a filter; it adds rows.
- Bots, Automations, Recordings: nothing.

Sort, grouping, layout, and notes are never filters.

**Workflow detail page.** `WorkflowsHome` holds `detailWorkflowId`. While it is
set on a compact page, the section shows `CompactWorkflowDetail`, built from
the same workflow model the wide card uses. It shows:

- a back control;
- an eyebrow with project and terminal;
- the name;
- a progress bar with `n of m` and elapsed time;
- **Open terminal**, which uses the wide card's open action;
- the brief;
- a step timeline with each step's status mark, title, note, and time.

A step that needs the user is highlighted and offers Open terminal. Terminay
never answers or runs a step (ADR-0097). Back, or Escape, clears the id. The
list's scroll position is restored from a ref captured when the row was
activated.

**Bots Needs you cards.** Each `needsYou` entry is drawn as a card. When the
entry's session carries a permission request, the card reuses the existing
`PermissionPrompt` and decides through `server.client.decide`, as
`BotSessionsPanel` does. The client is the one for the server that owns the bot
(each bot row already carries its connection), and the decision names the
request's current ids. The card disables its choices while the call is pending,
keeps itself and shows an error on rejection, and disappears when the request
leaves `needsYou` because another client decided it. Every card offers Open
chat. Tab counts count bots, as the wide chips do.

The All tab ends with an engine card built from `useBotEngine`. Activating it
opens the sheet, where `EngineSummary` renders in its compact form. The build
banner renders above the rows, with its open state lifted into `BotsSection` as
it is now.

**One drawer at a time.** `App.tsx` already closes the switcher when the
Command Bar opens. It now also raises a `compactDrawerEpoch` counter whenever
the switcher or the Command Bar opens, and provides it beside
`CompactHomeContext`. `CompactSectionPage` closes its sheet when the epoch
changes, and when compact turns false, which also unmounts the sheet with the
compact page; focus then moves to the wide page's body. The sheet has one layer,
so a press outside it closes only the sheet.

**Removed.** `HomeOptionsPanel`, its `HomeSectionOptions` slot, and every
section's slot wrapping are deleted. So are the chrome row's `homeOptions` prop
and filtered dot, and `App.tsx`'s options-panel state and routing. On a compact
Home, the trailing sidebar toggle is not drawn. The shortcut and the sidebar
command do nothing there. The sections' on-page compact empty states with clear
controls stay, restyled as `CompactEmpty`.

### 6. Bots on a compact workspace

Bots follows the compact section page. The create control is New bot. Rows use
the avatar variant of `CompactRow`, and the engine card closes the All list.
The wide grid, its right rail, and the "New bot" tile are not drawn on a compact
workspace.

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
ADR-0125: compact drawers and sheets are not in-page windows. No decision
crosses the server, protocol, preload, or security boundaries. The compact pages
re-present data and actions that already exist, and every action they take goes
through the same calls as on a wide window.

## Risks / Trade-offs

- **Two pending changes.** `simplify-phone-header` and `workflows-home-on-phones`
  add requirements that this change modifies (`Compact chrome row`, `Workflows
  toolbar on a narrow width`). They must be archived first. Proposal Impact
  records this.
- **Hidden options.** An option set in the sheet is not visible while the
  sheet is closed. Every option that hides rows shows as a token under the tabs,
  and View options carries a marker, so nothing is filtered silently.
- **Two presentations per section.** Each section now has a wide page and a
  compact page. Shared state above the branch, and the shared kit, keep them
  from drifting apart. E2E covers both.
- **Forge counts.** Scope tabs can show a count only for scopes already loaded.
  This is a deliberate trade against extra fetching (ADR-0106).
