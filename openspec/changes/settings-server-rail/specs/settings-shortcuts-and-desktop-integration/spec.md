## ADDED Requirements

### Requirement: Settings places rail

Settings SHALL show a rail of places on its left edge. Its first tile SHALL be
this device, then a divider, then one tile per attached connection in the order
the workspace lists them, then a **Connect a server** tile. Exactly one place
SHALL be selected. Beside the rail, Settings SHALL show the selected place's
name, a subtitle, the search box, and that place's categories only.

#### Scenario: Rail contents

- **WHEN** a user opens Settings with the Local server and "Pop Terminay"
  attached
- **THEN** the rail shows This Mac, a divider, Local server, Pop Terminay, and
  Connect a server, with one of them selected

#### Scenario: Picking this device

- **WHEN** the user selects the This Mac tile
- **THEN** the column beside the rail is headed "This Mac" and lists only this
  device's categories

### Requirement: Rail in a narrow window

When Settings is too narrow to show the rail beside the category list, the rail
SHALL become one row of tiles above the category list.

#### Scenario: Narrow window

- **WHEN** Settings is narrowed below the width of the rail, the category list
  and a page
- **THEN** the rail is shown as one row of tiles above the category list

### Requirement: Rail tiles name their place

The device tile SHALL read **This Mac** on Terminay Desktop for macOS, **This
PC** on Terminay Desktop for Windows and Linux, and **This device** in a
browser. A server tile SHALL show the first letter of the server's name on a
colour derived from its server identity, the full name as its accessible name
and tooltip, and a mark that says whether the connection is online.

#### Scenario: Browser host

- **WHEN** Settings is opened in a browser
- **THEN** the first tile reads This device

#### Scenario: Offline server

- **WHEN** an attached connection is offline
- **THEN** its tile is still listed and its mark says it is offline

### Requirement: Connect a server tile

The **Connect a server** tile SHALL select this device's **Servers** category
and open its Add server form there.

#### Scenario: Connecting another server

- **WHEN** the user selects Connect a server
- **THEN** This Mac › Servers is shown with the Add server form open

### Requirement: Opening Settings chooses a place

When Settings is opened at a named category, it SHALL select the place that
has that category. For a server category, that is the server that owns the
active project tab, or else the first attached connection. A command that
names a category that only servers have SHALL open on a server even when no
project tab is active. When Settings is opened with no category named, it SHALL
show the place and category it last showed while that place is still attached.
Otherwise it SHALL show the server that owns the active project tab, or this
device when no project tab is active. When the place it would open on is a
server and the window's connections have not attached yet, Settings SHALL wait
for them, showing that it is connecting, and then open on that server; if none
attaches within ten seconds, it SHALL open on this device.

#### Scenario: Opening before the connections attach

- **WHEN** Settings opens at Extensions in a new window whose connections are
  still attaching
- **THEN** it shows that it is connecting, then opens at Local › Extensions
  once Local attaches

#### Scenario: Macros from Home

- **WHEN** the user presses `CmdOrCtrl+;` while Home is the active tab and
  "Pop Terminay" is the first attached connection
- **THEN** Settings opens at Pop Terminay › Macros

#### Scenario: Reopening Settings

- **WHEN** the user last left Settings at This Mac › Cursor and opens Settings
  again
- **THEN** Settings opens at This Mac › Cursor

#### Scenario: Reopening after the server detached

- **WHEN** the user last left Settings on a server that is no longer attached
  and opens Settings with no project tab active
- **THEN** Settings opens on this device

### Requirement: Deep links to a field open its place

A link that opens Settings at a field SHALL open the place and category that
list that field.

#### Scenario: Deep link to a moved field

- **WHEN** a link opens Settings at the tab indicators field
- **THEN** Settings opens at the active server's Interaction category with that
  field in view

### Requirement: Changing place keeps a matching category

When the user selects another place, Settings SHALL keep the shown category if
the new place has it, and otherwise show the new place's first category. Each
server SHALL remember its own selected item in each collection category for as
long as Settings is open. Responses that arrive for a place after the user has
left it SHALL be discarded. When the selected server detaches, Settings SHALL
select this device. When it goes offline, its tile SHALL stay selected and show
that connection's state, and every other tile SHALL stay usable.

#### Scenario: Category present in both places

- **WHEN** the user is on Pop Terminay › Scrolling and selects This Mac
- **THEN** This Mac › Scrolling is shown

