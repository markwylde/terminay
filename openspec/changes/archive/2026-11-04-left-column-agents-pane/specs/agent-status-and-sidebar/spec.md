## MODIFIED Requirements

### Requirement: Agents pane presentation

The **Agents** pane SHALL be the content of the Agents tab of the project's left column. On a compact workspace, which presents no left column, it SHALL be the content of the compact switcher's Agents tab for the project in front. It SHALL NOT be a group or pane of the sidebar. It SHALL show the roots that belong to the current project on that project's own server, keyed by the pair of server and project, and SHALL nest children beneath them. Bound and external roots SHALL be listed together in one stable ordering, with external rows carrying the **External** marker. Rows SHALL use the existing tree geometry. Missing metadata SHALL be omitted. A generic terminal tab name SHALL NOT be used as the agent title: an untitled root SHALL use the harness label until the source reports a title. The harness label SHALL come from the source's declared harness display names, and the Agents UI SHALL NOT keep a hardcoded map of provider ids.

How an entry's display name, provider and model metadata, and prompt are resolved from a snapshot entry SHALL be one rule shared by every surface that presents an agent, so the same agent SHALL NEVER be named one thing in the Agents pane and another thing on another surface. A surface that presents agents outside one project SHALL apply that same rule rather than its own.

#### Scenario: Agents tab of the left column

- **WHEN** a project renders at or above the narrow layout breakpoint with its left column visible and a user selects the Agents tab
- **THEN** the Agents pane fills the left column, and the sidebar offers no Agents group

#### Scenario: Agents tab of the compact switcher

- **WHEN** a user opens the compact switcher with a project in front and selects its Agents tab
- **THEN** the switcher shows that project's Agents pane with the same roots, children, names, and ordering the left column shows for it

#### Scenario: Root in another project

- **WHEN** a session's working directory is outside the current project and its repository worktrees, and it is not bound to one of the project's terminals
- **THEN** it is not shown in the current project's Agents pane

#### Scenario: Untitled root

- **WHEN** a root has no reported title
- **THEN** it displays the harness display name rather than a generic terminal tab name

#### Scenario: Same project id on another attached server

- **WHEN** another attached server holds a project whose id equals the current project's id and has a root
- **THEN** that root is not shown in the current project's Agents pane

#### Scenario: One agent on two surfaces

- **WHEN** the same bound root is presented in the Agents pane and on a surface that spans projects
- **THEN** both resolve the same display name, the same provider and model metadata, and the same prompt from the same entry
