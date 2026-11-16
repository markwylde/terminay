## Why

In a bot's Environment › Files tab, each file and folder row ends in three small, faint icon buttons (download, rename, delete). They are hard to see and hard to hit, they don't say what they do until hovered, and they look nothing like the rest of Terminay, where per-item actions live in a context menu (issue #592).

## What Changes

- Replace the three inline row icons with one properly sized "More actions" button at the end of each row. It opens the app's shared context menu (`ContextMenu`, the same component and styling as the file explorer and chat message menus).
- Right-clicking a row, or pressing the context-menu key or Shift+F10 on it, opens the same menu at the row.
- The menu offers, where they apply today: **Open** (folder) or **Preview** (file), **Download**, **Rename**, a separator, and **Delete** (in the danger style). Each item has an icon at the size other menus use.
- Choosing Delete still asks for confirmation, in the row, before anything is deleted.
- Credential links keep no actions: their row shows "Locked" and has no menu.
- Keyboard: the button is in the tab order; opening the menu from the keyboard focuses its first item; Up and Down move between items; Escape closes it and returns focus to the row's button.
- An open menu or delete confirmation closes when its entry disappears from the listing or the user changes folder.
- The shared context menu gains an opt-in keyboard mode (menu roles, first-item focus, arrow/Home/End movement). Existing menus keep their behaviour unless they opt in. Every menu's items get a visible keyboard-focus style.

Out of scope: downloads failing in this tab (issue #593).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: the requirement "Files" states that a row's actions are offered in the app's context menu, from a "More actions" button and from right-click, and are keyboard accessible.

## Impact

- `src/workspace/bots/BotFilesView.tsx`: row menu state, the "More actions" button, right-click and keyboard handlers, the in-row delete confirmation.
- `src/workspace/bots/bots.css`: the row button and confirmation styles.
- `src/components/ContextMenu.tsx`: an opt-in `keyboard` mode; `src/App.css`: focus-visible styles for menu items.
- `packages/server-core/test/fixtures/bot-files-helper.mjs`: a small stateful fake home for e2e.
- `e2e/bots.spec.ts`: Files row menu coverage and screenshots in dark and light themes.
- No server, protocol, or helper change. Every operation still goes through the bot's Files helper, as before.
