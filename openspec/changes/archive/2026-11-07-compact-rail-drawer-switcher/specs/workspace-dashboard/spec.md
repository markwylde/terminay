## MODIFIED Requirements

### Requirement: Home tabs on a compact workspace

On a compact workspace, where no panel tab strip is drawn, Home SHALL show only the Home tab in front, filling the content area whatever arrangement the device remembers. The switcher's Home panel, reached from the Home item of its rail, SHALL be the way to open a section, and a tab opened from within a section SHALL come to the front. Each Home tab that is not a section SHALL offer a control that closes it and returns to the tab that opened it, so that no tab is reachable only through a tab strip.

#### Scenario: Compact Home shows one tab

- **WHEN** a device that remembers two Home tabs side by side shows Home on a compact workspace
- **THEN** only the tab in front is shown, filling the content area

#### Scenario: Opening a section from the drawer

- **WHEN** a user on a compact workspace opens the switcher, selects Home in the rail, and chooses Automations
- **THEN** Home is selected with the Automations tab in front and the switcher is dismissed

#### Scenario: Leaving an automation's tab without a tab strip

- **WHEN** a user on a compact workspace opens an automation from the Automations tab and then activates that tab's close control
- **THEN** the automation's tab closes and the Automations tab is in front
