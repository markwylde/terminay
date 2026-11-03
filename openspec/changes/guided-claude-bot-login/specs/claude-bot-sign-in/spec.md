## ADDED Requirements

### Requirement: Guided Claude subscription sign-in

Claude Code bots SHALL offer **Sign in with Claude** in Configure › Profile › Sign-in alongside the sign-in-token and API-key options. Selecting it SHALL start the bot container if needed and run Claude’s own subscription login command as the bot user, in its own home. The surface SHALL show the command’s output and allow input, including copying its browser URL and pasting the browser-issued authorization code. It SHALL explain this code-paste flow without assuming the browser can reach the container’s loopback listener. Successful command completion SHALL select the saved login for subsequent executions. Failed or cancelled sign-in SHALL leave the selected sign-in unchanged.

#### Scenario: Browser approval from another machine

- **WHEN** a user chooses Sign in with Claude for a stopped bot and the browser displays an authorization code
- **THEN** Terminay starts the container and shows the login terminal, accepts the pasted code, and selects the saved login only after successful command completion

#### Scenario: Cancelled login

- **WHEN** the user closes the login terminal before completion or the login command fails
- **THEN** the bot’s selected sign-in remains unchanged and the user can retry

### Requirement: Claude owns its persistent login and refresh

The saved Claude login SHALL remain in that bot’s persistent home volume, available to its Claude adapter after container stop and restart or recreation that retains the home. Claude SHALL own credential storage, refresh and refresh coordination. Terminay SHALL NOT read, copy, display or distribute the saved credential, access the host account’s login, introduce a refresh daemon, or require an idle inference process to keep the bot signed in. Separate bots SHALL have separate homes and sign-ins. The UI SHALL NOT promise perpetual login validity.

#### Scenario: Container restarts with retained home

- **WHEN** a bot signed in with Claude restarts with its existing home volume
- **THEN** its subsequent execution uses the saved login and Claude can refresh it when needed without a host credential copy

#### Scenario: Concurrent executions

- **WHEN** multiple Claude executions for the same bot need a fresh access token
- **THEN** they use the same bot home and Claude’s own credential refresh coordination

### Requirement: Explicit Claude credential selection and sign-out

The selected credential method SHALL determine authentication for each new execution. A pasted token or API key SHALL take precedence over a saved browser login when selected. Selecting browser login SHALL exclude previously saved token and API-key values from the execution environment. Sign out SHALL invoke Claude’s own logout command inside the bot and clear the selected saved-login state only on successful sign-out. Auth rejection SHALL remain visible with a way to sign in again. Deleting the home SHALL remove its saved login.

#### Scenario: Select an API key after browser sign-in

- **WHEN** a user selects an API key for a Claude bot that has a saved browser login
- **THEN** the next execution authenticates with the selected API key and does not fall back to that login

#### Scenario: Select browser login after a pasted token

- **WHEN** a user completes browser sign-in for a bot with a saved pasted token
- **THEN** new executions use the saved login without receiving the pasted credential variables

#### Scenario: Sign out

- **WHEN** Claude’s logout command succeeds inside the bot
- **THEN** the bot’s saved-login selection is cleared and a new message requires a credential choice
