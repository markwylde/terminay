## Why

On a phone there is no visible way to close a tab. The compact chrome hid the
panel tab strip and the project tab strip — the only surfaces that carried a
close control — and the switcher that replaced them can create, switch, and
edit, but not close. Command Bar → Close active tab exists if you already know
the command; a thumb on a phone never finds it.

## What Changes

- Each terminal, file, and folder row in the compact switcher gains a close
  control that closes that panel through the same path and close-protection as
  the hidden tab.
- Each project group heading gains a close control that closes that project
  through the same path and close-protection as the hidden project tab.
- File and folder panels appear as rows in the switcher, so they can be
  activated and closed at a width where no panel tab strip is drawn.
- Closing a row keeps the switcher open so more than one tab can be closed
  without reopening it.
- Wide-layout tab chrome is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the compact switcher is the close surface for
  terminals, files, folders, and projects at phone width, using the same
  close-protection the tab strip already uses.

## Impact

- `src/workspace/CompactSwitcher.tsx` — close controls on panel rows and
  project headings; file and folder rows rendered beside terminals.
- `src/workspace/compactSwitcherModel.ts` — rows include every panel kind, not
  only terminals.
- `src/App.tsx` — wire close to the existing panel and project close paths.
- `src/App.css` — close control styling on the existing row layout.
- `scripts/compact-switcher-ui.test.mjs` and
  `scripts/compact-switcher-model.test.mjs` — close affordance and file/folder
  rows.
- `e2e/compact-chrome-switcher.spec.ts` — compact-viewport close of a terminal
  and of a project.
- Sequencing: this change sits on `compact-unified-switcher` and
  `compact-command-bar-entry`, which are implemented and merged but not yet
  archived. The delta is written against their compact-switcher contract.
