## MODIFIED Requirements

### Requirement: Project-implicit tool surface

Terminay SHALL expose the following project-implicit tools:

- `get_mcp_capabilities` reports the MCP operations available to the caller.
- `list_terminals` lists terminal panels in scope with opaque handles, display names, state, and active status.
- `read_terminal` reads either a bounded lossless raw-output range or a bounded current terminal-presentation snapshot.
- `search_terminal` searches a bounded current text presentation snapshot and returns bounded matching visual-row context.
- `get_terminal_status` returns canonical activity, attention, cwd, and last-exit information.
- `write_terminal` types into one live terminal: exact validated text, then optional named key presses, then an optional Enter.
- `run_command` writes one command as a paste, framed with bracketed paste only when the foreground program has enabled it, and submits it once with a separate Enter.
- `open_terminal` creates one terminal in the same project. It takes an optional display name, an optional policy-valid cwd, and an optional shell profile id from `list_shell_profiles`. The terminal can optionally be placed beside a tab and optionally brought to the front on the agent's client.
- `close_terminal` closes one terminal through normal terminal lifecycle rules.
- `focus_terminal` shows one terminal's project, folder, and tab on the agent's client.
- `rename_terminal` changes one terminal's display title.
- `update_terminal` changes one terminal tab's icon, colour, note, and activity tracking.
- `split_terminal` creates exactly one new terminal beside a target terminal on the agent's client.
- `wait_for_idle` waits for bounded canonical terminal inactivity.
- `wait_for_command` waits for the next structured command completion and returns bounded exit information.
- `wait_for_attention` waits for the next canonical needs-attention signal.
- The view and folder tools of the MCP workspace view.

A shell profile given to `open_terminal` SHALL be resolved as the New Terminal action resolves a chosen profile, and an unknown or unavailable profile SHALL fail without creating a terminal. A tool SHALL report a view change only when the agent's client has applied it, and its result SHALL carry that client's layout afterwards.

#### Scenario: Listing terminals

- **WHEN** an agent calls `list_terminals`
- **THEN** it receives opaque handles, display names, state, and active status for terminal panels in scope

#### Scenario: Focusing a terminal

- **WHEN** an agent calls `focus_terminal`
- **THEN** the agent's client shows that terminal's project, folder, and tab in front, and no other client's view changes

#### Scenario: Splitting a terminal

- **WHEN** an agent calls `split_terminal` with `direction: "right"`
- **THEN** exactly one new terminal is created, the agent's client shows it in a new pane to the right of the target, and the result carries the new terminal's handle and the resulting layout

#### Scenario: Opening without taking focus

- **WHEN** an agent calls `open_terminal` without `focus`
- **THEN** the terminal is created and the tab in front on the agent's client is unchanged

#### Scenario: Opening and focusing

- **WHEN** an agent calls `open_terminal` with `focus: true`
- **THEN** the agent's client shows the new terminal in front, including when it is in another project or the automation space

#### Scenario: Opening with a shell profile

- **WHEN** an agent calls `open_terminal` with the id of a durable bash profile
- **THEN** the terminal launches with that profile

#### Scenario: Unknown shell profile

- **WHEN** an agent calls `open_terminal` with a profile id that does not exist
- **THEN** the call fails and no terminal is created

#### Scenario: Placement without a client

- **WHEN** an agent calls `split_terminal` and no agent's client is reachable
- **THEN** the terminal is still created, and the result reports `placed: false` with the reason instead of a layout

#### Scenario: Running a multiline command

- **WHEN** an agent calls `run_command` with multiline input and the foreground program has enabled bracketed paste
- **THEN** the command is written once using bracketed paste and submitted once with an Enter written after it on its own

#### Scenario: Running a command where bracketed paste is off

- **WHEN** an agent calls `run_command` and the foreground program has not enabled bracketed paste
- **THEN** the command is written without bracketed-paste markers, each line break is sent as a carriage return, and the command is submitted with a final carriage return written on its own

