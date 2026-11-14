## MODIFIED Requirements

### Requirement: Containers follow the current image

A container whose fingerprint differs from the current image, or whose AppArmor label differs from the one the server would now give a new bot container, SHALL be updated as follows:

- if it is stopped, it SHALL be recreated from the current image, under the current AppArmor choice, when it next starts;
- if it is running, its bot SHALL show **Recreate to update**, and the container SHALL be recreated only when the user chooses to.

Recreating a running bot whose session is running SHALL first ask the user to confirm, and SHALL then stop that session. A container without an AppArmor label SHALL be treated as created under the engine default.

#### Scenario: Rebuilt while stopped

- **WHEN** the image is rebuilt while a bot is stopped and the bot then starts
- **THEN** its container is recreated from the new image and its home is unchanged

#### Scenario: Rebuilt while running

- **WHEN** the image is rebuilt while a bot is running
- **THEN** the bot keeps running on its old container and shows Recreate to update

#### Scenario: Profile available while stopped

- **WHEN** the server would now use `terminay-bot`, a stopped bot's container was created under the engine default, and the bot then starts
- **THEN** its container is recreated under `terminay-bot` and its home is unchanged

#### Scenario: Profile available while running

- **WHEN** the server would now use `terminay-bot` and a running bot's container was created under the engine default
- **THEN** the bot keeps running and shows Recreate to update

#### Scenario: Profile gone while stopped

- **WHEN** the server would now use the engine default, a stopped bot's container is labelled `terminay-bot`, and the bot then starts
- **THEN** its container is recreated under the engine default and its home is unchanged

## ADDED Requirements

### Requirement: Bot containers under the host's AppArmor

When the bot engine is Docker and reports AppArmor enabled, the server SHALL decide, once per server process and before creating or checking a bot container, which AppArmor profile bot containers use, by running short-lived containers from the bot image as the bot user, under the bot seccomp profile, with no network:

- if one can create a user namespace under the engine default profile, bot containers SHALL use the engine default;
- otherwise, if one can create a user namespace under `--security-opt apparmor=terminay-bot`, bot containers SHALL use `terminay-bot`;
- otherwise bot containers SHALL use the engine default, and the desktop browser's log SHALL begin with a line stating that user namespaces are refused in the container and the host has no `terminay-bot` AppArmor profile, and naming `sudo terminay daemon upgrade` and the documented manual load as the fix.

On Podman, or on an engine that does not report AppArmor, the server SHALL NOT probe and SHALL use the engine default. The server SHALL NOT write AppArmor policy, SHALL NOT create bot containers unconfined, SHALL NOT add `CAP_SYS_ADMIN`, and SHALL NOT run the desktop browser with its sandbox disabled.

#### Scenario: Sandboxed browser on an AppArmor host

- **WHEN** a bot starts on a Docker engine whose default profile refuses user namespaces and whose host has the `terminay-bot` profile loaded
- **THEN** its container runs under `terminay-bot`, and the desktop's Chromium starts with its sandbox enabled

#### Scenario: Default profile already allows user namespaces

- **WHEN** a bot starts on a Docker engine with AppArmor whose default profile lets the container create a user namespace
- **THEN** its container runs under the engine default

#### Scenario: Profile not loaded

- **WHEN** a bot starts on a Docker engine whose default profile refuses user namespaces and whose host has no `terminay-bot` profile
- **THEN** its container runs under the engine default, Chromium is not started with `--no-sandbox`, and the browser log states the condition and the fix

#### Scenario: Engine without AppArmor

- **WHEN** a bot starts on an engine that does not report AppArmor, or on Podman
- **THEN** no probe container runs and its container is created without an AppArmor profile option
