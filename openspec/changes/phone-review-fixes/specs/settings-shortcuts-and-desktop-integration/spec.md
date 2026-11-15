## ADDED Requirements

### Requirement: Command Bar close control

The Command Bar SHALL show, at the end of its search field, a close control drawn as the Escape key cap. It SHALL be a button with the accessible name **Close command bar**, reachable by pointer, touch, and keyboard, at every width. Activating it SHALL close the Command Bar exactly as the Escape key does, running nothing and leaving the view as it was.

#### Scenario: Closing by touch

- **WHEN** a phone user opens the Command Bar, types a search, and taps the Escape key cap
- **THEN** the Command Bar closes, nothing runs, and the panel that was on screen is still on screen

#### Scenario: Accessible name

- **WHEN** assistive technology reads the Command Bar's search row
- **THEN** it finds a button named Close command bar
