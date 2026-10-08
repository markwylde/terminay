## ADDED Requirements

### Requirement: About window

Desktop SHALL offer **About Terminay**, in the application menu on macOS and in
the Help menu on Windows and Linux. It SHALL open a Terminay About window, not
the native About panel. The window SHALL show the Terminay logo, name, and
running version, and a restrained abstract artwork in the loading-indicator
colours that stops moving when the system asks for reduced motion. It SHALL say
Terminay is made by Mark Wylde and is open source under the GNU AGPL, version 3.0
or later. It SHALL link to terminay.com, to the source repository at
github.com/markwylde/terminay, and to the licence. The window SHALL run no
script and have no preload. It SHALL open only those links, in the default
browser, and SHALL NOT navigate itself. Only one About window SHALL be open at a
time.

#### Scenario: Opening About

- **WHEN** the user chooses About Terminay
- **THEN** the Terminay About window opens showing the running version, the
  author, the AGPL licence, and links to terminay.com and the GitHub repository

#### Scenario: Following a link

- **WHEN** the user clicks the terminay.com, repository, or licence link
- **THEN** it opens in the default browser and the About window stays as it was

#### Scenario: Unexpected navigation

- **WHEN** the About window is asked to open or navigate to any other URL
- **THEN** nothing opens and the window does not navigate

#### Scenario: About already open

- **WHEN** the user chooses About Terminay while the About window is open
- **THEN** the open window is focused and no second window opens

#### Scenario: Reduced motion

- **WHEN** the system asks for reduced motion
- **THEN** the artwork is shown without movement

### Requirement: Browser About

A browser host's in-page Help menu SHALL offer **About Terminay**. It SHALL open
a dialog over the workspace showing the same About document as the Desktop
window, with the running version of the served UI. The document SHALL run no
script, SHALL open its links only in a new browser tab, and SHALL NOT navigate
the workspace page. Escape, the close control, or a click outside the dialog
SHALL close it.

#### Scenario: Opening About in a browser

- **WHEN** the user chooses Help, About Terminay in a browser
- **THEN** the About dialog opens showing the version, the author, the AGPL
  licence, and links to terminay.com and the GitHub repository, and Settings
  does not open

#### Scenario: Following a link in a browser

- **WHEN** the user clicks a link in the browser About dialog
- **THEN** it opens in a new tab and the workspace page stays as it was
