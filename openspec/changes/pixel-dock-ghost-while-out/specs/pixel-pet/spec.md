## ADDED Requirements

### Requirement: Dock ghosts while Pixel is out

While Pixel is out of its dock, from the moment it leaves the dock until it has returned to it, the dock SHALL show a dim, ghosted Pixel icon. Once Pixel has returned to its dock, the dock SHALL show the full Pixel icon. This SHALL hold for every dock Pixel uses. The ghosting SHALL NOT hide the dock's working or attention indicator, change its accessible name, or change what activating it does.

#### Scenario: Pixel leaps out of the status bar

- **WHEN** the user clicks the docked Pixel in the status bar
- **THEN** the status bar shows a ghosted Pixel icon while Pixel is out on the workspace

#### Scenario: Pixel returns to the status bar

- **WHEN** Pixel is out and the user closes its balloon
- **THEN** Pixel returns to the status bar and the status bar shows the full Pixel icon again
