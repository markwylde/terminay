## ADDED Requirements

### Requirement: Server upgrade card header

The server upgrade card SHALL show its title on a single line, cut with an
ellipsis when too wide, offering its full text as a tooltip and keeping it as the
card's accessible name. Known versions (`<from> → <to>`) SHALL sit on their own
line beneath the title as secondary text, never cut: a long version SHALL wrap
within the card.

#### Scenario: Short server name

- **WHEN** the card follows an upgrade of a server with a short name from `5.1.1` to `5.2.0`
- **THEN** the title "Upgrading <name>" is shown in full on one line and `5.1.1 → 5.2.0` is shown on the line beneath it

#### Scenario: Long server name

- **WHEN** the card follows an upgrade of a server whose name is wider than the card
- **THEN** the title stays on one line ending in an ellipsis, its tooltip and the card's accessible name give the full title, and the versions are shown in full on the line beneath it

#### Scenario: Long server name after the outcome

- **WHEN** the upgrade of a server whose name is wider than the card ends in success or failure
- **THEN** "<name> is upgraded" or "<name> was not upgraded" stays on one line ending in an ellipsis, with the full title as its tooltip and accessible name

#### Scenario: Renamed connection

- **WHEN** the person renames an attached connection and then upgrades its server
- **THEN** the confirmation, the card and the outcome name the server by its new name, as the connection menu does

#### Scenario: Long version strings

- **WHEN** the card follows an upgrade whose versions are longer than the card is wide, such as an unbroken build identifier, on a phone-width window
- **THEN** both versions are shown in full beneath the title, wrapping onto further lines, and no text extends past the card's edge

#### Scenario: Versions unknown

- **WHEN** the card follows an upgrade whose source or target version is not known
- **THEN** the title is shown and no version line is drawn beneath it

### Requirement: Server upgrade card follows the appearance

The server upgrade card and its backdrop SHALL follow the light or dark
appearance in force. In both, the card's title, secondary text, every step
state (waiting, running, done, failed), a failure's detail and the Close
button SHALL be legible against the card's surface, and the Close button SHALL
show a visible focus indicator when focused from the keyboard.

#### Scenario: Light and dark appearance

- **WHEN** the card is shown with a light appearance and again with a dark appearance
- **THEN** the card's surface differs between the two, and in each the title, secondary text and the icon and text of each step state contrast with the surface

#### Scenario: Ended card in either appearance

- **WHEN** a failed upgrade's card is shown in either appearance and its Close button is focused from the keyboard
- **THEN** the failed step and its detail are legible against the surface and the button shows a focus indicator

### Requirement: Server upgrade confirmation title

The server-upgrade confirmation's window title — "Upgrade <name>" or, for
Install latest, "Install latest on <name>" — SHALL stay on one line and, when cut
with an ellipsis, offer its full text as a tooltip. Its body SHALL wrap a long
name or version inside the window.

#### Scenario: Long name in the confirmation

- **WHEN** the person asks to upgrade a server whose name is wider than the confirmation's title bar
- **THEN** the title "Upgrade <name>" stays on one line ending in an ellipsis, its tooltip gives the full title, and the name and versions in its body wrap inside the window

#### Scenario: Long name in the Install latest confirmation

- **WHEN** the person asks to install the latest build on a server whose name is wider than the confirmation's title bar
- **THEN** the title "Install latest on <name>" stays on one line ending in an ellipsis, and its tooltip gives the full title
