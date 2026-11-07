## MODIFIED Requirements

### Requirement: Compact switcher overlays rather than compresses

The unified switcher SHALL be a drawer that slides in from the leading edge below the device's top safe area, SHALL overlay the workspace rather than reduce the height or width given to the terminal, and SHALL leave a strip of the workspace visible at the trailing edge. It SHALL be dismissible by pressing that strip, by the platform's dismiss key, or by choosing anything that changes what is on screen, and SHALL return focus to the control that opened it. While it is open the workspace beneath SHALL keep its layout so dismissing it requires no terminal relayout. Selecting rail items, toggling edit mode, opening menus, and opening the launcher dropup SHALL NOT replay the drawer's entrance. Where the device asks for reduced motion, the drawer SHALL appear and disappear without sliding.

#### Scenario: Opening the switcher does not resize the terminal

- **WHEN** the switcher opens over a compact workspace
- **THEN** the terminal beneath keeps its geometry and the drawer overlays it

#### Scenario: Dismissing returns focus

- **WHEN** the switcher is dismissed by pressing the visible strip of the workspace or by the dismiss key
- **THEN** focus returns to the control that opened it

#### Scenario: Switching rail items does not replay the entrance

- **WHEN** the drawer is open and a user selects another project in the rail
- **THEN** the panel changes and the drawer stays where it is without sliding in again
