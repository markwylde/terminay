## ADDED Requirements

### Requirement: Compact breadcrumb disclosure placement

The compact breadcrumb's disclosure chevron SHALL sit on the trailing edge of
the pill, after every label segment and after any free space the pill holds, so
it reads as the control's dropdown affordance rather than as another crumb
after the terminal title. The chevron SHALL keep its position as titles change
length, and the label segments SHALL absorb the remaining width, truncating the
project name before the terminal title as they already do.

#### Scenario: Chevron on the trailing edge

- **WHEN** a compact workspace draws the project-and-terminal breadcrumb
- **THEN** the chevron sits against the pill's trailing edge with the label
  segments taking the space before it

#### Scenario: Short titles leave the chevron where it is

- **WHEN** the active terminal's title is short enough that the breadcrumb has
  free space
- **THEN** the free space falls between the terminal title and the chevron, and
  the chevron stays on the trailing edge

### Requirement: Panel tab close control placement

A panel tab's close control SHALL sit at the trailing edge of that tab, after
the title, with its trailing inset matching the inset the title has at the
leading edge so that the `×` is optically balanced with the label. The control
SHALL keep its own hit target rather than shrinking to the glyph.

#### Scenario: Close sits opposite the title

- **WHEN** a panel tab is drawn
- **THEN** its close control sits at the trailing edge with the same inset the
  title has at the leading edge

#### Scenario: Active tab is not a special case

- **WHEN** a panel tab is the active, solid chip
- **THEN** its close control sits at the same trailing inset as an inactive
  tab's, so the chip shows no extra gap after the `×`