#### Scenario: Leading assignment in a shell without bracketed paste

- **WHEN** an agent calls `run_command` with `X=1 sh -c 'echo $X'` in a shell that has not enabled bracketed paste
- **THEN** the shell reads the assignment as an assignment and prints `1`

## ADDED Requirements

### Requirement: Enter is a key press

When `write_terminal` with `submit: true` or `run_command` submits typed input, the Enter SHALL be written on its own, after a short pause following the text, and never in the same write as the text, so a program that reads its own keyboard, such as an agent CLI, reads it as a key press and not as part of a paste. The byte counts each tool returns SHALL include that Enter.

#### Scenario: Sending a message to an agent

- **WHEN** an agent calls `write_terminal` with a message as `text` and `submit: true` on a terminal running Claude Code
- **THEN** the text is written, then Enter is written on its own, and Claude Code submits the message

#### Scenario: Pressing Enter on text already typed

- **WHEN** an agent calls `write_terminal` with `submit: true` and no text
- **THEN** a single carriage return is written

### Requirement: Typed input is written in order, once

A submission's writes to one terminal SHALL NOT interleave with another Terminay submission's writes to that terminal. A submission SHALL check for cancellation before each write, and a cancelled submission SHALL write nothing more and fail as `cancelled`. If a write fails, the remaining writes SHALL NOT be sent, the call SHALL fail with that error, and Terminay SHALL NOT retry it.

#### Scenario: Two agents submit at once

- **WHEN** two agents each call `write_terminal` with text and `submit: true` on the same terminal at the same moment
- **THEN** the terminal receives one agent's text and Enter, then the other's

#### Scenario: Cancelled between text and Enter

- **WHEN** a `write_terminal` call with text and `submit: true` is cancelled after its text is written
- **THEN** no Enter is written and the call fails as `cancelled`

#### Scenario: A write fails part way

- **WHEN** the terminal exits after a `write_terminal` call's text is written and before its Enter
- **THEN** the call fails, no further key is written, and nothing is retried

### Requirement: write_terminal presses named keys

`write_terminal` SHALL accept optional `text` and `keys`, up to 64 names from a fixed set of ordinary keys such as Enter, Backspace, and Ctrl+C. It SHALL write the text, then each key on its own, then the Enter of `submit: true`, and report `submitted` as whether `submit` was true. A call that writes nothing, or has an unknown or 65th key, SHALL be refused as `bad_request` before anything is written.

#### Scenario: Text, keys, and submit together

- **WHEN** an agent calls `write_terminal` with `text: "ab"`, `keys: ["Backspace", "Left"]`, and `submit: true`
- **THEN** the writes are `ab`, DEL, `ESC [ D`, and a carriage return, in that order, the result reports `bytes: 7` and `submitted: true`

#### Scenario: Deleting and interrupting

- **WHEN** an agent calls `write_terminal` with `keys: ["Backspace", "Backspace", "Ctrl+C"]`
- **THEN** two DEL bytes and one ETX byte are written, each on its own

#### Scenario: Enter as a key

- **WHEN** an agent calls `write_terminal` with `keys: ["Enter"]` and no `submit`
- **THEN** a carriage return is written and the result reports `submitted: false`

#### Scenario: Nothing to write

- **WHEN** an agent calls `write_terminal` with empty text, no keys, and no `submit`
- **THEN** the call fails with `bad_request` and a message saying to use `keys` or `submit`, and nothing is written

#### Scenario: Unknown key

- **WHEN** an agent calls `write_terminal` with text and `keys: ["Ctrl+Q"]`
- **THEN** the call fails with `bad_request` listing the accepted key names, and nothing, not even the text, is written

#### Scenario: Too many keys

- **WHEN** an agent calls `write_terminal` with 65 keys
- **THEN** the call fails with `bad_request` and nothing is written
