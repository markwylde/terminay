## MODIFIED Requirements

### Requirement: Pixel presence and docking

While Pixel is on, every workspace client attached to the server SHALL show Pixel, the CRT-terminal character from `@markwylde/pet`. This applies in the desktop, browser and phone layouts. While docked, Pixel SHALL appear as a small static Pixel icon in its dock:

- the status bar's Pixel slot when the status bar is shown;
- a small icon in the bottom-right corner of the workspace when the status bar is hidden and the workspace is wider than 640px; on a compact workspace at 640px or narrower, the dock is on the compact chrome row, just before the sidebar toggle.

Activating the dock SHALL bring the animated Pixel out onto the workspace with its chat balloon open. Closing the balloon, or leaving Pixel idle with the balloon closed for a short fixed period, SHALL send Pixel back into its dock. Pixel's on-screen position and balloon size SHALL be device-local presentation and SHALL NOT be shared between clients. Under reduced motion, Pixel SHALL play only its calm resting idle and appear without flight.

#### Scenario: Clicking Pixel in the status bar

- **WHEN** the user clicks the docked Pixel in the status bar
- **THEN** Pixel flies out of the status bar onto the workspace and its chat balloon opens

#### Scenario: Closing the chat

- **WHEN** Pixel is out with its balloon open and the user closes the balloon
- **THEN** Pixel returns to its dock

#### Scenario: Status bar hidden on a phone

- **WHEN** the workspace renders in the compact layout with the status bar hidden
- **THEN** Pixel docks on the compact chrome row and activating it brings Pixel out

### Requirement: Pixel dock on a compact workspace

On a compact workspace at 640px or narrower, Pixel's dock SHALL sit on the compact chrome row between the Notifications control and the sidebar toggle, whether or not the status bar is shown. Pixel SHALL NOT be docked in the bottom-right corner or in the status bar at that width. The dock SHALL keep the same state, accessible name and activation it has elsewhere, and returning Pixel to its dock SHALL return it to the row.

#### Scenario: Pixel on a phone

- **WHEN** Pixel is on and the workspace is 390px wide
- **THEN** Pixel's dock is on the compact chrome row just before the sidebar toggle, and no Pixel is docked in the corner

#### Scenario: Opening Pixel from the header

- **WHEN** a user presses Pixel's dock on the compact chrome row
- **THEN** Pixel comes out with its chat balloon open
