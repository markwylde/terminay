## ADDED Requirements

### Requirement: Source runs that end without a result are classified

A source run that ends without a result frame SHALL be classified from server state and exit status, never stderr text, in this order: cancelled; over time limit (the source's deadline or the test window fired); worker not executable (exit 126 or 127); otherwise interrupted, including a broken stream or unknown exit. Existing engine and process-limit causes SHALL be kept.

#### Scenario: The worker cannot be executed

- **WHEN** a command check's exec exits 127 without output because the source worker is missing or not executable
- **THEN** the reason says the source worker could not be executed in the bot's container and that recreating the bot updates its image

#### Scenario: Host wakes from sleep during a check

- **WHEN** a command check's exec stream ends or errors without output and the exit status is not 126 or 127
- **THEN** the check is classified as interrupted, and its reason says the check was interrupted before it reported, without telling the owner to recreate the bot

#### Scenario: Test window is shorter than the command

- **WHEN** a trigger test runs a command that takes longer than the 10-second test window
- **THEN** the test fails with a reason naming the 10-second limit

#### Scenario: Container runs out of processes

- **WHEN** a check ends without output and the existing process-limit classification finds the container at its process limit
- **THEN** the health error keeps the process-limit cause

### Requirement: Source run reasons include bounded redacted diagnostics

A reason for a source run that ended without a result SHALL include the exit status (or say it is unknown) and at most 1 KiB from the tail of the worker's stderr. Stderr SHALL be bounded while it is read. The tail SHALL be redacted with the bot's credential and header secrets before it is stored in health or passed to a failure follow-up. A partial line at the start of the retained tail SHALL be dropped. If redaction is unavailable, the stderr tail SHALL be omitted.

#### Scenario: Worker stderr contains a secret

- **WHEN** an interrupted run's stderr contains one of the bot's secrets
- **THEN** the stored health error shows `[redacted]` in its place

#### Scenario: Large stderr

- **WHEN** an interrupted run writes several megabytes of stderr
- **THEN** the reason contains at most 1 KiB of it and the server holds only a bounded tail while reading

### Requirement: An interrupted polled check is retried once

A live command or HTTP check classified as interrupted SHALL be retried once, about 5 seconds later, in the same check, only after cleanup of the first run succeeded. Otherwise it SHALL fail at once. While waiting, health SHALL be *retrying*, with the reason and the next retry time. Only a failed retry SHALL record the check as failed, with its reason. Tests and other classifications SHALL NOT retry.

#### Scenario: One interruption recovers

- **WHEN** a command check is interrupted and its retry returns a result
- **THEN** the result is evaluated as that check's observation and health becomes healthy

#### Scenario: Interrupted twice

- **WHEN** a command check is interrupted and its retry is interrupted as well
- **THEN** health becomes failed with the second interruption's reason

#### Scenario: Over the time limit

- **WHEN** a live command check exceeds its time limit
- **THEN** it fails at once without a retry

### Requirement: A pending retry is cancelled with its trigger

A pending retry SHALL be cancelled when its trigger is disabled, edited, reset or deleted, when its bot is disabled, or when the server stops. A retry SHALL NOT overlap another check of the same trigger. A scheduled check that falls due while the retry is pending SHALL NOT start alongside it; the trigger's next check after the retry covers that time.

#### Scenario: Trigger disabled during the retry delay

- **WHEN** a trigger is disabled while its interrupted check waits to retry
- **THEN** the retry does not run
