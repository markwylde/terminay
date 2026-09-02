## ADDED Requirements

### Requirement: Visually distinct default project colours

A newly created project SHALL receive a default colour drawn from the project
colour palette that is as far as the palette allows from every colour already in
use by projects in the same workspace view, including colours reserved by
projects whose creation is still in flight. Selection SHALL maximise the
smallest hue distance to those in-use colours rather than take the first unused
palette entry. Where several palette entries are equally distant, the choice
SHALL be derived from the project's identity so that the same project in the
same workspace state always receives the same colour. A colour a user has chosen
explicitly, and a colour already persisted on a project, SHALL NEVER be
reassigned by this selection.

#### Scenario: Second project takes a far-apart hue
- **WHEN** a workspace view holds one project coloured red and the user creates a second project
- **THEN** the new project's default colour is the palette hue furthest from that red, not a neighbouring red or pink

#### Scenario: Colours spread as projects accumulate
- **WHEN** projects are created one after another in the same view
- **THEN** each new default colour is the palette hue whose smallest distance to the colours already in use is the largest available

#### Scenario: Palette exhausted
- **WHEN** every palette colour is already in use in the view and another project is created
- **THEN** the new project still receives the palette colour furthest from the colours in use, and creation succeeds

#### Scenario: Explicit colour is preserved
- **WHEN** a user sets a project's colour explicitly and later creates another project
- **THEN** the existing project keeps the colour the user chose and only the new project is assigned a default

#### Scenario: First project in an empty view
- **WHEN** the first project in a workspace view is created and no colours are in use
- **THEN** its default colour is derived from the project's identity, so different workspaces do not all start on the same hue
