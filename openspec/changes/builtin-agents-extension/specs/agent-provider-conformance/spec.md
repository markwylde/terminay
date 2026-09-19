## MODIFIED Requirements

### Requirement: Provider capability matrix

Terminay SHALL publish, in the built-in agents extension's documentation, the capability matrix of the pinned `@markwylde/all-your-agents` version for each harness it reports. The matrix SHALL cover live detection, status, titles, model, subagents, and waiting-for, together with every partial or unsupported cell and its reason as the library states it. Terminay SHALL NOT claim a capability for a harness beyond what that library version claims. Updating the pinned library version SHALL update the published matrix in the same change.

#### Scenario: Every cell has a verdict

- **WHEN** the built-in agents extension reports a harness
- **THEN** its documentation carries that harness's row from the pinned library's matrix, including stated limitations

#### Scenario: Library upgraded

- **WHEN** the pinned library version changes
- **THEN** the published matrix is updated in the same change

#### Scenario: Provider outside the matrix

- **WHEN** a third-party session source reports a harness
- **THEN** Terminay asserts no capability matrix for it

### Requirement: Running end-to-end proof of the Agents pane

Every harness the built-in agents extension reports SHALL have Electron end-to-end coverage in the running application. That coverage SHALL drive the library's fixture drivers against a test-only provider home to create sessions, and SHALL assert the resulting rows in the Agents pane. It SHALL run on every ordinary end-to-end run without real-CLI credentials. The coverage SHALL include:

- a session owned by a process inside a Terminay terminal, which binds to that terminal
- a session in a subdirectory of the project
- a session in a linked worktree outside the project root
- a session outside the project, which is not shown
- a session owned by a process outside every Terminay terminal, which is shown as External

#### Scenario: Ordinary end-to-end run

- **WHEN** the end-to-end suite runs without any real-CLI credential gate set
- **THEN** the Agents-pane coverage for every reported harness runs

#### Scenario: Bound, worktree, external, and unrelated sessions

- **WHEN** fixture sessions are created in a terminal of the project, in a linked worktree, outside every terminal, and in an unrelated directory
- **THEN** the Agents pane shows the first bound to its terminal, the second and third, the third marked External, and not the fourth

#### Scenario: Two terminals in the application

- **WHEN** two terminals of one project each own a fixture session of the same harness, and the provider home already holds an earlier session
- **THEN** the Agents pane shows one row bound to each terminal, and neither row is the earlier session

#### Scenario: Stub writes the per-process record

- **WHEN** a harness records which session a process holds
- **THEN** the fixture writes that record with the real pid of a process inside the terminal, as the CLI does

#### Scenario: Resumed terminal beside a live one

- **WHEN** a fixture reopens the earlier session from one terminal while another terminal's session is live
- **THEN** the resumed terminal's row is the resumed session and the live terminal's row is unchanged

#### Scenario: Extension without application coverage

- **WHEN** a reported harness has no Agents-pane coverage
- **THEN** it is treated as unverified at the application surface

## REMOVED Requirements

### Requirement: Journal-derived inference

**Reason**: Terminay no longer infers state. Status comes from the detection library.
**Migration**: None.

### Requirement: Detect capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Title capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Idle capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Working capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Waiting capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Blocked capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Done capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Subagent enumeration capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Subagent status capability

**Reason**: Capability verification belongs to the detection library.
**Migration**: See the library's compatibility matrix.

### Requirement: Resume capability

**Reason**: A resumed session is an ordinary live session reported by the library.
**Migration**: None.

### Requirement: Real-CLI conformance verification

**Reason**: Real-CLI verification belongs to the detection library's own suite. The Terminay harness and its CI workflow are removed.
**Migration**: None.

### Requirement: Shared conformance harness

**Reason**: The Terminay real-CLI harness is removed.
**Migration**: None.

### Requirement: Inference tuning is evidence-based

**Reason**: Terminay has no inference rules.
**Migration**: None.

### Requirement: Fixture parity with observed provider behaviour

**Reason**: Terminay fixtures are the detection library's own fixture drivers, which the library keeps faithful to each harness.
**Migration**: None.
