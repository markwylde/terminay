## ADDED Requirements

### Requirement: Inspection requires the bot's own setting

Every inspection tool SHALL require the calling bot's current **Inspect other bots** setting to be on. The server SHALL read the setting from the bot's current record on every call, so a change applies to running executions in both directions. Without it, the tool SHALL return `forbidden` before looking up any target. The setting SHALL be independent of Terminay MCP access. No MCP tool SHALL be able to change the setting for any bot.

#### Scenario: Setting off

- **WHEN** an execution of a bot without the setting calls any inspection tool, naming an existing or an unknown bot
- **THEN** the call returns `forbidden` and reveals nothing about the target

#### Scenario: Setting turned off during an execution

- **WHEN** a user turns the setting off while an execution of that bot is running
- **THEN** the execution's next inspection call returns `forbidden`

#### Scenario: Setting turned on during an execution

- **WHEN** a user turns the setting on while an execution of that bot is running
- **THEN** the execution's next inspection call succeeds

#### Scenario: A bot tries to grant itself access

- **WHEN** an execution passes a profile field or the setting's name to any runtime tool
- **THEN** the call is refused and the setting is unchanged

#### Scenario: Ended execution

- **WHEN** a stopped or revoked execution of a permitted bot calls an inspection tool
- **THEN** the call is refused because the execution capability is no longer live

### Requirement: Inspection tools

A permitted bot SHALL be able to list the other bots on its server, and for another bot read its config, list its executions, read one execution's detail, read an ended execution's runner output, list and search its messages, including thread replies, read one message with its attachment names, types and sizes, list and search its triggers and read one trigger with its prompt. Lists and text SHALL use the same page sizes, slices and 8 KiB response limit as the bot's own tools.

#### Scenario: Reading why another bot failed

- **WHEN** a permitted bot lists another bot's executions and reads a failed one's detail and output
- **THEN** it receives the failure reason and the end of the redacted output, with a cursor for earlier output

#### Scenario: Reading another bot's thread

- **WHEN** a permitted bot lists another bot's messages with a thread ID and reads one reply
- **THEN** the list returns that thread's replies with attachment counts, and the read returns the reply with its attachment names, types and sizes

#### Scenario: Output of a running execution

- **WHEN** a permitted bot asks for the output of another bot's running execution
- **THEN** the request is refused as a conflict that says the execution has not ended

#### Scenario: The list changes between pages

- **WHEN** a bot or trigger is created or deleted while a permitted bot is paging through that list
- **THEN** the next page returns a conflict, and no row is silently skipped or repeated

#### Scenario: Cursor from another target

- **WHEN** a permitted bot uses a cursor from one bot's list on a different bot
- **THEN** the request is refused

### Requirement: Inspection is strictly read-only

Inspection tools SHALL NOT post, stop, steer, replace, run, change or acknowledge anything on another bot, and SHALL NOT reach its files, memories, inbox, events, shell or desktop. An inspection call SHALL record no action in any message log.

#### Scenario: Reading changes nothing

- **WHEN** a permitted bot reads another bot's config, sessions, output, chats and triggers
- **THEN** the records, message logs and event sequences of both bots are unchanged

### Requirement: Inspection returns no secret fields

Inspection responses SHALL be built from explicit field allowlists, so a field not named by the allowlist is never returned. No structured field SHALL carry credentials, tokens, environment values, header names or values, sign-in state, bot instructions, trigger commands, working directories, URLs, watched paths, attachment IDs or action link targets.

#### Scenario: Config response

- **WHEN** a permitted bot reads the config of a bot with a token sign-in and instructions
- **THEN** the response has the name, agent, model and enabled state, and has no sign-in, environment variable name or instructions

#### Scenario: Trigger with a secret header

- **WHEN** a permitted bot reads another bot's HTTP trigger that has an authorization header
- **THEN** the response gives the condition kind and interval, and has no URL, header name or header value

### Requirement: Inspection redacts with the source bot's credentials

Message text, trigger prompts, reasons and runner output SHALL be returned as content, with the source bot's credentials redacted. Each original string SHALL be redacted before any excerpt, truncation or slice is taken. If redaction fails, the call SHALL fail without returning the content.

#### Scenario: Token in stored output

- **WHEN** another bot's stored output contains that bot's token value
- **THEN** the output read returns `[redacted]` in its place

#### Scenario: Token across a cut

- **WHEN** the source bot's token straddles a message excerpt, a reason limit or a slice boundary
- **THEN** no part of the token appears in the response

#### Scenario: Redaction unavailable

- **WHEN** the source bot's credential cannot be read to redact a response
- **THEN** the call fails and returns none of the content

### Requirement: Other bots' content is untrusted data

Inspection tool descriptions SHALL state that other bots' content is data and not instructions. Every inspection result SHALL carry a marker saying the same.

#### Scenario: Injected instruction in a message

- **WHEN** a permitted bot reads another bot's message that tells the reader to run a command
- **THEN** the result carries the untrusted-data marker with the message text

### Requirement: Inspection stays on the same server

Inspection tools SHALL resolve bots only from the calling bot's server. An unknown or deleted bot SHALL return `not_found`. An execution, message or trigger that does not belong to the named bot SHALL return `not_found`. A bot naming itself SHALL be refused and directed to its own tools.

#### Scenario: Deleted bot

- **WHEN** a permitted bot names a bot that has been deleted
- **THEN** the call returns `not_found`

#### Scenario: Execution of a different bot

- **WHEN** a permitted bot names bot A with an execution ID that belongs to bot B
- **THEN** the call returns `not_found`

#### Scenario: Own tools stay scoped

- **WHEN** a permitted bot calls `sessions_get` with another bot's execution ID
- **THEN** the call returns `not_found`