#### Scenario: Category missing in the new place

- **WHEN** the user is on Pop Terminay › Macros and selects This Mac
- **THEN** This Mac's first category is shown

#### Scenario: Late response

- **WHEN** the user leaves a server before its macros have loaded
- **THEN** those macros are never shown under the place the user moved to

#### Scenario: Selected server detaches

- **WHEN** the selected server is detached while Settings is open
- **THEN** This Mac is selected and the server's tile is removed

#### Scenario: This device while a server is offline

- **WHEN** the active project's server is offline
- **THEN** the user can still select This Mac and change its settings

### Requirement: Settings are shown where they are saved

Each setting SHALL appear only under the place that stores it. A setting with
server authority SHALL appear only under a server. A connection-host setting or
device override SHALL appear only under this device. A category SHALL appear
under a place only when that place has fields, a collection, or a status page
for it on the current host, and it SHALL list only that place's fields. Tab
indicators SHALL be listed under a server's Interaction category, and the
sidebar defaults under this device's Appearance category.

#### Scenario: A category split between places

- **WHEN** the user opens Interaction under This Mac and then under a server
- **THEN** This Mac lists only device settings such as Option as Meta, and the
  server lists only server settings such as Tab indicators, with no field in
  both

#### Scenario: Sidebar defaults

- **WHEN** the user opens Appearance under This Mac
- **THEN** the sidebar defaults are listed there, and no server lists them

#### Scenario: Device override

- **WHEN** the user opens AI under This Mac
- **THEN** the dictation microphone is listed, and the server's AI page does
  not list it

### Requirement: Categories of each place

Under this device, Settings SHALL list Appearance, Theme, Shortcuts,
Accessibility and AI under General; Cursor, Interaction and Scrolling under
Terminal; Servers under Connections; and Updates and Diagnostics under System.
On Terminay Desktop it SHALL also list Import & Export under Connections. Under
a server, Settings SHALL list Files and AI under General; Shell, Interaction and
Scrolling under Terminal; Remote Access under Connections; Macros, Workflows
and Recording under Automation; Extensions under Extensions; and Updates under
System. Group labels SHALL keep the order General, Terminal, Connections,
Automation, Extensions, System, and an empty group SHALL be omitted. A category
not available on the current host or server SHALL be omitted.

#### Scenario: This Mac on Desktop

- **WHEN** a Desktop user selects This Mac
- **THEN** Connections lists Servers and Import & Export, and System lists
  Updates and Diagnostics

#### Scenario: This device in a browser

- **WHEN** a browser user selects This device
- **THEN** Connections lists Servers only, and no System group is shown

#### Scenario: Server in a browser

- **WHEN** a browser user selects a server
- **THEN** its Updates category is listed

### Requirement: Every page states its scope

Every category page SHALL state in one line where its contents are saved and
who they reach. A page of this device SHALL read "On this Mac · whichever
server is connected", with the device tile's own name on other hosts. Servers
SHALL instead read "On this Mac · the servers this Mac connects to". Import &
Export SHALL read "Across every attached server · each through its own
connection". A page of a server SHALL read "On <server name> · every device
connected to it".

#### Scenario: Server scope line

- **WHEN** the user opens Scrolling under "Pop Terminay"
- **THEN** the page states "On Pop Terminay · every device connected to it"

#### Scenario: Import & Export scope line

- **WHEN** the user opens Import & Export under This Mac
- **THEN** the page states "Across every attached server · each through its own
  connection"

### Requirement: Edits and resets stay in their place

A change made under this device SHALL be written only to this device's
settings store and SHALL send no settings operation to any server. A change
made under a server SHALL be committed only on that server and SHALL leave this
device's settings unchanged. Reset to defaults SHALL reset only the selected
place's settings.

#### Scenario: Device edit while the server is offline

- **WHEN** the user changes the cursor style under This Mac while the active
  server is offline
- **THEN** the change is saved on this device and no server operation is sent

#### Scenario: Reset this device

- **WHEN** the user resets to defaults under This Mac
- **THEN** this device's settings return to their defaults and every server's
  settings are unchanged

#### Scenario: Reset a server

- **WHEN** the user resets to defaults under "Pop Terminay"
- **THEN** Pop Terminay's settings return to their defaults and this device's
  settings are unchanged

### Requirement: Settings search covers the selected place

The Settings search SHALL search the selected place only, including that
place's collection items, and its results SHALL open under that place.
Changing place SHALL keep the search text and SHALL search the new place.

