## Why

At phone width several actions have no way to be invoked at all. The compact
chrome hid the two surfaces that were the sole hosts of a set of actions — the
Dockview panel tab strip and the project tab strip — and replaced them with
controls for only some of what they carried. Three consequences, one cause:

- **The tab editor is unreachable.** `terminal-workspace` requires that
  double-clicking or long-pressing a terminal tab opens the tab editor, where a
  terminal is renamed, coloured, given an emoji or a note. No tab strip is
  drawn at compact width, so that gesture has nothing to land on and the editor
  cannot be opened by any means.
- **Project editing is reachable only by a gesture nothing advertises.** A long
  press on a switcher project heading opens it; no menu, command, or control
  names it.
- **The Command Bar, which should be the fallback for all of this, is itself
  unreachable.** Its only entry points are `CmdOrCtrl+L`, which a touch host
  has no keys for, and the Desktop native menu, which a browser host does not
  render. So it cannot rescue any of the above — and since the compact chrome
  also carries no control for new terminal, split, clear, save, dictation, or
  any saved macro, those are lost with it.

Adding a control per lost action would refill the row the collapse was meant to
empty. The Command Bar is the surface that already exists to reach a command
without chrome; it needs one entry point, and the missing actions need to be
commands so it can reach them.

## What Changes

- Promote tab editing and project editing to first-class application commands —
  **Edit Active Tab** and **Edit Active Project** — alongside the existing
  command set. They become searchable in the Command Bar, listed in the Desktop
  View menu and the browser host's in-page View menu, and rebindable in
  shortcut settings, with no default accelerator.
- Add **Open Command Bar** to the browser host's in-page View menu, the parity
  with the Desktop View menu that its Show Dashboard, Set Project Root, and
  Toggle File Explorer entries already keep.
- Add a Command Bar control to the compact chrome row, between the dashboard
  control and the breadcrumb, so one tap reaches every command above. It is
  unavailable when no project is in front.
- Restore the long press on a terminal: a switcher terminal row SHALL open that
  terminal's editor on a long press, the gesture its project heading already
  carries and the one the hidden tab used to carry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: **Open Command Bar** stated as
  present in both the Desktop and browser menus; tab and project editing added
  to the command model and to both menus.
- `workspace-and-project-tabs`: the compact chrome row gains the Command Bar
  control and a fixed position for it.
- `terminal-workspace`: the tab editor is required to stay reachable at a width
  where no tab strip is drawn.

## Impact

- `src/keyboardShortcuts.ts` — two `AppCommand` entries and their descriptors.
- `src/App.tsx` — command handling for the two editors; the compact row's new
  callback and availability.
- `src/web/ConnectedWebRendererWorkspace.tsx` — three entries in the browser
  menu's `view` list.
- `src/workspace/CompactChromeRow.tsx` — a control and its callback prop.
- `src/workspace/CompactSwitcher.tsx` — long press on a terminal row.
- `electron/main.ts` — two View-menu items.
- `src/App.css` — no new pattern; the control reuses `compact-chrome__icon`.
- Sequencing: this change modifies the **Compact bar presentation** requirement
  as `compact-unified-switcher` leaves it. That change is implemented and
  merged but not yet archived; this delta is written against its text and
  should land after it.
