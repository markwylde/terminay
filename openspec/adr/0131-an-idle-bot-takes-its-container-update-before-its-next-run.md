# ADR-0131: An idle bot takes its container update before its next run

Status: accepted
Date: 2026-11-16

## Context

Each bot runs in a container built from `terminay-bot:local`. When the image changes, a running bot keeps its old container until it is recreated. The image changes whenever the shipped scripts change, which happens in most releases. Before this decision, a running bot was recreated only when the user chose Recreate, so after nearly every upgrade the user recreated each bot by hand (issue #622). A recreate keeps the home volume, but it ends every process in the container, including desktop applications that ADR-0098 otherwise keeps alive between executions.

## Decision

1. **Update before a run, while idle.** When a session is prepared and the bot's running container is out of date (a different image fingerprint or AppArmor choice than a new container would get), the server builds the current image if needed. It then recreates the container before the run, but only when that session is the bot's only running one and no shell or desktop is open. The view-only desktop preview beside Chat does not count, since most runs start from Chat. The home is kept. The session being prepared is neither stopped nor asked to confirm.
2. **Build before removing.** The working container is removed only after the replacement image has built. If the build fails, the run proceeds on the old container.
3. **Never under the user.** Starting a running bot, and any run while a shell, desktop or other run is active, keep the existing container. The user can apply the update at any time with **Update now**, the confirmed Recreate. Restart stops the container first, and a stopped out-of-date container is always recreated on start, so Restart applies the update too.
4. **Only built inputs count.** The image fingerprint covers the seccomp profile, the Dockerfile, its `.dockerignore`, the context paths its COPY and ADD instructions read (contents and executable bit), the agent installs, the agent ids, and the uid and gid. A COPY or ADD source that cannot be resolved to literal context paths fails the plan. Other files beside the Dockerfile are not hashed.
5. **Any recreation applies current settings.** A recreated container always gets the bot's current resource limits, so an update also applies a pending limits change. A limits change on its own still waits for a recreate the user chooses.
6. **The notice belongs to the bot.** Whether an update is ready is read from the bot's own container, never from the shared image's state.

## Rejected alternatives

- **Recreate idle bots as soon as the image is rebuilt.** This restarts desktop apps between runs, when nobody asked for the bot, for no benefit until it next runs.
- **Keep updates manual and only shrink the notice.** Users would still recreate every bot after most upgrades.
- **Mount the shipped scripts into containers instead of baking them into the image.** This removes recreates for script changes, but it adds a host-to-container mount of privileged helpers. It also leaves Dockerfile and agent changes needing a recreate anyway.

## Consequences

- After an upgrade, most bots update without anyone noticing. The run that triggers the update starts a little later, and desktop applications open from earlier runs are closed.
- A bot that is always watched (shell or desktop open) keeps showing the update notice until the user chooses Update now or the bot stops.
- Changing the fingerprint's inputs makes every existing container out of date once, when this decision ships.
