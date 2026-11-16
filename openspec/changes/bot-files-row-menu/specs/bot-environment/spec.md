## MODIFIED Requirements

### Requirement: Files

Environment › Files SHALL browse the bot's home. It SHALL let the user:

- open a folder;
- preview a text or image file;
- download a file or a folder;
- upload files of up to 1 GiB each;
- create a folder, rename, and delete.

Files SHALL work whether the container is running or stopped, through one helper per bot. The helper SHALL:

- mount only the bot's home volume;
- have no network;
- run as `bot`;
- have bounded CPU, memory, and processes;
- stop once no view has used it for 5 minutes.

Uploaded files SHALL be owned by `bot`, and SHALL be written whole or not at all. When the bot has never started, opening Files SHALL create the home volume if the image exists. If the image does not exist, Files SHALL offer to build it.

Files SHALL never follow a symbolic link. It SHALL refuse any operation that would reach outside `/home/bot`, including through a link swapped in during the operation. It SHALL refuse to rename or delete an agent home directory, such as `.codex` or `.claude`.

A folder's contents SHALL update when they change, without the user reloading.

Each entry's actions SHALL be offered in the app's context menu, with the same look as Terminay's other context menus. The menu SHALL open from a "More actions" button at the end of the entry's row, from right-clicking the row, and from the keyboard's context-menu key or Shift+F10 on the row. It SHALL list, as they apply to the entry: Open for a folder, Preview for a file, Download for a file or folder, Rename, and Delete in the danger style. A link or other special entry SHALL offer only Rename and Delete, and the parent-folder row SHALL offer no menu. Delete SHALL ask for confirmation before deleting. A credential link SHALL show as locked and offer no actions by any of these means. The menu SHALL be usable from the keyboard: opening it from the keyboard focuses its first item, the arrow keys move between enabled items, the focused item is visibly marked, and Escape closes it and returns focus to the row's button. An open menu or delete confirmation SHALL close when its entry leaves the listing or the user changes folder.

#### Scenario: Upload while stopped

- **WHEN** a user uploads a file to a stopped bot's home
- **THEN** the file is in the bot's home, owned by `bot`, and the container is still stopped

#### Scenario: Link outside home

- **WHEN** a user opens a symbolic link in the bot's home that points to `/etc`
- **THEN** the request is refused and nothing outside the home is shown

#### Scenario: Agent home

- **WHEN** a user tries to delete `.codex` in a Codex bot's home
- **THEN** the request is refused and `.codex` is unchanged

#### Scenario: Row actions in a context menu

- **WHEN** a user chooses the "More actions" button on a file's row
- **THEN** the app's context menu opens with Preview, Download, Rename, and Delete, and the row shows no other action buttons

#### Scenario: Right-click a row

- **WHEN** a user right-clicks a folder's row
- **THEN** the same context menu opens at the pointer with Open, Download, Rename, and Delete

#### Scenario: Delete asks first

- **WHEN** a user chooses Delete from a file's menu and then Cancel
- **THEN** the file is still in the bot's home

#### Scenario: Keyboard

- **WHEN** a user focuses a row's "More actions" button, presses Enter, presses Down, and then Escape
- **THEN** the menu opens with its first item focused, focus moves to the second item, and the menu closes with focus back on the button

#### Scenario: Context-menu key

- **WHEN** a user focuses a file's row and presses Shift+F10
- **THEN** the context menu opens at the row with Preview focused

#### Scenario: Credential link

- **WHEN** a user right-clicks, or presses Shift+F10 on, a credential link's row
- **THEN** no menu opens, and the row shows it as locked with no "More actions" button

#### Scenario: Entry removed while its menu is open

- **WHEN** a file is deleted from the bot's home while its row's menu is open
- **THEN** the menu closes and the file's row is gone
