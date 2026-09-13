## MODIFIED Requirements

### Requirement: Agents pane presentation

The **Agents** pane SHALL be the Agents sidebar group's collapsible pane. It SHALL show only roots whose exact activation terminal belongs to the current project on that project's own server, keyed by the pair of server and project, and SHALL nest children beneath them. Rows SHALL use stable ordering and the existing tree geometry. Missing metadata SHALL be omitted and prompts SHALL be bounded. A generic terminal tab name SHALL NOT be used as the agent title: an untitled bound root SHALL use the provider label until a provider title, custom terminal name, or prompt is available. The provider label SHALL be the extension contribution `displayName`, and the Agents UI SHALL NOT keep a hardcoded map of provider ids.

How an entry's display name, provider and model metadata, and prompt are resolved from a snapshot entry SHALL be one rule shared by every surface that presents an agent, so the same agent SHALL NEVER be named one thing in the Agents pane and another thing on another surface. A surface that presents agents outside one project SHALL apply that same rule rather than its own.

#### Scenario: Root in another project

- **WHEN** a bound root's activation terminal belongs to a different project
- **THEN** it is not shown in the current project's Agents pane

#### Scenario: Untitled root

- **WHEN** a bound root has no provider title, custom terminal name, or prompt
- **THEN** it displays the provider's extension contribution `displayName` rather than a generic terminal tab name

#### Scenario: Same project id on another attached server

- **WHEN** another attached server holds a project whose id equals the current project's id and has a bound root
- **THEN** that root is not shown in the current project's Agents pane

#### Scenario: One agent on two surfaces

- **WHEN** the same bound root is presented in the Agents pane and on a surface that spans projects
- **THEN** both resolve the same display name, the same provider and model metadata, and the same prompt from the same entry
