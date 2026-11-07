## ADDED Requirements

### Requirement: Connection timing tool

`get_connection_metrics` SHALL return the server's connection timing summary, the same summary Settings > Remote shows: the sample count, the time range, and the count, mean, p50, p95 and maximum of each duration, overall and per trigger, with the most recent samples. It SHALL be read-only. It SHALL NOT record or clear samples, and SHALL NOT change whether they are recorded. It SHALL require workspace reach. While recording is off and no samples are held, it SHALL say so rather than fail.

#### Scenario: Agent reads the timings

- **WHEN** a workspace-reach caller calls `get_connection_metrics` on a server holding samples, and the request is permitted
- **THEN** the result carries the per-trigger p50 and p95 totals and the most recent samples

#### Scenario: Recording is off

- **WHEN** `get_connection_metrics` is called on a server whose setting is off and that holds no samples
- **THEN** the result says recording is off and holds no samples

#### Scenario: Project terminal reads the timings

- **WHEN** an agent in a project terminal calls `get_connection_metrics`
- **THEN** the call fails with `out_of_scope`
