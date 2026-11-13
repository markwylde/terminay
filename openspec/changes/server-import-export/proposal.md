## Why

A Desktop user with several servers attached (Local plus remotes such as a VM or
a build box) builds up macros, workflow templates, shell profiles, automations,
and preferences on one server and then has to re-create them by hand on every
other one. Nothing shows which servers already have an item or where copies have
drifted apart. Each of these is server-owned, and no server talks to another, so
the only place that can see and copy between servers is the Desktop window that
already holds an authenticated connection to each of them.

## What Changes

- Add an **Import & Export** category to Settings, opened from a new
  **Import & Export…** item directly under **Settings…** in the Terminay
  application menu, and from the Command Bar. It is offered on Desktop only.
- The category shows a **sync matrix**: one row per item (macros, workflow
  templates, custom shell profiles, automations, and portable settings
  categories), and one column per attached server. Each cell says whether that
  server's copy is the **same**, **differs**, or is **missing**, by glyph and
  word. It has kind filters, a text filter, and an **Only differences** toggle.
- The user picks one source column, ticks one or more target columns and the rows
  to copy, then **Review**. In review, every item whose name already exists on a
  target with different content needs the user's choice. Items offer
  **Replace**, **Keep both**, or **Skip**. Settings categories offer
  **Replace** or **Skip**. There is no default. **Apply** writes each item
  through the target server's own existing operations, guarded by the revision
  it reviewed, and reports a result for each item.
- Copying is a one-time copy. Items are matched by kind and name, never by
  server-assigned id, and compared by content. No link is kept between copies.
- Automations always arrive **disabled**. An automation's macro or shell-profile
  reference is re-pointed to the item with the same name on the target. If the
  target has no such item, it is added to the copy as a dependency.
- **Export selected…** writes the selected rows from one server to a versioned
  JSON bundle file, with their dependencies. **Import file…** opens such a
  bundle as an extra read-only source column in the matrix, so a file can be
  copied to servers the same way. A bundle never contains server ids, item ids,
  revisions, or vault secrets. Literal item content is written as plain text,
  and the export says so.
- ADR-0111 records that this one category spans connections, partly
  superseding ADR-0075 rules 2 and 4 for it alone.
- The Settings server selector does not apply to this one category. Each column
  is still one server's data, read and written through that server's own client.

## Capabilities

### New Capabilities

- `server-import-export`: the Desktop cross-server sync matrix, the review and
  apply of one-time copies between attached servers, and bundle-file export and
  import.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: the Settings server-selector
  requirement gains its one exception, the Import & Export category, which
  shows every attached server side by side without merging their values.

## Impact

- **Shared UI (`src/`)**: a new Settings category module with matrix, review,
  and apply. It adds a pure item-model layer: normalize, match, fingerprint, and
  plan writes, for each kind. Settings groups gain the category under
  Connections.
- **client-core**: no new protocol operations. It uses the existing `MacroClient`,
  `WorkflowClient` template operations, `ShellProfilesClient`,
  `AutomationClient`, and `SettingsClient` on each attached connection.
- **Electron (`electron/`)**: one new Terminay-menu item and menu command
  (`open-import-export`), and one bounded save-file host action for bundle
  export. Import reads a user-chosen file in the renderer and needs no
  privileged path.
- **Server**: no change. Each write is authorized and validated by the target
  server exactly as an edit from its own Settings would be.
- **Tests**: unit tests for the item model and bundle codec, and an Electron
  E2E through `npm run test:e2e` with two attached servers.
