## Why

After almost every Terminay upgrade, each running bot shows "The container was made from an older image or settings. Recreate to update", plus an Engine / Image / Check again card, even though nothing is wrong with the container engine (issue #622). The user has to recreate every bot by hand. Sometimes that fails with "another container already uses the bot's name or is in the wrong state". The real container is fine, and the user can't tell what to do next.

There are three causes:

- **The recreate fails because of a race with the Files helper.** The Files helper is started with `--rm`. Recreate closes it first, which ends its process, and the engine starts removing it. Terminay then force-removes the same container, and the engine answers 409 because a removal is already in progress. Terminay treats every 409 as a name conflict and gives up before it touches the bot container. Any bot whose Files tab was open could not be recreated.
- **The image goes out of date more often than it needs to.** The image fingerprint hashes the whole `docker/terminay-bot/` folder, including tests and notes that are never copied into the image.
- **Every update is a manual task.** A running out-of-date container waits for the user to recreate it, and the dashboard shows the engine card as if the engine needed attention.

## What Changes

- Removing a container the engine is already removing waits for the engine's own removal, through its container events and under a 15 s deadline, and does not fail. This covers the Files helper and the bot container. A container that really cannot be removed still fails the recreate, before anything new is created.
- The 409 message stops blaming a name clash. It says the container was busy or its name was still in use, and asks the user to try again.
- The image fingerprint covers only what the image is built from: the seccomp profile, the Dockerfile, `.dockerignore`, the files it copies (with their executable bit), and the agent installs and ids. Edits to tests and notes no longer make containers out of date. A copy source Terminay cannot resolve fails the plan rather than escaping the hash.
- An out-of-date running container is updated automatically before the bot's next run, but only while nothing else uses the machine: no other running session and no open shell or desktop. The image is built first. If the build fails, the run proceeds on the old container. The home is kept, and the run is neither stopped nor asked to confirm.
- One update notice, read from the bot's own container. Environment › Overview shows "An update is ready. It installs before the next run, while no shell or desktop is open." with **Update now**, and only for a running bot. The area above Chat and Configure stops showing an outdated-image notice. It shows the engine card only when the engine is unavailable or the image is missing or failed.

## Capabilities

### Modified Capabilities

- `bot-environment`: "The bot image is built locally" narrows what the fingerprint covers. "Containers follow the current image" adds the idle update before a run and the update notice.

## Impact

- `packages/server-core/src/botService/engine.ts`: `removeContainer`, which treats an engine-side removal in progress as success once the container is gone.
- `packages/server-core/src/botService/files.ts`, `environment.ts`: use it; `prepareSession` builds the image and then updates an idle, out-of-date running container.
- `packages/server-core/src/botService/image.ts`: `dockerfileSources`; the fingerprint hashes only built inputs. Existing bots go out of date once, when this change ships, because the fingerprint's inputs change.
- `packages/server-core/src/botService/failure.ts`: the conflict message.
- `src/workspace/bots/BotRecovery.tsx`, `botsModel.ts`, `BotsSection.tsx` (`EngineSummary`'s `hideReady`): no outdated-image notice; the engine card is shown only for real engine or image problems.
- `src/workspace/bots/BotEnvironmentPanel.tsx`: the update notice, for running bots only.
- No protocol change.
