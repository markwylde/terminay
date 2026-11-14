## Context

Settings (`src/components/SettingsWindow.tsx`) draws one sidebar from
`terminalSettingsCategories` grouped by `SETTINGS_CATEGORY_GROUPS`. Fields carry
a `categoryId` and `sectionId` in `src/terminalSettings.ts`. A server selector
(`src/shared/ServerSelector.tsx`, passed in as `renderServerSelector` by
`src/web/ConnectedWebRendererWorkspace.tsx`) chooses whose server settings the
window edits. It is hidden when fewer than two connections are attached.

Every top-level setting already has one authority. On the server it is
`SETTING_AUTHORITY` in `packages/server-core/src/settings/classification.ts`. In
the renderer it is `SERVER_OWNED_TERMINAL_SETTING_KEYS` plus the device override
`dictation.microphoneDeviceId`, which `selectDeviceTerminalSettings` uses to
split device settings into the connection-host store. The window ignores this
split, so five categories mix both kinds:

| Category | Device fields | Server fields |
| --- | --- | --- |
| Appearance | typography, rendering, host stats | tab indicators |
| Files | sidebar defaults | file viewer |
| Interaction | Option as Meta, Alt-click, clipboard writes | stdin, EOL, paste, selection |
| Scrolling | fast scroll sensitivity | scrollback, scroll feel |
| AI | dictation microphone | providers, agents, dictation, MCP |

Desktop's update channel (`updateChannel`) is handled in `electron/main.ts`. It
updates Terminay Desktop and the Local server built into it, and nothing else.
Remote servers publish `ServerUpgradeStatus` (`version`, `channel`,
`available`, `canUpgrade`, `upgrade`). Under ADR-0062, a client may only ask a
server to upgrade within its own channel.

The approved prototype is concept C (place rail).

## Goals / Non-Goals

**Goals:**

- Every setting appears once, under the place that stores it, and every page
  says that place in words.
- One window covers this device and every attached server, with no hidden
  selector.
- A server's Updates page tells the truth about that server's track.

**Non-Goals:**

- Changing any setting's authority or storage.
- Switching a remote server's track from the app (needs the root-owned
  upgrade helper to accept a track; follow-up change).
- Listing saved servers that are not attached.
- Changing the protocol, the server, or Electron.

## Decisions

### 1. A setting's place is derived from its authority, not hand-listed

*Boundary: renderer settings model ↔ server settings classification.*

A new pure module, `src/components/settings/settingsPlaces.ts`, exports
`placeOfSettingKey(key): 'device' | 'server'`. It reads the top-level key
against `SERVER_OWNED_TERMINAL_SETTING_KEYS`, and treats
`dictation.microphoneDeviceId` as `device`. Categories and fields for a place
are filtered from the existing definitions. Categories that are not field lists
are placed by what they manage. Remote Access (exposure), Macros, Workflows,
Recording, Extensions, Shell and server Updates go to a server. Theme,
Shortcuts, Servers (saved servers, host-owned), Import & Export, device Updates
and Diagnostics go to the device. Host availability then filters the device
list: Import & Export, device Updates and Diagnostics are Desktop only.

Import & Export goes to the device because it spans every attached server
(ADR-0111) and is Desktop only. Listing it under one server would misstate
its reach. The saved servers go to the device because the host stores them
(ADR-0075 rule 4). Remote Access then holds only the server's exposure, so it
becomes a plain page, and Servers becomes the collection.

A unit test asserts that, for every top-level key of `TerminalSettings`,
`SERVER_OWNED_TERMINAL_SETTING_KEYS` membership matches `SETTING_AUTHORITY`
(`server` ↔ member, `connection-host` ↔ not a member). Keys that
`SETTING_AUTHORITY` holds outside `TerminalSettings` (`macros`,
`shellProfiles`, `homeDashboard`) are left out of the comparison. The test also
checks that `DEVICE_OVERRIDE_PATHS` places on the device. The renderer's key set
is still a second list, but the test fails as soon as it drifts.

*Alternative:* a hand-written list of categories per place, as in the
prototype. Rejected because a new setting would land wherever the list said,
not where it is stored.

### 2. Two fields move category for presentation

*Boundary: none crossed; presentation only.*

Tab indicators (`activityIndicators.*`) are listed under a server's
Interaction, and sidebar defaults (`sidebar.*`) under the device's Appearance.
Without the move, the server would get an Appearance page with one section and
the device a Files page with one section. The move is a
section-to-category map (`placementCategoryId`, in `settingsPlaces.ts`), read
only by the place filter. `categoryId` stays as it is for search indexing, and deep links
are resolved through the same override.

### 3. The rail is a place selector; the device is a place

*Boundary: workspace connections (window-scoped, ADR-0048) ↔ Settings.*

`SettingsWindow` gains a `places` prop: `{ id, kind: 'device' | 'server',
name, subtitle, online, colorSeed }[]` and `selectedPlaceId` /
`onSelectPlace(id)`. `ConnectedWebRendererWorkspace` builds it from the
window's attached connections, as `renderServerSelector` does today, and keeps
`useSelectedServerConnection()` as the source of truth for the selected server.
Selecting the device place does not change the selected server connection.
Device pages read the connection-host store directly
(`readConnectionHostSettings` / the Desktop device-settings bridge), not through
the active connection's merged settings client. The existing
`beforeSelect`/`confirmLeave` guard wraps every tile change.
`ServerSelector.tsx` is deleted once nothing imports it.

The **Connect a server** tile selects This device › Servers and opens its Add
server form.

### 3a. Writes and reset are scoped to the place

*Boundary: renderer ↔ connection-host store; renderer ↔ server `SettingsClient`.*

