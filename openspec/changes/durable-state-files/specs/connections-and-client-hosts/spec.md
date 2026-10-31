## MODIFIED Requirements

### Requirement: Startup failure recovery

If workspace persistence cannot be read, validated, or first-run committed, Desktop SHALL stop any in-flight loading navigation and replace the loader with a host-owned recovery document rather than leaving Chromium pending or the window unpainted. If the renderer cannot bootstrap, it SHALL replace the loading state with a visible reload action.

When startup is stopped because a state file is corrupt and no valid previous copy exists, the recovery document SHALL name which state is affected in plain words, without file paths, and SHALL offer two actions: start that state fresh, and retry. Starting fresh SHALL keep the corrupt file aside, begin that state empty, and continue startup. Retry SHALL change nothing on disk. Desktop SHALL NOT start fresh without the user choosing it. When startup restored an earlier save instead, the restored workspace SHALL open and show a notice saying an earlier save was restored.

#### Scenario: Unreadable persistence shows recovery

- **WHEN** workspace persistence cannot be read or validated
- **THEN** in-flight loading navigation stops and a host-owned recovery document is shown

#### Scenario: Failed bootstrap offers reload

- **WHEN** the renderer cannot bootstrap
- **THEN** the loading state is replaced with a visible reload action

#### Scenario: User starts fresh

- **WHEN** the workspace file and its previous copy are both corrupt, and the user chooses to start fresh on the recovery document
- **THEN** both files are kept aside, the workspace opens empty, and startup completes

#### Scenario: Retry leaves files alone

- **WHEN** the user chooses Retry on that recovery document
- **THEN** no state file is moved, reset, or rewritten, and the same check runs again

#### Scenario: Earlier save restored

- **WHEN** startup restored the workspace from its previous copy
- **THEN** the workspace opens and a notice says an earlier save was restored
