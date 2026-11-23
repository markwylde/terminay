## ADDED Requirements

### Requirement: A token is copied only from a bot that has it saved

For each token option, **Copy from another bot** SHALL list only other bots that run the same agent and have that token saved in the server vault. When no such bot exists, the copy control SHALL NOT be shown. Determining the list SHALL NOT resolve a secret value. A copy whose source has no saved token SHALL be refused with a message that says so and SHALL leave the destination unchanged.

#### Scenario: A bot using device sign-in is not offered

- **WHEN** the only other bot of the same agent uses a device sign-in and has no saved token
- **THEN** the token option shows no copy control

#### Scenario: A bot with the token is offered

- **WHEN** another bot of the same agent has the token saved
- **THEN** the token's copy list includes that bot, and copying saves the value for this bot

#### Scenario: The source lost its token

- **WHEN** a copy is requested from a bot that no longer has the token saved
- **THEN** the server refuses it with a message naming the missing token, and the destination is unchanged
