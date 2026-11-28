## MODIFIED Requirements

### Requirement: Build progress notice

While a bot image build is running, or after one has ended, the Bots surfaces SHALL show a compact notice naming its state, except where a completed build's image has been acknowledged. Activating the notice SHALL open the build's progress as a sheet over the workspace, closable by its close control, by Escape, or by clicking outside it, and SHALL keep the rest of the workspace in place.

The notice for a completed build SHALL carry a dismiss control. Activating it SHALL acknowledge the built image. Once a completed build's notice has been on screen, leaving that surface SHALL retire it, which also acknowledges the image. A failed or interrupted build's notice SHALL NOT be dismissible.

The Terminay Server SHALL own acknowledgements. An image is identified by the container engine that holds it and its image fingerprint (its build inputs), never by the build that produced it. An acknowledgement SHALL hold across visits, reloads, server restarts and every client of that server, and SHALL NOT depend on storage on the viewing device. While an image's acknowledgement is retained, a completed build of it SHALL show no notice, however many times it is rebuilt. A completed build of any other image SHALL show it. The server SHALL retain the 32 most recently acknowledged images, discarding the oldest acknowledgement first; acknowledging an already acknowledged image changes nothing. An acknowledgement SHALL count only once it is durably saved: if saving fails, the request fails and the image stays unacknowledged. Connected clients SHALL drop the notice when the image is acknowledged, without polling.

Acknowledging SHALL require bot authority. The server SHALL take the image's identity from its own record of the named build; a request naming a build that is not its latest completed build SHALL acknowledge nothing. A client SHALL hide the notice as soon as the user dismisses it. A client SHALL send the acknowledgement at the moment of dismissal or retirement, including when the surface that showed the notice is gone. If the server did not record it, a client that is still open SHALL send it again when a notice for that build next reads engine status.

#### Scenario: Dismissing a ready image

- **WHEN** the notice reads "Bot image ready" and the user activates its dismiss control
- **THEN** the notice is removed and does not return after a reload

#### Scenario: A device that keeps no storage

- **WHEN** a user dismisses the ready notice and then opens Bots from a client with empty browser storage, or from another device
- **THEN** the notice is not shown

#### Scenario: Another open client

- **WHEN** two clients show the ready notice and the user dismisses it on one
- **THEN** the notice is removed from the other

#### Scenario: The same image is rebuilt

- **WHEN** an acknowledged image is built again with the same fingerprint on the same engine and the build completes
- **THEN** no "Bot image ready" notice is shown

#### Scenario: A new image is built

- **WHEN** a build with a different fingerprint, or on a different engine, completes after an earlier image was acknowledged
- **THEN** the notice reads "Bot image ready"

#### Scenario: Retired by leaving, then reloaded

- **WHEN** the ready notice has been shown, the user leaves the Bots surface, and the client reloads without returning to it first
- **THEN** the notice is not shown when the user next opens Bots

#### Scenario: A moved notice is not left

- **WHEN** the ready notice moves between layouts as the window crosses the compact width
- **THEN** it stays shown and no image is acknowledged

#### Scenario: An old acknowledgement is discarded

- **WHEN** a thirty-third image is acknowledged and the first is later built again
- **THEN** the first image's ready notice is shown

#### Scenario: The acknowledgement cannot be saved

- **WHEN** the server cannot save an acknowledgement
- **THEN** the request fails, no change is published, and a later request can record it

#### Scenario: Server restart

- **WHEN** the server restarts after a ready image was acknowledged
- **THEN** the notice is not shown for that image

#### Scenario: A rebuild fails

- **WHEN** a build of an acknowledged image runs and then fails
- **THEN** the running notice and then the failure notice are shown

#### Scenario: A stale acknowledgement

- **WHEN** a client asks to acknowledge a build the server has since replaced
- **THEN** no image is acknowledged

#### Scenario: The server did not record it

- **WHEN** the user dismisses the notice while the acknowledgement cannot reach the server
- **THEN** the notice stays hidden in that client, which sends the acknowledgement again when it next reads engine status

#### Scenario: Seen and left

- **WHEN** the "Bot image ready" notice has been shown and the user moves to another section and back
- **THEN** the notice is no longer shown

#### Scenario: A failure stays

- **WHEN** an image build has failed
- **THEN** its notice offers no dismiss control and still opens the progress sheet with Retry build
