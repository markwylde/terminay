## ADDED Requirements

### Requirement: Pixel dock on a compact workspace

On a compact workspace at 640px or narrower, Pixel's dock SHALL sit on the trailing edge of the compact chrome row, in the place of the connection control, whether or not the status bar is shown. Pixel SHALL NOT be docked in the bottom-right corner or in the status bar at that width. The dock SHALL keep the same state, accessible name and activation it has elsewhere, and returning Pixel to its dock SHALL return it to the row.

#### Scenario: Pixel on a phone

- **WHEN** Pixel is on and the workspace is 390px wide
- **THEN** Pixel's dock is the trailing control of the compact chrome row, and no Pixel is docked in the corner

#### Scenario: Opening Pixel from the header

- **WHEN** a user presses Pixel's dock on the compact chrome row
- **THEN** Pixel comes out with its chat balloon open
