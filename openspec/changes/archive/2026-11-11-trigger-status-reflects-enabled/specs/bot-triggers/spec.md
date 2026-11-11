## ADDED Requirements

### Requirement: Trigger health agrees with whether the trigger can fire

A trigger's reported health state SHALL be `disabled` exactly when the trigger is disabled or its bot is disabled. An enabled trigger on an enabled bot SHALL report `waiting` until its source reports a more specific state, including after it is created, enabled or retried, and after it fires on a schedule. Re-enabling a bot SHALL keep any specific state its triggers last reported.

#### Scenario: A new interval trigger

- **WHEN** a user creates an enabled interval trigger and it has not yet fired
- **THEN** its health state is `waiting`

#### Scenario: A trigger created disabled

- **WHEN** a user creates a trigger with its enable switch off
- **THEN** its health state is `disabled`

#### Scenario: Re-enabling a trigger

- **WHEN** a user disables a trigger and then enables it again
- **THEN** its health state is `disabled` while it is off and `waiting` once it is back on, before any check runs

#### Scenario: An interval trigger after it fires

- **WHEN** an enabled interval trigger fires on its schedule
- **THEN** its health state is not `disabled`

#### Scenario: A one-shot trigger after it fires

- **WHEN** a once trigger fires and is disabled as a result
- **THEN** its health state is `disabled`

#### Scenario: Disabling the bot

- **WHEN** a user disables a bot whose triggers are enabled
- **THEN** every one of its triggers reports `disabled` health, although each trigger's switch is still on

#### Scenario: Enabling a trigger while its bot is disabled

- **WHEN** a user enables a trigger on a disabled bot
- **THEN** its health state stays `disabled` until the bot is enabled

#### Scenario: Re-enabling the bot

- **WHEN** a bot is enabled again after its triggers were disabled with it
- **THEN** a trigger that never reported anything reports `waiting`, and a trigger whose last report was `healthy` or `failed` reports that state again

#### Scenario: Retrying a trigger

- **WHEN** a user retries an enabled trigger
- **THEN** its health state is never `disabled`, and a schedule trigger, which runs no check, reports `waiting`

#### Scenario: A stored disabled state on an active trigger

- **WHEN** the server lists an enabled trigger on an enabled bot whose stored health state is `disabled`
- **THEN** it reports `waiting`

### Requirement: Trigger status pill agrees with the switches

The Triggers table SHALL show a Disabled status, in a neutral tone, for a trigger that is disabled or whose bot is disabled. It SHALL never label a trigger Disabled while both the trigger and its bot are enabled, whatever health state the server sends.

#### Scenario: A disabled trigger

- **WHEN** a trigger's switch is off
- **THEN** its row shows a neutral Disabled status

#### Scenario: A disabled bot

- **WHEN** a trigger's switch is on but its bot is disabled
- **THEN** its row shows a neutral Disabled status

#### Scenario: The table never contradicts the switch

- **WHEN** the server sends `disabled` health for a trigger whose switch is on and whose bot is enabled
- **THEN** the row shows Waiting, not Disabled
