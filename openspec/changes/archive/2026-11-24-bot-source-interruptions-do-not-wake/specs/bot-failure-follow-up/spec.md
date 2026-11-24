## ADDED Requirements

### Requirement: A recovered interruption does not wake the bot

A live polled condition check that is interrupted once and returns a result on its retry SHALL NOT start a condition failure episode, and SHALL NOT start a failure execution. The interim *retrying* health SHALL neither start nor end an episode. A check that is interrupted again on its retry SHALL count as one failed check and SHALL follow every existing episode, exclusion, coalescing and rate-limit rule.

#### Scenario: Host sleep interrupts one check

- **WHEN** Investigate failures is on and a bot's command check is interrupted by host sleep, then succeeds on its retry
- **THEN** no failure execution starts and Sessions shows no new investigation

#### Scenario: The retry is interrupted as well

- **WHEN** Investigate failures is on, the trigger's last check was healthy, the failure has no cause that stops every execution, the bot has no queued or running failure execution, the hourly cap is not reached, and a check and its retry are both interrupted
- **THEN** exactly one failure execution starts that names the trigger and the interruption reason

#### Scenario: Retry during an open episode

- **WHEN** a trigger is already in a failure episode, and its next check is interrupted and then succeeds on retry
- **THEN** the episode stays open while retrying, ends on the success, and no failure execution starts
