## MODIFIED Requirements

### Requirement: Application menu per host

Browser hosts SHALL expose an in-page application menu for the shared workspace containing File, Edit, View, and Help menus with the same command vocabulary as the Desktop native menu wherever the browser has an equivalent capability. On a wide workspace that menu SHALL present as a menu bar band above the workspace. On a compact workspace at 640px and below it SHALL present as a menu bar across the top of the compact switcher, with the same menus as the wide band, so the same commands remain reachable without a band of its own and without a control on the compact chrome row. Native-only entries such as OS window management, Desktop update installation, native file dialogs, and DevTools SHALL remain absent or disabled unless the host capability exists. Desktop hosts SHALL advertise native menus and therefore omit the in-page application menu entirely, at every width. macOS native title-bar insets SHALL keep traffic lights separate from project tabs and workspace controls.

#### Scenario: Desktop omits the in-page menu

- **WHEN** a Desktop host renders the workspace
- **THEN** the in-page application menu bar is absent

#### Scenario: Native-only entries are hidden in the browser

- **WHEN** a browser host renders the application menu
- **THEN** OS window management, Desktop update installation, native file dialogs, and DevTools entries are absent or disabled

#### Scenario: Compact browser workspace collapses the band

- **WHEN** a browser host renders the workspace at 640px or narrower
- **THEN** no application menu band is rendered above the workspace and the compact chrome row has no menu control

#### Scenario: Compact menu keeps every command

- **WHEN** a browser user opens the compact switcher
- **THEN** its menu bar presents the File, Edit, View, and Help menus with the same commands and capability gating as the wide menu bar
