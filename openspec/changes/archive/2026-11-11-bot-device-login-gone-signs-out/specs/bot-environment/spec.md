## MODIFIED Requirements

### Requirement: Device sign-in runs in the bot's own container

When the user chooses an agent's device sign-in, the server SHALL start the bot's container if it is stopped, and SHALL run the declared sign-in command in it as `bot`, with `HOME=/home/bot` and in `/home/bot`. The command SHALL run in a terminal shown in the Sign-in section, so the user sees its browser URL and either approves its device code in their browser or pastes the browser-returned authorization code into the terminal.

- **Config.** Before running the command, and before each session while the bot's sign-in is `device`, the host SHALL write the device sign-in's own bot config files in place of the agent's files of the same path.
- **The login stays in the bot.** The login the command saves SHALL stay in the bot's home volume. Terminay SHALL NEVER read, copy, or display it, and SHALL NOT pass it to any other bot.
- **Outcome.** When the command exits successfully, the bot's sign-in SHALL become `device`. When it fails, or the user closes the terminal first, the bot's sign-in SHALL be unchanged.
- **Login check.** An agent's device sign-in MAY declare a status command that reports, offline, whether a login is in the bot's home. Before each session while the bot's sign-in is `device`, the server SHALL run it in the bot's container as `bot`, with `HOME=/home/bot`, and SHALL receive only its exit status. When it exits non-zero, the bot SHALL become Not signed in, and the session SHALL be refused with a reason that names Configure › Profile › Sign-in before the agent starts. When the check cannot run, the bot's sign-in SHALL be unchanged.
- **Sign out.** Signing out SHALL run the declared sign-out command in the bot's container as `bot`, and SHALL set the bot to Not signed in only after successful sign-out.
- **Deletion.** Deleting a bot with its home SHALL remove its login. Choosing another sign-in SHALL leave the saved login in the home until the user signs out.

#### Scenario: Codex signs in with ChatGPT

- **WHEN** a user chooses Sign in with ChatGPT for a Codex bot and approves the code in their browser
- **THEN** the bot's sign-in is `device`, its next session runs signed in, and the login is in that bot's home only

#### Scenario: Each bot signs in separately

- **WHEN** one Codex bot has signed in with ChatGPT and the user creates a second Codex bot
- **THEN** the second bot is Not signed in

#### Scenario: Sign-in abandoned

- **WHEN** the user closes the sign-in terminal before approving the code
- **THEN** the bot's sign-in is unchanged

#### Scenario: Sign out

- **WHEN** the user signs a Codex bot out
- **THEN** `codex logout` runs in that bot's container, and the bot is Not signed in

#### Scenario: Device login removed from the home

- **WHEN** a Codex bot signed in with ChatGPT has its home volume removed, and the user sends it a message
- **THEN** the message is refused with a reason that names Configure › Profile › Sign-in, Codex is not started, and the bot is Not signed in

#### Scenario: Recreate keeps the device login

- **WHEN** a user recreates the container of a Codex bot signed in with ChatGPT
- **THEN** its home volume is kept, and its next session runs signed in
