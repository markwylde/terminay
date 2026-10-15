## MODIFIED Requirements

### Requirement: The main window outlives its last project

Closing the last project in the window that presents a workspace's first view SHALL NOT close that window. The window SHALL stay open with no project and SHALL show Home, and the workspace view SHALL remain, holding no project. While a window holds no project it SHALL show Home whatever Home selection it remembers, and project-scoped commands SHALL act on nothing. Creating a project from such a window SHALL create it awaiting a start choice, SHALL leave Home, and SHALL show that project's start chooser. Closing the last project in a window presenting any other view SHALL close that window as before.

#### Scenario: Closing the only project

- **WHEN** a user closes the only project in the main window
- **THEN** the window stays open, no project tab is shown, and Home is selected

#### Scenario: A project from an empty window

- **WHEN** a user creates a project in a window that holds none
- **THEN** it is created awaiting a start choice, Home is left, and the project's start chooser is shown with its first start action focused

#### Scenario: A popped-out window

- **WHEN** a user closes the last project in a popped-out window
- **THEN** that window closes