Today `useTerminalSettings().update` splits one merged object and writes both
stores. Its `reset` resets both. Settings gains two place-scoped operations:
`updateDevice(patch)` writes only the device store, and `updateServer(patch)`
calls only the selected connection's `SettingsClient` with server keys.
`resetPlace(place)` resets only that place's keys. The old merged `update`
stays for callers outside Settings. Tests check that a device edit sends no
server operation, works while the server is offline, and that each reset leaves
the other place untouched.

### 3b. Opening, place memory and lifecycle

*Boundary: semantic routes/commands ↔ Settings window state.*

A route that names a category resolves its place with
`placeForCategory(categoryId, activeServerId, attached)`: device categories go
to the device, and server-only categories go to the active tab's server or else
the first attached connection. A route that names no category reuses the last
`{placeId, categoryId}` while that place is attached. Field deep links resolve
through `placementCategoryId`. On a place change, the current category is kept
if the new place has it, and otherwise the place's first category is shown.
Collection selection is keyed by `placeId + categoryId`. Every async load
carries the placeId it was issued for, and a result is dropped if the selected
place has changed. Detaching the selected server selects the device.

The device tile is named from the host: `This Mac` when
`navigator.platform`/the Desktop bridge reports macOS, `This PC` on Desktop for
Windows and Linux, and `This device` in a browser.

*Alternative:* a two-tab "This Mac | Server" switch with a server dropdown
(concept A). Rejected by the user in favour of the rail.

### 4. Server Updates reads the existing status; track changes are a command

*Boundary: client ↔ server upgrade protocol (ADR-0062).*

The page renders from the selected connection's `ServerUpgradeStatus` through
the hook the header and connection menu already use. Channel labels are `tag`
→ Stable, `main` → Nightly, `canary` → Canary, `source` → Source. The Upgrade
action reuses `ServerUpgradeDialog`. For each other track, the page shows
`terminay daemon upgrade <latest|main|canary>` with a copy button, and a note
that a system install runs it with `sudo` on the server host. The client does not know the install scope. The CLI picks the existing
install when no `--system`/`--user` flag is given, and refuses only when both
exist, so the page adds that note. It also notes `--allow-downgrade`, because
`daemon upgrade` refuses an older target and a move from a prerelease to Stable
is usually older. A container changes track by image tag, so the page says so.
A test checks the listed refs against `resolveRef` (`latest`, `main`,
`canary`) so the text cannot drift from the CLI. The Local server is identified with `isLocalConnection` (trusted
host profile metadata), never by a missing `channel`. It shows its version, a line, and a link to the
device's Updates page. A remote server without `channel` (a checkout) gets the
Source wording and no link. No protocol field is added, because
`parseServerUpgradeStatus` is strict and a new field would break older
clients.

*Alternative:* a track picker that sends a request to the server. Rejected for
now: ADR-0062 limits a client request to a mode, and the system helper starts a
fixed command line. That needs its own change and ADR.

### 4a. Both Updates pages show Running and Latest as exact versions

*Boundary: Desktop main process (updater) ↔ renderer; client ↔ server upgrade
status.*

Desktop reads `AppUpdateStatus`, which already carries `currentVersion`,
`latestVersion`, `checkedAt`, `state`, `channel` and `errorMessage`. The
updater sets `latestVersion` only when something newer exists. So the page
shows `currentVersion` as Latest, marked Up to date, when a check has completed
(`checkedAt` set) with no error and no `latestVersion`. It shows Not checked
yet when `checkedAt` is null, and the error when the last check failed. Version
`0.0.0` is a development build and says so.

A server reads `ServerUpgradeStatus.version` as Running and `available.version`
as Latest. With no `available`, Latest is the running version marked Up to
date. The page does not show a check time for a server, because the status
carries none and the protocol is not widened (decision 4). Versions are shown
verbatim in a monospace face with a copy affordance, never shortened, so two
canary builds can be told apart by their build number.

### 5. Search is per place

The search index is built from the selected place's fields and collections.
Macros and extensions are searched under a server, and saved servers under the
device.

### 6. Narrow layout

At widths where the existing layout drops to one column, the rail becomes a
horizontal row of tiles above the category list, so the single-column
back-navigation of `unified-settings-window` is unchanged.

## Risks / Trade-offs

- [The device place shows values that apply under every server, but the window
  reads them through the active connection's settings hook] → device values
  come from the connection-host store, which is the same for every connection.
  A test switches the selected server and checks the device pages are
  unchanged.
- [E2E specs open categories by sidebar label and may now need to pick a place
  first] → add a `openSettingsAt(place, category)` helper in `e2e/fixtures.ts`
  and move the specs onto it.
- [`unified-settings-window` and `server-import-export` are not archived. Both
  modify "select a server", and `unified-settings-window` adds "Settings list
  column" and "Remote Access in Settings", which this change modifies] → the
  deltas here are written against those versions. Archive both first. Task 0.1
  checks the archive folders.
- [Remote Access loses its list column, and saved servers move to This Mac ›
  Servers, so people used to the old layout look in the wrong place] →
  Connect a server and every Add server entry point land on Servers. The Remote
  Access command still opens the server's exposure.
- [Users who learnt the old category positions look for tab indicators under
  Appearance] → search still finds them when a server is selected, and the
  rail opens on the server by default.

- [A server's status has no check time, so "Up to date" can reflect a check
  up to an hour old (the server checks hourly while attached)] → accepted for
  now. Exposing the check time needs a protocol field that older clients would
  reject, so it belongs to the follow-up that adds track switching.

## Migration Plan

Presentation only. No stored data moves. Rolling back is a revert.

## Open Questions

- ADR-0075 rule 4 names "the Settings server selector". The rail keeps the rule's
  substance (explicit scoping, no merging) but makes the device a place of its
  own. The adr step records a superseding ADR for that rule.
