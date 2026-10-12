## ADDED Requirements

### Requirement: The container entrypoint supervises the server and selects its release

In the official image the entrypoint SHALL stay the container's main process for the life of the container and SHALL run the server as its child. At every start of the server it SHALL select the release to run: the release marked on the data volume when that release's manifest and files verify and it is not older than the release built into the image, and otherwise the release built into the image. A marked release that fails verification SHALL be skipped with a logged reason and SHALL NOT prevent the server from starting.

When the server exits because a restart onto another release was requested, the entrypoint SHALL select again and start the server without exiting, so terminal sessions held outside the server process keep running. A release marked by an upgrade that has not yet been confirmed ready SHALL be treated as unproven: when the server exits, or the container starts, while that confirmation is outstanding, the entrypoint SHALL restore the previous mark and start that release, so a release that cannot start never leaves the container restarting on it. When the server exits for any other reason, the entrypoint SHALL exit with the server's status so the container runtime's restart policy applies. The entrypoint SHALL forward `SIGTERM` and `SIGINT` to the server and SHALL pass its arguments through to it.

#### Scenario: Upgraded release survives a container restart

- **WHEN** a container whose image carries `5.1.1` was upgraded in place to `5.2.0` and is then restarted
- **THEN** the server that starts is `5.2.0`

#### Scenario: Recreated from the same image

- **WHEN** that container is removed and created again from the `5.1.1` image on the same data volume
- **THEN** the server that starts is `5.2.0`

#### Scenario: Newer image wins

- **WHEN** a container is created from a `5.3.0` image on a data volume marked `5.2.0`
- **THEN** the server that starts is `5.3.0`

#### Scenario: Marked release is damaged

- **WHEN** the marked release fails verification
- **THEN** the release built into the image starts and the log names the release that was skipped

#### Scenario: Restart for an upgrade keeps the container up

- **WHEN** the server exits because an in-place upgrade asked for a restart
- **THEN** the entrypoint starts the newly marked release, the container keeps running, and its terminal sessions are still alive

#### Scenario: Upgraded release cannot start

- **WHEN** the server exits on a newly marked release before the upgrade confirmed it ready
- **THEN** the entrypoint starts the previous release and the container keeps running

#### Scenario: Server crash

- **WHEN** the server exits without a requested restart
- **THEN** the entrypoint exits with the server's status

#### Scenario: Stop signal

- **WHEN** the container receives `SIGTERM`
- **THEN** the server performs its bounded graceful shutdown and the container exits
