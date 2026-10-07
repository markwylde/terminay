## MODIFIED Requirements

### Requirement: Pending project tab during creation

Creating a project SHALL immediately add a non-active pending tab with the future project label and a spinning project icon, bound to the server chosen to own it and showing that server when more than one connection is attached. Validation, canonical project creation, terminal launch, and terminal hydration SHALL happen behind that tab without covering or replacing the active project, which SHALL remain usable. When the terminal is ready, Terminay SHALL activate and focus the new project only if the user has not selected another project since creation began; if the user has moved elsewhere, the ready project SHALL remain in the background. A creation failure SHALL activate the pending tab and present its error there.

A creation interrupted by loss of the connection SHALL NOT fail. The pending tab SHALL keep its spinning icon while the connection recovers; once the workspace has resynchronised, Terminay SHALL continue with the project if the server has it and SHALL send the creation again if it does not. Creation SHALL fail only when the server refuses it or when recovery itself gives up, and SHALL never yield two projects for one request.

A failed pending tab SHALL NOT hold the rest of the window. Every other project tab and Home SHALL remain selectable and usable while it exists, and selecting one SHALL show that project. The `+` control SHALL remain usable, and starting another creation SHALL replace the failed pending tab. The failed pending tab SHALL offer a retry action, which starts the same creation again in place, and SHALL be dismissible by its close control.

#### Scenario: Creation begins
- **WHEN** a user starts creating a project
- **THEN** a non-active pending tab with the future label and a spinning icon appears while the active project stays usable

#### Scenario: Creation completes with no user navigation
- **WHEN** the new terminal becomes ready and the user has not selected another project
- **THEN** the new project is activated and focused

#### Scenario: User moved elsewhere
- **WHEN** the new terminal becomes ready but the user has since selected another project
- **THEN** the ready project stays in the background

#### Scenario: Creation fails
- **WHEN** project creation fails
- **THEN** the pending tab is activated and the error is presented there

#### Scenario: Pending tab names its server
- **WHEN** a project is created on an attached server while more than one connection is attached
- **THEN** the pending tab shows that server

#### Scenario: Connection lost before the server created the project
- **WHEN** the connection is lost while a project is being created, the workspace reconnects, and the server does not have the project
- **THEN** the pending tab keeps spinning, the creation is sent again, and exactly one project results

#### Scenario: Connection lost after the server created the project
- **WHEN** the connection is lost while a project is being created, the workspace reconnects, and the server already has the project
- **THEN** the pending tab keeps spinning, the creation is not sent again, and the project's terminal is launched

#### Scenario: Selecting another project while a creation has failed
- **WHEN** a pending tab shows a failed creation and the user selects another project tab
- **THEN** that project is shown and is usable, and the failed pending tab stays in the tab bar

#### Scenario: Creating again while a creation has failed
- **WHEN** a pending tab shows a failed creation and the user uses the `+` control
- **THEN** a new creation starts and its pending tab replaces the failed one

#### Scenario: Retrying a failed creation
- **WHEN** the user chooses retry on a failed pending tab
- **THEN** the tab returns to its spinning state and the same creation runs again
