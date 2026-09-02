## ADDED Requirements

### Requirement: Header activity dropdown count badges are fixed-size circles

The header activity dropdown button SHALL present up to three count badges, one each for attention, finished unviewed, and working terminals, each shown only when its count is above zero. Every count badge SHALL be a circle of one fixed size regardless of the number it displays, with the number centred both vertically and horizontally. The font size SHALL step down as the digit count grows so the circle never widens, and counts above 99 SHALL display as `99+`. The project tab activity count badge SHALL share the same circle size and text treatment so the two surfaces look identical.

#### Scenario: Single digit

- **WHEN** one terminal has finished unviewed activity
- **THEN** the dropdown shows one green circular badge reading `1`, with the text centred and the badge width equal to its height

#### Scenario: Two digits keep the same circle

- **WHEN** twelve terminals are working
- **THEN** the amber badge reads `12` in a smaller font and its width still equals its height

#### Scenario: Count capped at 99+

- **WHEN** more than 99 terminals have finished unviewed activity
- **THEN** the green badge reads `99+` and its width still equals its height
