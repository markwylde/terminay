## ADDED Requirements

### Requirement: Dormant bots have greyscale avatars

While a bot is idle or stopped, every surface showing its avatar with its activity dot SHALL draw the avatar in greyscale: a Critter or picture desaturated, a Character tile in the grey of its colour's luminance. While the bot is working, queued, or needs you, the avatar SHALL be in colour. The activity dot SHALL keep its colour. Avatars without an activity dot SHALL be in colour.

#### Scenario: Idle bot in the sidebar roster

- **WHEN** a bot with a Critter avatar has no live, queued, or waiting session and its environment is running
- **THEN** its avatar in Home's sidebar roster is greyscale and its activity dot is green

#### Scenario: Bot starts working

- **WHEN** that bot starts a session
- **THEN** its avatar returns to colour and its activity dot turns amber

#### Scenario: Stopped Character bot

- **WHEN** a bot with a Character avatar on colour `#7cc4f5` has a stopped environment and no sessions
- **THEN** its tile is a neutral grey and its activity dot is grey

### Requirement: Critter avatars animate activity

While the device's **Animate bot avatars** setting is on, a Critter avatar shown with its activity dot SHALL animate as Chara's `working` state while the bot is working, `thinking` while queued, `sleeping` while stopped, and `idle` while idle or needing you. While the setting is off, or the system asks to reduce motion, it SHALL be still. Avatars without an activity dot SHALL be still. **Animate bot avatars** SHALL be an Accessibility setting, on by default, chosen per device.

#### Scenario: Working bot animates

- **WHEN** a bot with a Critter avatar is working
- **THEN** its avatar in Home's sidebar roster animates as Chara's `working` state

#### Scenario: Stopped bot sleeps

- **WHEN** a bot with a Critter avatar has a stopped environment and no sessions
- **THEN** its avatar is in Chara's `sleeping` state

#### Scenario: Animation turned off

- **WHEN** the user turns Accessibility › Animate bot avatars off on this device
- **THEN** every Critter avatar is still, and a dormant bot's avatar is still greyscale
