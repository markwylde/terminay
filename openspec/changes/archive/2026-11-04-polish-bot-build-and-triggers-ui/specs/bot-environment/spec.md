## ADDED Requirements

### Requirement: Build progress notice

While a bot image build is running, or after one has ended, the Bots surfaces SHALL show a compact notice naming its state. Activating the notice SHALL open the build's progress as a sheet over the workspace, closable by its close control, by Escape, or by clicking outside it, and SHALL keep the rest of the workspace in place.

The notice for a completed build SHALL carry a dismiss control. Once a completed build's notice has been on screen, leaving that surface SHALL retire it, so that coming back does not show it again. A dismissed or retired notice SHALL return only for a different build or a different build state. A failed or interrupted build's notice SHALL NOT be dismissible.

#### Scenario: Dismissing a ready image

- **WHEN** the notice reads "Bot image ready" and the user activates its dismiss control
- **THEN** the notice is removed and does not return after a reload

#### Scenario: Seen and left

- **WHEN** the "Bot image ready" notice has been shown and the user moves to another section and back
- **THEN** the notice is no longer shown

#### Scenario: A failure stays

- **WHEN** an image build has failed
- **THEN** its notice offers no dismiss control and still opens the progress sheet with Retry build
