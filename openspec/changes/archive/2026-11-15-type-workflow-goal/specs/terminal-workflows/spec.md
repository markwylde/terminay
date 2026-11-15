## MODIFIED Requirements

### Requirement: Launch text

Launching SHALL create the terminal's workflow from the template with every step `not_started`, then type the launch text into the terminal and submit it once. The launch text SHALL be `/goal `, followed by the template's opening prompt, followed by a fixed instruction: call `get_workflow`, work through the steps in order, set each step to `running` before starting it, follow its prompt, and set it to `done` with a one-line note, `failed` with the reason, or `needs_input` when it needs the user; set a step it has been told to drop, or that does not apply, to `skipped` with a one-line reason; and continue until every step is done or skipped. The launch text SHALL be bounded to 16 KiB, and a launch over the bound SHALL be refused before anything changes.

Typing SHALL write the text as one line, with each line break or tab, and the whitespace around it, replaced by a single space. It SHALL write that line without bracketed-paste markers, whether or not the terminal has enabled bracketed paste, in chunks of at most 128 characters with a pause of about 10 ms between chunks, so a program that reads its own keyboard, such as Claude Code, receives typed keys and not a paste. The Enter that submits the text SHALL be written on its own, about 50 ms after the last chunk, never in the same write as text. Typing SHALL stop, without writing the rest of the text or the Enter, when the launch or resume request is cancelled or a write fails. The workflow template editor's launch preview SHALL show the same one-line text.

#### Scenario: Launching a template

- **WHEN** the user opens the Command Bar on a terminal running an agent and chooses `openspec:standard-flow`
- **THEN** the terminal's workflow panel shows the template's ten steps not started, and the launch text is typed into that terminal and submitted once

#### Scenario: Claude Code runs the goal

- **WHEN** a workflow is launched into a terminal running Claude Code, and its launch text is longer than 1 KB
- **THEN** Claude Code receives the text as typed keys, not as pasted text, and runs `/goal` with it

#### Scenario: Typed, never pasted

- **WHEN** a workflow is launched into a terminal whose program has enabled bracketed paste
- **THEN** no bracketed-paste marker is written, no write before the Enter carries more than 128 characters or a line break, and the Enter arrives in a write of its own after a pause

#### Scenario: Launch cancelled while typing

- **WHEN** the launch request is cancelled after some chunks of the launch text are written
- **THEN** no further chunk and no Enter is written, and a later launch or resume on that terminal types normally

#### Scenario: A multi-line opening prompt

- **WHEN** a template whose opening prompt has two paragraphs is launched
- **THEN** both paragraphs are typed on one line, separated by a space, and the text is submitted once

#### Scenario: Oversized launch text

- **WHEN** a template's opening prompt makes its launch text longer than 16 KiB
- **THEN** the launch is refused, no workflow is attached, and nothing is written to the terminal

#### Scenario: The instruction names skipping

- **WHEN** a template is launched
- **THEN** the launch text tells the agent to set a step it is told to drop to `skipped` with a reason, and to continue until every step is done or skipped

### Requirement: Resuming a workflow

While the active terminal's workflow is unfinished, the Command Bar SHALL list **Resume workflow** with the workflow's name above every other workflow entry. Choosing it SHALL type the resume text into that terminal and submit it once, as launching does, and SHALL change no step. The resume text SHALL be `/goal `, followed by the workflow's opening prompt, followed by a fixed instruction to call `get_workflow`, treat it as the source of truth, continue from the resume point and then every other step that is not done or skipped, in step order, and set a step that does not apply to `skipped` with a one-line reason.

#### Scenario: Agent session restarted mid-run

- **WHEN** a workflow has steps 1 to 4 done and step 5 running, the user starts a new agent session in the terminal, and chooses Resume workflow
- **THEN** the resume text is typed and submitted, and steps 1 to 5 keep their status

#### Scenario: Resume is typed, never pasted

- **WHEN** the user chooses Resume workflow on a terminal whose program has enabled bracketed paste
- **THEN** the resume text is typed as one line in chunks of at most 128 characters with no bracketed-paste marker, and the Enter arrives in a write of its own

#### Scenario: Finished workflow

- **WHEN** every step of the active terminal's workflow is done
- **THEN** the Command Bar does not list Resume workflow
