## MODIFIED Requirements

### Requirement: Failed terminal admission falls back without interrupting the terminal

If a running provider is matched and its terminal admission subsequently fails, Terminay SHALL release that provider claim and replay the same foreground change through terminal activity. This SHALL be treated as a fallback rather than a successful agent observation. The privileged host SHALL record one `agent-admission-failed` diagnostic containing the provider id, opaque terminal identity, coarse failure class, and the error the provider reported. That diagnostic SHALL be recorded on every failed admission rather than being merely available to record. It SHALL NOT contain journal records, prompts, tool inputs or results, or paths belonging to the observed project.

#### Scenario: Admission failure after a match

- **WHEN** a matched provider's terminal admission fails
- **THEN** the provider claim is released, the foreground change is replayed through terminal activity, and the terminal is not interrupted

#### Scenario: Admission diagnostic content

- **WHEN** an `agent-admission-failed` diagnostic is recorded
- **THEN** it contains the provider id, opaque terminal identity, coarse failure class, and reported error, and no journal record, prompt, tool input, tool result, or observed-project path

#### Scenario: Every failure is recorded

- **WHEN** admission fails for any matched provider on any terminal
- **THEN** exactly one such diagnostic is recorded for that failure
