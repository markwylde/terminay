## Context

The compact switcher (`src/workspace/CompactSwitcher.tsx`, styled in `src/App.css` under `.compact-switcher*`) is the sheet a phone-width workspace opens to answer "which panel". It renders a list: a connection heading, then per project a heading row (swatch, activity dot, name, close, `+`), then either panel rows or, when the project has more than one folder, a small folder button followed by that folder's rows. A footer holds three equal buttons. Its data comes from `compactSwitcherModel.ts`, which already produces `connection → project → folders → panels`, with `folders` empty for a project whose folders this window does not know.

The model is sound. The presentation is not: the four levels differ by a few pixels of indent and by text that gets *smaller* as it gets more structural. The approved replacement is Variant 2 of the mockup at https://claude.ai/artifact/2kqVfAi6XNDHvFVkc7QzNU, with two decisions taken after it: close controls stay as small `×` buttons on rows and headers, and a project whose only folder is General still shows that folder's label.

Constraints that shape the design:

- The sheet must stay a touch surface: nothing takes focus on open, targets are thumb-sized, long press edits.
- ADR-0053 leaves the compact switcher outside the shared in-page window frame; it keeps its own sheet.
- ADR-0049 makes a folder a server-owned grouping that carries no authority. The switcher only names folders and selects them.
- ADR-0047 and ADR-0048 make a window one server. The model still accepts several sources and the main spec still requires a connection heading, so this design keeps both and does not depend on how many sources there are.

## Goals / Non-Goals

**Goals:**

- Make project, folder, and terminal distinguishable at a glance by containment and typographic role, not indent.
- Make the sheet shorter for the same content than it is today.
- Make "new terminal" one tap that says where it will land, and make creating in a specific folder one tap on that folder.
- Keep every action the sheet has today reachable: activate, close, edit by long press, filter, switch server, new project, add connection.

**Non-Goals:**

- No change to which panels are listed, to activation, to close protection, or to the filter's matching rules.
- No new gestures (swipe to close, drag to reorder).
- No change to the wide project switcher menu, the tab strip, or anything above 640px.
- No folder creation from the switcher.
- No server, protocol, Electron, or persistence change.

## Decisions

### 1. Containment by card, not by indentation

Each project renders as one element that wraps its header and its body, with a 1px border in the project colour mixed toward transparent, a 9px radius, and 6px between cards. The header is a 30px strip with a project-colour tint. Inside, nothing is indented relative to the card: folder labels and rows share the card's inner edge.

*Alternative: keep the list and deepen the indent with guide lines (POC 1).* It fixes legibility but costs title width at every level and still relies on the eye following a line. A border answers "what belongs to this project" without reading.

*Alternative: borderless filled blocks (Variant 3).* Thinner still, but on the sheet's dark surface a 3.5% fill is too faint to carry the grouping in daylight on a phone.

The tint uses `color-mix(in srgb, <project colour> N%, transparent)` driven by one custom property set on the card, replacing the per-row `border-left-color` inline style. The continuous left rail on rows is removed; the card does its job.

### 2. Folder as a ruled label line, always present when known

A folder renders as one line: an uppercase 9.5px label, a hairline rule filling the remaining width, and a trailing `+`. It is a button for its label (existing `onActivateFolder`) with the `+` as a sibling button, not a nested one. An empty folder is that line and nothing else; `compact-switcher__folder-empty` and the "No panels" paragraph go away.

The label shows for every project with known folders, including one with only General. That costs one ~20px line on single-folder projects and buys one consistent rule: the `+` on a folder line always means "here". Mark chose this over moving the `+` to the header for single-folder projects.

A project with `folders.length === 0` (folders unknown to this window) keeps today's shape inside the card: rows directly under the header, and the header keeps a `+` that creates in the project. This is the only case where the header carries `+`.

### 3. Header status summary replaces the activity dot here

The header shows text such as `1 needs you` or `2 working · 1 idle` in place of `ProjectTabActivityDot`. Two dots side by side (colour swatch, activity) was one of the reported confusions, and words tell a phone user more than a colour does.

The summary is computed in the model as a pure function over the project's terminal rows, from the `state` each row already carries, so a header cannot disagree with the rows under it and inherits their acknowledgement behaviour for free. Grouping: `waiting` and `blocked` count as "needs you"; then `working`, `done`, `idle`. The view shows the two most urgent non-empty groups; the accessible text states all of them. The leading group is coloured with the same token its rows' `AgentStatusIndicator` uses.

