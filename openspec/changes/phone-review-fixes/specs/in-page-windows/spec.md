## MODIFIED Requirements

### Requirement: One frame for every in-page window

Every window or dialog that Terminay presents inside the page SHALL be drawn in one shared frame: a title bar that shows the window's title and a close button at its trailing end, above a body that holds the window's content. The frame SHALL supply the border, corner radius, shadow, and backdrop, and a window's content SHALL NOT draw a second frame, a second title, or its own close control. This applies to Settings, Macros, Recordings, Remote Control, About, Edit Tab, Edit Project, MCP install, remote pairing, worktree sign-in, and the application update dialog. Confirmation prompts, the Command Bar, and the compact edge drawers — the compact switcher and the Home options panel — are not in-page windows.

#### Scenario: Settings in a browser

- **WHEN** a user opens Settings on a host without native windows
- **THEN** it appears in the shared frame with a title bar reading "Settings" and a close button, and the content shows no second "Settings" heading or "Close" button

#### Scenario: About

- **WHEN** a user opens About Terminay on a host without native windows
- **THEN** it appears in the shared frame with a title bar and a close button, and the close button does not overlap the artwork

#### Scenario: Editing a tab or project

- **WHEN** a user opens Edit Tab or Edit Project in the page
- **THEN** it appears in the shared frame with a title bar naming what is being edited and a close button

#### Scenario: A small dialog

- **WHEN** the MCP install, remote pairing, worktree sign-in, or application update dialog opens
- **THEN** it appears in the shared frame, identical in title bar, border, radius, shadow, and backdrop to every other in-page window

#### Scenario: Home options panel is not a window

- **WHEN** the Home options panel opens on a phone
- **THEN** it is drawn as an edge drawer beside a visible strip of the page, without filling the viewport and without move, resize, or maximise affordances
