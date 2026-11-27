## ADDED Requirements

### Requirement: Home sidebar bot avatars are 36 pixels square

Each bot row in the Home sidebar's Bots roster SHALL render the bot's avatar at 36×36 CSS pixels, with row height sufficient to contain the avatar and its activity dot without clipping or overlapping neighbouring rows. A bot's tab icon in Home's tab strip SHALL stay sized for the tab strip.

#### Scenario: Sidebar roster displays 36px bot avatars

- **WHEN** the Home sidebar lists one or more bots on a wide workspace
- **THEN** each bot row's avatar renders at 36×36 CSS pixels inside a row tall enough to keep the avatar and activity dot clear of neighbouring rows
