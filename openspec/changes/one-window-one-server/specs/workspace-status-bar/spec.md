## MODIFIED Requirements

### Requirement: Remote access indicator

The right side of the status bar SHALL show the remote access state of the window's server. It SHALL show a status dot that is red when the server is the Desktop Local server and it is not exposed, grey when there are no active remote connections, and blue when at least one remote connection is active. A server that is not the Desktop Local server SHALL never show the red state. While connections are active it SHALL also show one device icon per connection, up to a small fixed maximum, and a count label such as `2 devices`. With no connections, the Desktop Local server's indicator SHALL show the dot alone with no text label, and any other server's indicator SHALL show a short `No devices` label. It SHALL NOT repeat the server name, which the header connections control already shows. Activating the indicator SHALL open the connection menu, and it SHALL carry an accessible name and tooltip that state the exposure state and the connection count.

#### Scenario: Local server not exposed

- **WHEN** the window's server is the Desktop Local server and it is not exposed
- **THEN** the dot is red, no device icons are shown, and no text label is shown

#### Scenario: Exposed with no connections

- **WHEN** the window's server is exposed and has no active remote connections
- **THEN** the dot is grey and no device icons are shown

#### Scenario: Devices connected

- **WHEN** two remote devices are connected to the window's server
- **THEN** the dot is blue and the indicator shows two device icons and `2 devices`

#### Scenario: Indicator opens the connection menu

- **WHEN** the user activates the remote access indicator
- **THEN** the connection menu opens
