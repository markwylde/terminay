## Context

`BotFilesView` (`src/workspace/bots/BotFilesView.tsx`) renders the bot's home as a table. The last column holds up to three `bots-icon-btn` buttons with 14px lucide icons in `--bots-muted`: Download (files and folders), Rename, and Delete. Delete swaps its icon for a red "Delete" button as a two-click confirmation. Credential links show "Locked" instead. Opening a folder or previewing a file is done by clicking the name.

Terminay's other per-item actions use `ContextMenu` (`src/components/ContextMenu.tsx`), a portal rendered at a point with `.context-menu` styling (`src/App.css`), 14px icons, separators, and a danger style. It closes on outside click and Escape. It has no keyboard focus management: nothing is focused when it opens, arrow keys do nothing, and its items use `all: unset`, so a focused item shows no focus ring.

This change is presentation only, in the shared server-bundled workspace UI. Every file operation still goes through the bot's Files helper on the server, so no privilege, project/window, or terminal-session boundary is crossed.

## Goals / Non-Goals

**Goals:** row actions in the app's context menu, easy to see and hit; right-click on a row; full keyboard use; the same actions as today.

**Non-Goals:** fixing downloads (#593); multi-select; drag and drop; any change to the helper, protocol, or which entries allow which actions.

## Decisions

- **Reuse `ContextMenu` unchanged in look.** The row menu passes items to the shared component, so styling, sizing, outside-click, and Escape match other menus. Alternative considered: a bots-local dropdown. Rejected because the issue asks for consistency with the app's menus.
- **One trigger per row plus right-click.** A 28px `bots-icon-btn` with zero padding (so global button padding cannot shrink the icon) and a 16px `MoreHorizontal` icon in the foreground colour, labelled `More actions for <name>`, with `aria-haspopup="menu"` and `aria-expanded`. The actions column is only as wide as its content and is right-aligned, so the button sits at the table's right edge; the menu opens below it with its right edge on the button's. Right-click on the row opens it at the pointer.
- **Keyboard origin.** A click with `event.detail === 0` (Enter or Space on the button) is keyboard-originated. A `contextmenu` event is keyboard-originated when its `button` is not 2 or its client coordinates are both 0 (the context-menu key and Shift+F10 on a focused row control). A keyboard-originated menu opens at the focused element's bottom-left corner and focuses its first item.
- **Items by entry kind**, keeping today's rules:
  - folder: Open, Download, Rename, separator, Delete
  - file: Preview, Download, Rename, separator, Delete
  - link or other: Rename, separator, Delete
  - credential link: no button, and right-click or the keyboard opens no menu; the row shows "Locked"
  - the `..` row: no menu
- **Delete confirms in the row.** Choosing Delete puts the row's action cell into a confirmation: a danger "Delete" button, focused, and "Cancel". Escape or Cancel ends it and focus returns to the row's button. This keeps the existing two-step safety without a modal.
- **Explicit keyboard mode in `ContextMenu`.** A new opt-in `keyboard?: { autoFocus: boolean }` prop. Without it, the component renders and behaves exactly as today. With it, the menu gets `role="menu"`, items `role="menuitem"`, separators `role="separator"`; ArrowDown and ArrowUp move to the next or previous enabled item, wrapping; Home and End go to the first and last; and `autoFocus` focuses the first enabled item after mount. Disabled items are skipped. Switching to a different row remounts the menu so keyboard autofocus runs for that row, even if the previous menu also used keyboard autofocus.
- **Visible focus for every menu.** `.context-menu__item:focus-visible` (and the trailing button's) gets the hover background plus an inset outline in `src/App.css`. Focus-visible only shows for keyboard focus, so pointer use of existing menus looks unchanged.
- **Focus returns to the trigger.** At close time a focused menu item is still connected, so the check cannot happen in `onClose`. Instead `BotFilesView` checks in an effect after the menu has unmounted: if the active element is then `body` or disconnected, it focuses that row's "More actions" button. Rename and Delete move focus to their own input or button first, and an outside click focuses whatever was clicked, so neither is overridden.
- **Menus and confirmations do not outlive their entry.** The row menu and the delete confirmation are keyed by the directory and entry name they were opened for. Changing directory clears both. When a listing arrives without that entry (deleted elsewhere, renamed, or live refresh), both are cleared. A menu action always uses the path captured when the menu opened. Listings are bound to their Files client and directory; rows disappear immediately on navigation, and inactive or superseded listing requests cannot overwrite the current rows. A changed entry kind also closes its menu, and a replacement credential link clears a pending delete confirmation.

## Risks / Trade-offs

- [The menu's position math assumes 200px width and 32px rows] → Same as every other menu today; rows near the bottom shift up as they do elsewhere.
- [Focus-visible styling applies to every context menu] → Only keyboard focus shows it; pointer use is unchanged.
- [Discoverability of right-click] → The visible button remains the primary way in.
