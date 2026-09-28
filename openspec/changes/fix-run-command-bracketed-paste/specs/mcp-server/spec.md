## MODIFIED Requirements

### Requirement: Project-implicit tool surface

Terminay SHALL expose the following project-implicit tools: `get_mcp_capabilities` reporting the globally available MCP operations for the bound host; `list_terminals` listing terminal panels in scope with opaque handles, display names, state, and active status; `read_terminal` reading either a bounded lossless raw-output range or a bounded current terminal-presentation snapshot; `search_terminal` searching a bounded current text presentation snapshot and returning bounded matching visual-row context; `get_terminal_status` returning canonical activity, attention, cwd, and last-exit information; `write_terminal` writing exact validated text to one live terminal; `run_command` writing one command and submitting it once as a paste followed by Enter, framed with bracketed paste only when the foreground program has enabled it; `open_terminal` creating a terminal in the same project with an optional display name and policy-valid cwd; `close_terminal` closing one terminal through normal terminal lifecycle rules; `focus_terminal` making one terminal active in the logical workspace view without stealing focus in an unrelated client; `rename_terminal` changing one terminal's display title; `split_terminal` creating a split relative to one terminal; `wait_for_idle` waiting for bounded canonical terminal inactivity; `wait_for_command` waiting for the next structured command completion and returning bounded exit information; and `wait_for_attention` waiting for the next canonical needs-attention signal.

#### Scenario: Listing terminals

- **WHEN** an agent calls `list_terminals`
- **THEN** it receives opaque handles, display names, state, and active status for terminal panels in scope

#### Scenario: Focusing a terminal

- **WHEN** an agent calls `focus_terminal`
- **THEN** the terminal becomes active in the logical workspace view without stealing focus in an unrelated client

#### Scenario: Running a multiline command

- **WHEN** an agent calls `run_command` with multiline input and the foreground program has enabled bracketed paste
- **THEN** the command is written once using bracketed paste and submitted once

#### Scenario: Running a command where bracketed paste is off

- **WHEN** an agent calls `run_command` and the foreground program has not enabled bracketed paste
- **THEN** the command is written without bracketed-paste markers, each line break is sent as a carriage return, and the command is submitted with a final carriage return

#### Scenario: Leading assignment in a shell without bracketed paste

- **WHEN** an agent calls `run_command` with `X=1 sh -c 'echo $X'` in a shell that has not enabled bracketed paste
- **THEN** the shell reads the assignment as an assignment and prints `1`

### Requirement: run_command response contract

`run_command` SHALL return `{ terminal, command_id, from, submitted_bytes, submitted: true, bracketed }`. `command_id` SHALL uniquely identify the accepted MCP submission and SHALL NOT be a shell command identity, an activity event, or an exit status. `from` SHALL be the terminal's raw `output_position` captured immediately before the write is accepted and SHALL be a lower bound for observing output after submission rather than proof that bytes in a later raw range were produced by that command, because prompts, background jobs, and other writers can interleave. `submitted_bytes` SHALL be the exact number of PTY input bytes written, including the bracketed-paste wrapper when used and the submission carriage return. `bracketed` SHALL be `true` exactly when the command was framed with bracketed-paste markers, which SHALL happen only when the terminal's canonical emulator reports that the foreground program has enabled bracketed paste; when that state is unknown the command SHALL be sent unframed.

#### Scenario: Command submitted

- **WHEN** `run_command` accepts a submission
- **THEN** it returns `command_id`, the pre-write `output_position` as `from`, the exact `submitted_bytes` including any wrapper and the carriage return, `submitted: true`, and `bracketed`

#### Scenario: Interleaved output after submission

- **WHEN** a caller reads raw output from `from`
- **THEN** `from` is only a lower bound and the range may include prompts, background jobs, and other writers' output

#### Scenario: Bracketed paste state unknown

- **WHEN** `run_command` targets a terminal whose canonical emulator is unavailable
- **THEN** the command is sent without bracketed-paste markers and `bracketed` is `false`
