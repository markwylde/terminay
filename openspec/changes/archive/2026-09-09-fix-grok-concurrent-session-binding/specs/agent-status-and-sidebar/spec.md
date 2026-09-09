## MODIFIED Requirements

### Requirement: Grok session roots and binding

The `terminay-agent-grok` package SHALL own every Grok executable name, home-root rule, process and journal binding rule, mapping version, fixture, and compatibility test. Grok sessions SHALL live below the effective `GROK_HOME/sessions` root, or the host account's `.grok/sessions` root when `GROK_HOME` is unset, grouped by a URL-encoded working directory and named with Grok's session UUID. The lifecycle journal SHALL be that directory's `events.jsonl`; `chat_history.jsonl`, `updates.jsonl`, `signals.json`, memtrace, and MCP logs SHALL NOT be lifecycle sources. Because the journal carries no session-header record, the process-bound `events.jsonl` path SHALL supply the stable provider session ID after the host canonicalizes the writable handle. Home-relative containment SHALL NOT be required for that writer proof. Grok also writes `active_sessions.json` with `{session_id, pid, cwd}` rows for live processes, and where a descendant of the issued PTY has that exact pid the extension SHALL bind the corresponding journal even if the process is not holding `events.jsonl` open. When more than one listed descendant pid matches, the extension SHALL still bind: it SHALL admit each matching pid's eligible primary journal for that tree, and where several eligible primary journals match it SHALL select the most recently modified one. A journal whose first `turn_started` reports a `session_relationship` other than `primary` SHALL NOT be an eligible root. Match-count greater than one SHALL NOT leave the tree unbound. CWD in that registry SHALL never be identity. A `turn_started.session_id` that does not equal the bound id SHALL be ignored. Where one writer holds multiple eligible root journals, the most recently modified eligible root SHALL be selected.

#### Scenario: Binding via the active sessions registry

- **WHEN** `active_sessions.json` lists a pid that is a descendant of the issued PTY
- **THEN** the corresponding journal binds even when that process does not hold `events.jsonl` open

#### Scenario: Several descendant pids listed in the registry

- **WHEN** `active_sessions.json` lists more than one pid that is a descendant of the issued PTY
- **THEN** an eligible primary journal for that tree still binds, and a non-primary journal is not selected as the root

#### Scenario: Two Grok terminals share one registry

- **WHEN** two issued PTYs each have a descendant pid listed in the same `active_sessions.json`
- **THEN** each terminal binds its own primary journal and neither row leaks into the other terminal

#### Scenario: Missing HOME in process environment

- **WHEN** a login shell omits `HOME` from process-environment observation
- **THEN** the live Grok journal is still admitted because home-relative containment is not required for writer proof

#### Scenario: Non-primary session relationship

- **WHEN** a journal's first `turn_started` reports a `session_relationship` other than `primary`
- **THEN** it is not an eligible root

#### Scenario: Foreign session id

- **WHEN** a `turn_started.session_id` differs from the bound provider session id
- **THEN** the record is ignored
