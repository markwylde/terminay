## ADDED Requirements

### Requirement: Window message approvals name attachments

A window message that carries attachments SHALL be evaluated under the Window Messages policy once, as one message, before any attachment is uploaded. Under Ask Permission the pending approval SHALL state, with the window's title and the complete text, each attachment's offered name and size. Declining SHALL upload nothing and write nothing. Under Never Allow the view SHALL receive a refusal and nothing SHALL be uploaded or written.

#### Scenario: Ask Permission with a photo

- **WHEN** Window Messages is Ask Permission and a window in Terminal 1 sends "Here is the error" with `screenshot.png` of 2 MiB
- **THEN** Terminal 1's pane shows a prompt with the window's title, the full text, and `screenshot.png` with its size, and nothing is uploaded or typed until the user allows it

#### Scenario: Declined with attachments

- **WHEN** the user declines that prompt
- **THEN** no file is written to the scratch directory and nothing is typed into the terminal

#### Scenario: Never Allow with attachments

- **WHEN** Window Messages is Never Allow and a window sends a message with an attachment
- **THEN** the view receives a refusal, and nothing is uploaded or written
