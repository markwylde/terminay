## ADDED Requirements

### Requirement: Program clipboard write setting

Settings SHALL offer a **Programs can copy to the clipboard** toggle among the terminal selection settings. It SHALL be a connection-host setting and SHALL default to on. While it is off, a terminal on that device SHALL ignore OSC 52 clipboard writes and SHALL still never draw them as text. Turning it off SHALL take effect on open terminals without a restart.

#### Scenario: Default

- **WHEN** a device has no stored value for the setting
- **THEN** programs in its terminals can copy to its clipboard

#### Scenario: Turned off

- **WHEN** a user turns the setting off and a program then writes an OSC 52 clipboard request
- **THEN** that device's clipboard is unchanged and the sequence is not drawn as text

#### Scenario: Device scope

- **WHEN** a user turns the setting off on one device
- **THEN** another device showing the same terminal still receives the program's copies
