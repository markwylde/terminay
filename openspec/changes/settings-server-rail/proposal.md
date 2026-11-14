## Why

Settings shows one list of categories, but the settings in it are saved in two
different places. Some live on the server and follow every device connected to
it, and some live on the device you are using. Nothing tells you which is which.
Changing the update channel looks as if it changes the connected server's
release track, but it only changes Terminay Desktop on this Mac. Turning off tab
indicators looks like a personal preference, but it changes every device
connected to that server. When more than one server is attached, a small
selector at the top picks which server's half of the list you are editing, and
the device half stays the same whichever server you pick.

Underneath, every setting already has exactly one authority (`server` or
`connection-host`, see `SETTING_AUTHORITY`). The window just doesn't show it.

## What Changes

- Settings is organised by *where a setting is saved*. A narrow rail on the left
  shows one tile for this device ("This Mac" on Terminay Desktop, "This device"
  in a browser), a divider, one tile per attached server, and a **Connect a
  server** tile.
- Picking a tile shows that place's name, a subtitle, a search box, and only the
  categories that have settings saved there. The existing group headers, icons
  and collection counts are kept.
- Every pane carries a scope line: *On this Mac · whichever server is connected*,
  or *On <server> · every device connected to it*.
- Categories that hold both kinds of setting (Appearance, Interaction,
  Scrolling, Files, AI) are split by authority. Each field appears only under
  the place that stores it. Tab indicators are listed under the server's
  Interaction page, the sidebar default under This Mac › Appearance, and the
  dictation microphone under This Mac › AI.
- Things that are not tied to one server move to This Mac. The saved servers
  become a **Servers** category, and **Import & Export** (which spans every
  attached server) moves there too. A server's **Remote Access** shows only that
  server's exposure.
- Edits and Reset act only on the selected place. A device change never
  contacts a server, and a server reset leaves this device alone.
- Opening Settings at a category (Macros, Remote Access, a deep link) picks the
  place that has it. Plain Settings reopens where it was left.
- The rail replaces the server selector `<select>`. It defaults to the server
  that owns the active project tab. The pending-macro-edit guard moves with it.
- **This Mac › Updates** keeps the Desktop update channel. Its label states that
  it updates Terminay Desktop and the Local server built into it.
- Both Updates pages show two exact version strings: **Running** and **Latest
  on <track>**. They show Up to date, Not checked yet, or a failed check when
  there is no newer release to name. This applies to This Mac and to every
  server, including the Local server.
- A server's **Updates** page shows the server's release track (Stable, Nightly
  or Canary) and the existing Upgrade action. It also
  shows the exact CLI command that moves the server to another track. The Local
  server's page says that it follows Terminay Desktop. It is recognised by its
  trusted host profile, not by a missing channel.
- Search finds settings in the selected place only.
- No setting changes where it is stored. This is a presentation change.

Non-goals: switching a remote server's release track from the app (this needs
the root-owned upgrade helper to accept a track, so it is left to a follow-up
change), and listing saved servers that are not attached.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: Remote Access in Settings is split into the
  server's exposure page and This Mac's Servers collection.

- `settings-shortcuts-and-desktop-integration`: Settings and Extensions select a
  server through a place rail rather than a selector, with This Mac/This device
  as a place of its own. Each setting is shown only under the place whose
  authority stores it. Desktop diagnostics sits under This Mac. A server's
  Updates page shows that server's track and the command to change it.

## Impact

- Renderer only. Mostly `src/components/SettingsWindow.tsx`,
  `src/components/settings/settingsCategoryGroups.ts`, `src/terminalSettings.ts`
  (field-to-place mapping), `src/web/ConnectedWebRendererWorkspace.tsx` (rail in
  place of `renderServerSelector`), `src/shared/ServerSelector.tsx`,
  `src/hooks/useTerminalSettings.ts` (place-scoped update and reset), and the
  Remote Access / saved-servers category modules.
- Reads the existing `ServerUpgradeStatus` (`version`, `channel`, `available`,
  `upgrade`) and `AppUpdateStatus` (`currentVersion`, `latestVersion`,
  `checkedAt`) for the Updates pages. No protocol, server, Electron or storage changes.
- E2E specs that open Settings and pick a category by its sidebar label need
  updating where the category now lives under a different place.