#### Scenario: A setting with one place

- **WHEN** the user searches the This Mac place for "Tab indicators"
- **THEN** no result is shown, because tab indicators are saved on the server

#### Scenario: Searching saved servers

- **WHEN** the user searches "pop" under This Mac
- **THEN** the saved server Pop Terminay appears under Servers

#### Scenario: Switching place during a search

- **WHEN** the user switches from a server to This Mac with "cursor" in the
  search box
- **THEN** the search box still reads "cursor" and the results are This Mac's

### Requirement: This device's Updates page names what it updates

On Terminay Desktop, the Updates page of this device SHALL hold the update
channel and the versions it runs and can reach. It SHALL say that the channel updates
Terminay Desktop and the Local server built into it and no other server.

#### Scenario: Desktop Updates page

- **WHEN** the user opens Updates under This Mac
- **THEN** the page shows the update channel and says it updates Terminay
  Desktop and its Local server, not other servers

### Requirement: This device's Updates page shows exact versions

This device's Updates page SHALL show **Running**, the exact Terminay Desktop
version installed, and **Latest on <track>**, the exact newest release the
last check found on the selected channel, with the time of that check. When the
last check found nothing newer, Latest SHALL show the running version marked
"Up to date". Before any check has completed, Latest SHALL read "Not checked
yet". After a failed check, Latest SHALL say the check failed. A development
build SHALL say it has no release version. Version strings SHALL be shown in
full.

#### Scenario: Update available

- **WHEN** Terminay Desktop runs `6.9.0-main.3340.canary` and the last check
  on Canary found `6.9.0-main.3347.canary`
- **THEN** the page shows Running `6.9.0-main.3340.canary` and Latest on Canary
  `6.9.0-main.3347.canary`

#### Scenario: Up to date

- **WHEN** the last check found nothing newer than the running version
- **THEN** Latest shows the running version marked Up to date, with the time of
  the check

#### Scenario: Not yet checked

- **WHEN** no update check has completed since Terminay Desktop started
- **THEN** Latest reads Not checked yet and shows no version

#### Scenario: Failed check

- **WHEN** the last update check failed
- **THEN** Latest says the check failed and shows no version

### Requirement: A server's Updates page shows its track and exact versions

The Updates page of a server SHALL show the release track it follows as
Stable, Nightly, Canary or Source. It SHALL show **Running**, the exact
version the server reports, and **Latest on <track>**. Latest SHALL be the
exact newer release the server reports on its track, with the existing Upgrade
action. When the server reports nothing newer, Latest SHALL show the running
version marked "Up to date". A Source install SHALL say it has no published
latest version. A server without the server upgrade capability SHALL say that
it does not report a release track.

#### Scenario: Newer release on the track

- **WHEN** the server runs `6.9.0-main.3340.canary`, reports
  `6.9.0-main.3347.canary` available on Canary, and can upgrade itself
- **THEN** the page shows track Canary, Running `6.9.0-main.3340.canary`,
  Latest on Canary `6.9.0-main.3347.canary`, and the Upgrade action

#### Scenario: Server up to date

- **WHEN** the server reports channel `canary`, version
  `6.9.0-main.3347.canary`, and no newer release
- **THEN** the page shows Running and Latest on Canary as
  `6.9.0-main.3347.canary`, marked Up to date

#### Scenario: No upgrade status

- **WHEN** the server does not advertise the server upgrade capability
- **THEN** the page says the server does not report a release track and shows
  no track commands

### Requirement: Changing a server's track is shown as a command

A server's Updates page SHALL list, for each other published track, the
command an operator runs on the server host to move to it: `terminay daemon
upgrade latest` for Stable, `terminay daemon upgrade main` for Nightly, and
`terminay daemon upgrade canary` for Canary. Each command SHALL be ready to
copy. The page SHALL say that a system install runs the command with `sudo`.
It SHALL say that a host with both a system and a user install adds `--system`
or `--user`. It SHALL say that a move to an older release adds
`--allow-downgrade`. It SHALL say that a container changes track by its image
tag instead. Settings SHALL NOT change a server's track itself.

#### Scenario: Remote server on Canary

- **WHEN** the user opens Updates under a server that reports channel `canary`
- **THEN** copyable commands for Stable and Nightly are listed with the
  `sudo`, scope, downgrade and container notes, and none for Canary

### Requirement: The Local server's Updates page follows Desktop

