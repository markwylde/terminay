## ADDED Requirements

### Requirement: The explorer is undisturbed by unrelated workspace changes

A folder's explorer tree, its expanded directories, its file watches, and its Git decoration SHALL be reloaded only when that folder's root, its project, or its connection changes, when a watch reports a change, or when a person asks. A workspace change that leaves those the same SHALL NOT clear or re-list the tree, close or re-open a watch, re-make the Git status subscription, or ask the server to measure Git.

#### Scenario: A terminal's title changes

- **WHEN** a terminal's displayed title changes while a folder's explorer is open
- **THEN** the tree keeps its listing and expanded directories, no directory is listed, no watch is re-opened, and no Git measurement is requested

#### Scenario: A panel changes in the same project

- **WHEN** a terminal in the explorer's own project is renamed, moved between folders, or closed
- **THEN** the explorer tree is not re-listed and no Git measurement is requested

#### Scenario: The root changes

- **WHEN** the folder's root changes
- **THEN** the tree is listed again from the new root and Git is measured for it
