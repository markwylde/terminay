## ADDED Requirements

### Requirement: Desktop recovers a remote connection in place

On wake, Desktop SHALL promptly probe its remote connection even if the document stayed visible. An answered application probe SHALL keep the connection. A lost connection SHALL recover through a fresh authenticated transport in the same document, even when the previous transport reports open. The window SHALL retain its server binding and restore subscriptions before enabling terminal input.

#### Scenario: A disconnected remote window recovers after wake

- **WHEN** Desktop wakes and the remote connection stopped delivering during sleep while still reporting open
- **THEN** the application probe misses, Desktop opens a fresh authenticated connection, and the same window resumes its server-owned terminal sessions without a reload or restart
- **AND** terminal input resumes after hydration and recovery leaves other connections alone

#### Scenario: A live connection survives wake

- **WHEN** the remote connection answers its wake probe
- **THEN** the window keeps the same transport and subscriptions

### Requirement: Desktop Retry reports the current recovery attempt

Automatic recovery and Retry connection SHALL share one bounded attempt per connection. Retry connection SHALL start immediately during backoff or visibly join the active attempt. The recovery surface SHALL show immediate progress followed by the outcome or latest actionable failure.

#### Scenario: Retry starts during backoff

- **WHEN** the remote window is waiting to try again and the user activates Retry connection
- **THEN** the window immediately shows retry progress and Desktop starts a fresh authenticated attempt on the same binding

#### Scenario: Retry joins the active attempt

- **WHEN** the user activates Retry connection during an automatic attempt
- **THEN** the window immediately acknowledges the click and shows that attempt's progress and outcome
- **AND** the click does not open a parallel peer or extend the attempt deadline

#### Scenario: Recovery times out

- **WHEN** the replacement endpoint or workspace handshake fails to become ready within the attempt deadline
- **THEN** the window shows a readable failure, Retry connection is available, and the window stays bound to its remote server

### Requirement: Desktop Retry remains legible and operable

Retry connection SHALL be operable by pointer and keyboard. Its label SHALL meet a contrast ratio of at least 4.5:1 in the default, hover, and keyboard-focus states. Keyboard focus SHALL be visible.

#### Scenario: Hover and keyboard focus keep Retry readable

- **WHEN** the user points at Retry connection or focuses it by keyboard
- **THEN** its label meets the required contrast and keyboard focus is visible
- **AND** clicking or pressing Enter activates recovery
