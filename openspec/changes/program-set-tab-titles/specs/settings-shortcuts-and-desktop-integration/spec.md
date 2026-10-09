## ADDED Requirements

### Requirement: Program-set tab titles setting

Settings SHALL offer a **Let programs set tab titles** toggle among the terminal settings. It SHALL be a server setting and SHALL default to on. While it is off, the server SHALL ignore program title sequences and SHALL hold no program title for any terminal, so each terminal shows its named title or its default name. Turning it off SHALL take effect on open terminals without a restart.

#### Scenario: Default

- **WHEN** a server has no stored value for the setting
- **THEN** programs set tab titles

#### Scenario: Turned off with a program title showing

- **WHEN** a user turns the setting off while a tab shows a program title
- **THEN** that tab shows its default name

#### Scenario: Program writes a title while off

- **WHEN** a program writes a title sequence while the setting is off
- **THEN** the tab's title is unchanged and the sequence is not drawn as text

#### Scenario: Named titles while off

- **WHEN** the setting is off and a user renames a tab
- **THEN** the tab shows that name

#### Scenario: Server scope

- **WHEN** a user turns the setting off on one device
- **THEN** every device connected to that server sees program titles stop
