## ADDED Requirements

### Requirement: Outcome reporting tool

The runtime tools SHALL include `outcome_report`, which a live execution uses to report its judged outcome as specified by bot-execution-resilience. It SHALL be bound to the calling execution and bot like every runtime tool. It SHALL NOT need the shell work lease. It SHALL accept an idempotency key, so that a retried report does not post a second chat message, and SHALL take the observed trigger revision as the trigger tools do. A revoked or ended execution SHALL NOT report an outcome. A briefing SHALL tell the agent when to use each disposition: `outside-control` for failures it cannot act on, `needs-human` only when it cannot continue without a person, and `fixed` after it repaired its own trigger, condition or script.

#### Scenario: Retried report

- **WHEN** an execution sends `outcome_report` with `needs-human` twice with the same idempotency key
- **THEN** one chat message is posted and the second call returns the first result

#### Scenario: Revoked execution

- **WHEN** a stopped execution sends `outcome_report`
- **THEN** it is refused and nothing is stored or posted

## MODIFIED Requirements

### Requirement: Briefings report recent failures
A briefing SHALL list up to 5 of the bot's executions that ended as failed or timed out in the last 24 hours. Each entry SHALL give the execution's compact origin and its failure reason cut to 256 bytes. When the execution had a startup failure, the entry SHALL also give its stage, whether it was temporary, and how many attempts were made. When the execution reported an outcome, the entry SHALL give its disposition. The briefing SHALL also list up to 5 of the bot's triggers whose condition health is failed or blocked, or that are waiting for the user. Each such trigger SHALL have its health error or blocker reason cut to 256 bytes. The briefing SHALL tell the agent that a temporary startup failure is usually outside its control and needs no action unless it keeps recurring.

#### Scenario: Briefing after failures
- **WHEN** a chat execution starts an hour after a trigger execution failed and while that trigger's condition check is failing
- **THEN** its briefing lists the failed execution with its reason and the trigger with its health error

#### Scenario: Briefing after an overloaded host
- **WHEN** an execution starts after a trigger execution failed four temporary startup attempts at the adapter check
- **THEN** its briefing lists that execution as a temporary startup failure at the adapter check with four attempts

#### Scenario: Briefing while a trigger waits for the user
- **WHEN** an execution starts while one of the bot's triggers is waiting for the user
- **THEN** its briefing lists that trigger with its blocker reason

### Requirement: Execution failure details
Execution list results SHALL carry a compact origin: its kind, any trigger ID and name, and for a failure origin the number of failures. They SHALL also carry the failure reason cut to 256 bytes, the structured failure cause, and the startup failure's stage, temporary flag and attempt count when there is one. A single execution read SHALL add the reason cut to 1 KiB, the reported outcome with its reason and action, and for a failure origin its listed failures, all within the 8 KiB response budget.

#### Scenario: Failure origin detail
- **WHEN** an execution reads a failure execution that lists 20 failures with 1 KiB reasons
- **THEN** the response stays within 8 KiB and says how many failures were left out

#### Scenario: Startup failure detail
- **WHEN** an execution reads a sibling that failed three temporary startup attempts at the relay stage
- **THEN** the result names the relay stage, marks it temporary and gives three attempts