*Alternative: reuse the project's `ActivityCountBadge`.* It is a single count in a single colour and cannot say "1 working, 1 idle". It also follows indicator-visibility settings that rows do not consult, which is how a header and its rows could differ.

The `badge` field stays on the model because the wide project switcher menu's dot is fed separately and nothing else reads it from here; if it is unused after this change it is removed from the model in the same commit.

### 4. Create bar: one contextual primary, two icon controls

The footer becomes a row with one flexible control and two fixed 38×36 icon controls. With a project in front the flexible control reads `+ Terminal in <project> › <folder>` and calls the existing `onNewTerminalHere`; the icons are New project and Add connection. With no project in front (`onNewTerminalHere` absent) the flexible control is New project and Add connection is the single icon.

The label needs the front project's title and selected folder name. The component receives them as a new optional prop from `App.tsx`, which already holds both (`activeProjectId`, the device's selected folder). The component does not derive it from `groups`, because a filter can remove the front project from `groups` while the bar must still be correct.

*Alternative: a floating create dial (Variant 3).* Two taps for every create and it covers the last rows.

*Alternative: ghost "New terminal" rows in every folder (Variant 1).* Adds a row per folder, which undoes the thinning as folders multiply.

### 5. Creating in a named folder reuses the existing command path

A folder's `+` calls a new `onNewTerminalInFolder(project, folder)` prop. In `App.tsx` this selects the folder (`selectFolder`) and then runs the same `createCompactSwitcherTerminal` path as a project's `+`, which activates the project and dispatches the project's own `new-terminal` command. That command creates in the device's selected folder, so no new command or server call is needed.

Folders are only known for projects on the window's server, so a folder `+` never has to cross servers; the cross-server pending-create path is reached only from a header `+` and is unchanged.

**Boundary:** this stays entirely in untrusted renderer presentation (ADR-0011). It issues the same workspace commands the tab strip and Command Bar issue. Folder selection is device-local presentation and a folder carries no authority (ADR-0049), so choosing where a terminal is created grants nothing.

### 6. Thinner rows without losing the thumb target

Rows drop from a 38px minimum with 13.5/11px type to a 36px floor that holds two tighter lines (13px/17px title, 10.5px/14px preview) with 2px vertical padding. The floor stays at 36px, with or without a preview, because that is the tappable minimum the breakpoint tests guard. The saving comes from the header (30px), the folder line (~20px), removed "No panels" rows, and the footer, not from shrinking rows below a comfortable tap height.

Small controls keep a large hit area: the row `×`, header `×`, and folder `+` are drawn at 14px glyphs in dim ink but their buttons are at least 28px wide and as tall as their line, and the folder `+` extends its hit area vertically with padding so it is not a 20px target.

### 7. Reconciling with the two overlapping active changes

- `one-window-one-server` removes **Unified compact switcher** and adds **Compact switcher groups by project**, and modifies **Compact switcher terminal creation shows the created terminal**. This change modifies the same two requirements against the main spec as it stands today. Whichever archives second must re-apply its edits onto the other's text: if `one-window-one-server` archives first, this change's delta is rewritten to modify **Compact switcher groups by project** (dropping the connection-heading sentences), and its edit to **Project switcher rows show the activity dot** moves to **Switcher rows show the project activity dot**.
- `linked-folders` specifies **Folders on a compact workspace** in `project-folders`. This change's **Compact switcher folder labels** is compatible with it and is placed in `workspace-and-project-tabs` so it does not depend on a capability that is not yet in the main specs.

The implementation is unaffected by the order; only the delta files are.

## Risks / Trade-offs

- [A folder `+` at ~20px line height is a small target] → the button's hit area is padded to the full line plus overlap, verified by an e2e tap at 320px width.
- [Tinted borders can vanish for a very dark or very desaturated project colour] → the border mixes the project colour with a neutral light floor so a card edge is always visible; checked against the darkest palette colour.
- [Text summaries are longer than a dot and can crowd a long project name] → the name truncates first; the summary is capped at two groups.
- [Removing the activity dot from this surface drops the breathing "working" cue on the header] → rows keep their breathing indicator, and the summary states the count in words.
- [Spec deltas collide with `one-window-one-server` at archive time] → decision 7; a task checks which has archived before this one is archived.
- [Always-on General label adds a line to every single-folder project] → accepted for consistency; the removed footer height and thinner header more than cover it.

## Migration Plan

Presentation only; nothing is stored. Ship in one change. Rollback is reverting the commit.

## Open Questions

None.
