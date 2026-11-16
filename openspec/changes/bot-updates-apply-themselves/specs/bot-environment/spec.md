## MODIFIED Requirements

### Requirement: The bot image is built locally

Every bot SHALL run from one image, `terminay-bot:local`. The server SHALL build it on its own machine from a Dockerfile that ships with Terminay, and SHALL NEVER pull a prebuilt bot image.

The image SHALL contain:

- a desktop served over password-protected VNC;
- a browser;
- common developer tools;
- the `docker` command line;
- the Terminay session launcher and home-volume helper;
- the pinned native CLI of every contributed bot agent supported by the server native-driver contract.

The desktop SHALL open Chromium automatically on its own display when it starts, as the unprivileged `bot` user with the browser sandbox enabled. The browser SHALL be owned by the desktop lifecycle, independently of agent sessions and tool commands. A new browser profile SHALL open a blank page without first-run prompts.

On Linux, the image's `bot` user SHALL have the user and group ids of the server account.

The image SHALL carry a fingerprint of its inputs: the browser seccomp profile, the Dockerfile, its `.dockerignore`, the build-context files its COPY and ADD instructions read (contents and executable bit), the agent installs, and the `bot` user and group ids. Other files beside the Dockerfile SHALL NOT change the fingerprint. A COPY or ADD source the server cannot resolve to literal context paths SHALL fail the image plan rather than be left out of the fingerprint. Build progress and the build log SHALL be shown. A failed build SHALL keep the previous image and SHALL show the step that failed.

#### Scenario: First start

- **WHEN** a user starts the first bot on a machine that has no bot image
- **THEN** the image is built from the shipped Dockerfile with progress shown, and then the bot's container starts

#### Scenario: New agent installed

- **WHEN** an extension that contributes a bot agent is installed
- **THEN** the image is shown as out of date, and that agent is shown as not installed in the bot image until a rebuild completes

#### Scenario: Build fails

- **WHEN** an image rebuild fails while installing a bot agent's native CLI
- **THEN** the previous image is kept and the build log shows the failing step

#### Scenario: Files the image is not built from

- **WHEN** a file beside the Dockerfile that no COPY or ADD instruction reads changes
- **THEN** the image fingerprint is unchanged and no container becomes out of date

#### Scenario: Unreadable copy source

- **WHEN** the Dockerfile copies a glob, an absolute path, a path outside the context, or uses the JSON or heredoc form
- **THEN** the image plan fails and no image is built from it

### Requirement: Containers follow the current image

A bot's container is out of date when it was made from a different image fingerprint, or under a different AppArmor choice, than the server would give a new container now. When the current fingerprint or AppArmor choice cannot be determined, the container SHALL NOT be treated as out of date.

An out-of-date container SHALL be updated as follows:

- if it is stopped, it SHALL be recreated from the current image when it next starts, including by Restart;
- if it is running and a run is about to start while that run is the bot's only running session and no shell or desktop is open (the desktop preview beside Chat does not count), the current image SHALL first be built if needed, and the container SHALL then be recreated from it before the run, without stopping that run and without asking for confirmation;
- if that build fails, the bot SHALL keep its running container, the run SHALL proceed on it, and the failure SHALL be shown on the image;
- otherwise it SHALL keep running, and its Environment › Overview SHALL show that an update is ready and installs before its next run, with **Update now**, which recreates the container when the user chooses to.

Recreating a container SHALL create it with the bot's current resource limits, so a pending limits change is applied by any recreation. The update notice SHALL be derived from the bot's own container, never from whether the shared image is out of date. An image that is only out of date SHALL NOT be presented as a container engine problem. The engine status SHALL be shown above a bot's Chat and Configure panels only when the engine is unavailable or the image is missing or failed to build.

When the user chooses Recreate or Update now for a running bot whose session is running, Terminay SHALL first ask the user to confirm, and SHALL then stop that session. Recreating SHALL succeed when one of the bot's containers is already being removed by the engine, and SHALL fail without creating a new container when an old one cannot be removed.

#### Scenario: Rebuilt while stopped

- **WHEN** the image is rebuilt while a bot is stopped and the bot then starts
- **THEN** its container is recreated from the new image and its home is unchanged

#### Scenario: Rebuilt while running and idle

- **WHEN** the image is rebuilt while a bot is running with no shell or desktop open, and a run then starts
- **THEN** its container is recreated from the new image before the run, its home is unchanged, and the run proceeds without being stopped or asking for confirmation

#### Scenario: Rebuilt while running

- **WHEN** the image is rebuilt while a bot is running with its shell or desktop open, or with another run in progress
- **THEN** the bot keeps running on its old container, its Overview shows that an update is ready with Update now, and no container engine card is shown

#### Scenario: Chat open with its desktop preview

- **WHEN** a user sends a message from a bot's Chat, whose context rail shows the desktop preview, while the bot's running container is out of date and no shell or desktop is open
- **THEN** the container is recreated from the current image before the run, and the preview reconnects to the new container

#### Scenario: Update build fails

- **WHEN** an idle running bot's container is out of date, a run starts, and the image build fails
- **THEN** the run proceeds on the old container, the bot is not marked failed, and the image shows its build failure

#### Scenario: Another bot already rebuilt the image

- **WHEN** one bot's start has rebuilt the shared image and a second bot is still running on a container from the old image
- **THEN** the second bot's Overview still shows that an update is ready

#### Scenario: AppArmor choice changed

- **WHEN** the server's AppArmor choice for new containers changes while a bot runs on a container made under the old choice
- **THEN** the bot's container is out of date and is updated as above

#### Scenario: Restart applies an update

- **WHEN** a user restarts a running bot whose container is out of date
- **THEN** the container is stopped, recreated from the current image, and started, with its home unchanged

#### Scenario: Pending limits applied by an update

- **WHEN** a bot has a pending limits change and its container is recreated by an update
- **THEN** the new container runs with the new limits and the pending-limits notice disappears

#### Scenario: Recreate while Files is open

- **WHEN** a user recreates a bot while its Files tab is open
- **THEN** the Files helper is closed, the container is recreated from the current image, and no conflict is reported
