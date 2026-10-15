## MODIFIED Requirements

### Requirement: Fallback activity display language

Terminal fallback activity SHALL use the existing tab-activity language: amber or yellow for working or recent activity, green for finished unviewed activity, red for fallback attention, and no indicator after acknowledgement. Working indicators SHALL remain while the terminal is working, including on the focused tab. Finished and attention indicators SHALL be unviewed signals and SHALL NOT remain once the terminal is viewed. Canonical agent RAG indicators SHALL use the same colour vocabulary and the same viewing rule: an agent's operational state and its acknowledgement flag are separate, viewing an agent acknowledges it, and a viewed `done` root becomes `idle` exactly as a viewed finished terminal loses its green indicator. Viewing SHALL NOT change `working`, `waiting`, `blocked`, or `idle`.

#### Scenario: Working fallback activity

- **WHEN** a terminal has fallback working or recent activity
- **THEN** its tab shows the amber or yellow indicator

#### Scenario: Working on the focused tab

- **WHEN** the focused terminal is working
- **THEN** its tab keeps the amber or yellow indicator

#### Scenario: Viewing an agent

- **WHEN** a user views a terminal with a canonical agent entry
- **THEN** the agent is acknowledged, a `done` root becomes `idle`, and any other operational state is unchanged

### Requirement: Activity settings

Existing tab-indicator settings SHALL govern every terminal's tab, project, and header activity indicators alike, whether the state comes from fallback activity or from a canonical agent: **Show indicator for active tabs** governs working, **Show indicator for finished tabs** governs done, and a terminal's own **Activity indicators** switch hides all of them for that terminal. An agent's `working` SHALL be treated as active, its `done` as finished, and its `waiting` and `blocked` as attention. These settings SHALL NOT change canonical agent state or what the Agents pane shows. **Use terminal signals for activity** enables structured-signal detection, **Progress signal timeout** controls `OSC 9;4` staleness, and the timing settings control fallback activity. Disabling terminal-signal detection SHALL restore raw-output-based terminal activity and SHALL NOT change the **Agent status and sidebar** setting, provider lifecycle journals, or canonical agent status. The persisted **Agent status and sidebar** setting SHALL govern the agent feature as a whole, including journal discovery and its status surfaces, independently of the terminal-fallback settings. A pending MCP approval SHALL always show on its terminal's tab.

#### Scenario: Terminal-signal detection disabled

- **WHEN** a user disables **Use terminal signals for activity**
- **THEN** raw-output-based terminal activity is used
- **AND** journal-backed agent status remains unaffected

#### Scenario: Progress timeout changed

- **WHEN** a user changes **Progress signal timeout**
- **THEN** `OSC 9;4` staleness uses the new value

#### Scenario: Independent agent setting

- **WHEN** the **Agent status and sidebar** setting is changed
- **THEN** journal discovery and agent status surfaces change without altering the terminal-fallback settings

#### Scenario: Finished indicators off for an agent

- **WHEN** **Show indicator for finished tabs** is off and a background terminal's agent root becomes `done`
- **THEN** its tab shows no green indicator and neither its project badge nor the header Notifications number counts it, exactly as for a plain terminal that finishes
- **AND** the Agents pane still shows the root as `done`

#### Scenario: Active indicators off for an agent

- **WHEN** **Show indicator for active tabs** is off and a terminal's agent root is `working`
- **THEN** its tab shows no working indicator and its project badge and the header do not count it as working

#### Scenario: A terminal's own indicators off

- **WHEN** a terminal's **Activity indicators** switch is off and its agent root is `waiting`
- **THEN** its tab, its project badge, and the header show no indicator for it

#### Scenario: MCP approval with indicators off

- **WHEN** a terminal's indicators are off and an MCP approval is pending for it
- **THEN** its tab still shows the approval indicator
