## ADDED Requirements

### Requirement: Auxiliary windows appear before they connect

Terminay Desktop SHALL show a native auxiliary window (Settings and Performance Log) as soon as it is requested, with the Terminay loading animation, before it starts that window's own connection to its server, and SHALL replace the animation with the window's page once the connection is ready. Closing the window while it connects SHALL cancel the connection attempt.

#### Scenario: Settings on a remote server

- **WHEN** a user opens Settings from a Desktop window on a remote server
- **THEN** the Settings window appears at once showing the loading animation
- **AND** the Settings page replaces the animation once its connection is ready

#### Scenario: Closed while connecting

- **WHEN** a user closes the Settings window while it is still connecting
- **THEN** its connection attempt stops and does not delay another window connecting to that server

### Requirement: A connecting auxiliary window takes later requests and recovers in place

Requesting a native auxiliary window again while it connects SHALL focus it, SHALL NOT open another, and the most recent request SHALL decide the page it opens on. A connection that fails SHALL show the launch recovery screen with Retry in that window, and Retry SHALL connect again for that window and page.

#### Scenario: Requested again while connecting

- **WHEN** a user opens Settings and then invokes **Extensions…** while the Settings window is still connecting
- **THEN** the existing Settings window is focused, no second window opens, and it opens at the Extensions section

#### Scenario: Connection fails

- **WHEN** the Settings window cannot connect to its server
- **THEN** the Settings window shows the launch recovery screen with Retry
- **AND** the project window it was opened from stays connected

#### Scenario: Retry after a failure

- **WHEN** the user presses Retry in that recovery screen
- **THEN** the window connects again and opens on the page last requested
