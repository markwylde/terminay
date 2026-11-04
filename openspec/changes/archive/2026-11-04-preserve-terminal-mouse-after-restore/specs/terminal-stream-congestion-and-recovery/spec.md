## MODIFIED Requirements

### Requirement: Parser-boundary recovery equivalence

Congestion across UTF-8, CSI, OSC, DCS, alternate-screen, resize, and synchronized-output boundaries SHALL restore a presentation equivalent to the canonical checkpoint and later live stream. Fresh attachment and recovery SHALL preserve the program's active mouse tracking protocol and mouse report encoding, including disabled tracking, so the program receives mouse input with the same semantics as before restoration. Restoring over an existing display SHALL replace obsolete mouse state with the checkpoint state before applying the ordered tail.

#### Scenario: Congestion mid-sequence

- **WHEN** congestion occurs across a UTF-8, CSI, OSC, DCS, alternate-screen, resize, or synchronized-output boundary
- **THEN** the restored presentation is equivalent to the canonical checkpoint plus the later live stream

#### Scenario: Restore a mouse tracking program

- **WHEN** a fresh attachment or recovery restores a checkpoint for a program using mouse tracking with SGR encoding
- **THEN** clicks, releases, and wheel input reach the program using SGR encoding without requiring the program to enable its mouse modes again
- **AND** ordinary keyboard input remains usable

#### Scenario: Replace obsolete mouse state

- **WHEN** an existing display with mouse tracking enabled restores a checkpoint with tracking disabled and an ordered tail that leaves it disabled
- **THEN** dragging selects text and wheel input scrolls available terminal history without sending mouse reports to the PTY

#### Scenario: Apply a mouse mode change in the tail

- **WHEN** a restored checkpoint enables mouse tracking and its ordered output tail disables tracking or changes the report encoding
- **THEN** subsequent mouse input follows the final ordered state rather than the checkpoint's earlier state

### Requirement: Mouse reports share authorized ordered terminal input

For a controlling presentation, Terminay SHALL deliver terminal-generated text and binary mouse reports to the owning PTY in order with keyboard input, preserving each report's bytes and enforcing the existing input queue bounds and attachment handoff rules. A read-only presentation SHALL NOT write mouse reports to the PTY. Mouse tracking SHALL follow terminal output rather than the identity of the foreground program.

#### Scenario: Default binary mouse reports

- **WHEN** a controlling terminal emits default-encoding mouse reports containing coordinate bytes above ASCII, interleaved with keyboard input
- **THEN** the PTY receives the reports with those bytes intact and in the original input order

#### Scenario: Read-only mouse input

- **WHEN** a client without the interactive presentation lease clicks or scrolls a terminal running a mouse tracking program
- **THEN** no mouse report from that client reaches the PTY and presentation ownership is unchanged

#### Scenario: Mouse input during attachment replacement

- **WHEN** a controlling panel's attachment is replaced while mouse reports and keyboard input are queued
- **THEN** the input follows the same bounded ordering, ownership checks, and uncertain-delivery handling as keyboard input, without duplicate reports or writes through a retired attachment

#### Scenario: Return to a long-running terminal

- **WHEN** the user switches away from a terminal with long history and then returns, including when its display is restored from a checkpoint
- **THEN** its mouse tracking program receives clicks and wheel input and keyboard input remains usable
