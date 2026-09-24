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