The Local server SHALL be identified by the host's trusted connection profile,
not by a missing release channel. Its Updates page SHALL show the exact version
it runs, say that it follows Terminay Desktop's update channel, and link to
this device's Updates page. It SHALL list no track commands. A remote server
that reports no channel SHALL NOT be treated as the Local server.

#### Scenario: Local server

- **WHEN** the user opens Updates under the Local server
- **THEN** the page shows its running version, says it follows Terminay
  Desktop, and links to This Mac › Updates

#### Scenario: Remote server run from a checkout

- **WHEN** a remote server's upgrade status has no channel
- **THEN** its Updates page does not link to This Mac › Updates and does not
  say it follows Terminay Desktop

## MODIFIED Requirements

### Requirement: Settings and Extensions surfaces select a server

The Settings places rail SHALL list every attached connection. Every category
shown under a server SHALL present the data of exactly that server: settings,
secrets, the extension inventory, macros, and the server's exposure under
Remote Access. Values from two servers SHALL NEVER be merged, summed, or shown
as one list, and a change SHALL be committed only on the selected server.
Selecting a connection that is unavailable or incompatible SHALL show that
connection's state instead of its categories. The saved servers belong to this
device and SHALL be listed under this device's Servers category. Import &
Export belongs to this device, not to a server. It SHALL show every attached
server in its own column, read each column through that server's own
connection, commit each write through that server's own connection, and merge
no value across columns. Leaving a place with pending macro edits SHALL first
ask to save, discard, or keep editing.

#### Scenario: Default selection

- **WHEN** the user opens Settings while a project of an attached server is active
- **THEN** that server's tile is selected and its settings are shown

#### Scenario: Switching servers

- **WHEN** the user selects another attached connection's tile
- **THEN** the surface shows only that server's settings, extensions, macros, and exposure, and no value from the previous server remains visible

#### Scenario: Editing applies to one server

- **WHEN** the user changes a setting while a server is selected
- **THEN** the change is committed on that server alone and no other attached server's settings change

#### Scenario: Selected connection is unavailable

- **WHEN** the selected connection is offline or incompatible
- **THEN** the surface reports that connection's state and sends it no settings operation

#### Scenario: Import & Export spans servers

- **WHEN** the user opens This Mac › Import & Export with three servers attached
- **THEN** it shows a column for each of the three servers, each read through its own connection

#### Scenario: Leaving a server with pending macro edits

- **WHEN** the user has unsaved macro edits and selects another tile
- **THEN** Settings asks to save, discard, or keep editing before switching

### Requirement: Settings list column

Settings SHALL present a category whose content is a collection as three
columns: the category list, a list column of that category's items, and a
detail pane for the selected item. The collection categories SHALL be
**Servers** under this device (the saved servers), and **Macros** and
**Extensions** under a server. Every other category SHALL present as two
columns, the category list and its page, with no list column. The list column
SHALL carry the category name and the category's add action in its header.
Within the column, items SHALL be grouped under section labels where the
category defines them. Each item row SHALL show the item's name and one line of
status. Opening a collection category SHALL select its first item, or the item
it was opened at. Settings SHALL remember the selected item of each collection
category, per place, for as long as Settings stays open.

#### Scenario: Opening Servers

- **WHEN** a user selects Servers under This Mac
- **THEN** a list column shows the saved servers with Add server… in its
  header, and the detail pane shows the first one

#### Scenario: A category without a list

- **WHEN** a user selects Remote Access under a server
- **THEN** Settings shows the category list and that server's exposure page
  with no list column

#### Scenario: Returning to a collection

- **WHEN** a user selects a saved server, opens Appearance, and returns to Servers
- **THEN** the same saved server is selected

### Requirement: Desktop diagnostics category

Desktop Settings SHALL expose a **Diagnostics** category under this device
whose Performance logging toggle is a device-local Desktop preference, off by
default, and writes only to the local Diagnostics folder. No server SHALL list
a Diagnostics category, and browser hosts SHALL omit it.

#### Scenario: Desktop diagnostics toggle

- **WHEN** a user enables Performance logging under This Mac › Diagnostics
- **THEN** the device-local preference is set and output is written only to the local Diagnostics folder

#### Scenario: Server place

- **WHEN** a user selects a server in Settings
- **THEN** no Diagnostics category is listed

#### Scenario: Browser host

- **WHEN** Settings is opened in a browser host
- **THEN** the Diagnostics category is not present
