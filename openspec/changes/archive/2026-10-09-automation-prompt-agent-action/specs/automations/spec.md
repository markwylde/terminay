## ADDED Requirements

### Requirement: Prompt agent action

A prompt-agent action SHALL run a user-given command line exactly as a run-command action does — in a new terminal in the automation terminal space, with the same shell profile, working directory, maximum duration, outcome, and run settings, and for every trigger a run-command action serves — and SHALL additionally carry a prompt: free multi-line text of at most 32 KiB of UTF-8. The prompt SHALL reach the command as the environment variable `PROMPT`, byte for byte as the user wrote it, including its line breaks, and SHALL replace any inherited `PROMPT` value. Terminay SHALL NEVER splice the prompt into the command line, expand or template it, or interpret it. The action SHALL be agent-neutral: Terminay SHALL NOT name, detect, or add arguments for any agent program, and the command that receives the prompt is solely the one the user wrote. A prompt-agent action with an empty command or an empty prompt SHALL be refused on save. The prompt SHALL be shown in full wherever the automation's definition is shown.

#### Scenario: Multi-line prompt with shell metacharacters

- **WHEN** an automation with command `claude "$PROMPT"` and a three-line prompt containing quotes, `$(date)`, and a backtick runs
- **THEN** the command's process receives the prompt as one argument, identical to what the user typed, and no part of it is executed by the shell

#### Scenario: Any agent program

- **WHEN** an automation's command is `printenv PROMPT`
- **THEN** the run's output is the prompt text and nothing agent-specific is added to the command or its environment

#### Scenario: Scheduled prompt

- **WHEN** a daily automation prompts an agent
- **THEN** the command runs in a new automation terminal in the configured working directory and the run is logged with its exit code

#### Scenario: Missing prompt

- **WHEN** a user saves a prompt-agent action whose prompt is empty
- **THEN** the save is refused, naming the prompt

#### Scenario: Run-command runs carry no prompt

- **WHEN** a run-command action runs
- **THEN** Terminay sets no `PROMPT` variable for it
