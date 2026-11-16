## Context

A bot's container is out of date when its `terminay.fingerprint` label differs from the current image plan, or when its `terminay.apparmor` label differs from the AppArmor choice the server would give a new container (`botContainerCurrent`). Before this change, Terminay recreated a stopped container on its next start, but a running one only when the user chose Recreate. A shared image that is out of date (`image.state === 'outdated'`) is a different fact from a bot's container being out of date. One bot's start rebuilds the shared image while the other bots keep their old containers.

## Decisions

### Engine-side removal counts as removal

`removeContainer(driver, name)` force-removes a container.

- If the engine answers 404, the container is already gone. Done.
- If it answers 409, the engine is already removing it, usually because the container was started with `--rm` and its process just ended. Terminay subscribes to the engine's container events (`driver.events`), then inspects the container once. It is done when the inspection finds nothing or a `destroy` event names the container.
- A one-shot wall-clock deadline of 15 s bounds the wait. When it fires, Terminay tries one more force-remove: 404 counts as success, and anything else, including another 409, is reported. The bot is never recreated over a container that may still exist.
- Any other error is passed on unchanged.

This is event-driven waiting with a deadline, which ADR-0028 allows (decision 3: a one-shot deadline). It does not re-check state on a timer. If the event stream misses a `destroy` that happened between subscribing and inspecting, the deadline's final remove finds nothing and succeeds.

The Files helper's `closeBot` and the bot's `removeResources` (bot container) both use it. A real name conflict at create time, such as Podman storage left behind by a removed container, keeps its own leftover handling in `create`. Only the user-facing message for 409s changes, and it now covers both causes.

### Idle update before a run

`prepareSession` calls `startNow(id, updateIfIdle = true)`. A running container is replaced only when all of these hold:

1. the current fingerprint is known (non-empty);
2. the session being prepared is the bot's only running session (`runningSessions <= 1`), and no shell or desktop is open (`shells == 0`, `desktops == 0`). The view-only preview beside Chat is counted separately (`previews`). It keeps the bot from idle-stopping, as before, but never holds back an update: most runs start from Chat, so counting it would mean an update never applies. The preview unmounts while the bot is not `running` and reconnects to the new container;
3. once `ensureImage` has run, the container is not current for the built fingerprint and the AppArmor choice.

**Build first, remove after.** `ensureImage` runs before anything is removed. If the build fails, the bot keeps its running container and the run proceeds on it. The failed build is reported on the image as usual (its log and the failing step), and the bot is not marked failed. Only then are the old resources removed (`removeResources(…, deleteHome = false)`, which also closes the Files helper) and the container created and bootstrapped, as for any start. A failure after removal fails the bot's start, the same as any start failure today, and the home is kept.

**The session being prepared survives.** The update never calls `stopSessions`, and it needs no confirmation. Confirming and stopping sessions belong only to a Recreate the user asks for.

**Interleaving.** The update runs inside the bot's lifecycle queue (`enqueue`). Shell and source opens reserve activity before starting the environment through that queue, and Desktop reserves activity before its asynchronous handshake. Reservations are released if opening fails, and otherwise when the stream or source closes. After the build, the update marks the environment starting to prevent new desktop admissions and checks activity again before removing resources. An open admitted during the build therefore keeps the old container. Shell and source opens admitted after that check wait for the lifecycle queue and attach to the new container. Execution admission updates `runningSessions` before preparing the session; another run already admitted at the final check blocks the update, while later preparations wait behind it.

**Other paths.** Start never replaces a running container. Restart stops and then starts it, and a stopped out-of-date container is recreated on start, so Restart applies the update, as it always has for stopped containers. When an update recreates the container, it is created with the bot's current resource limits. A pending limits change is therefore applied too, and its notice disappears.

**Boundary.** The update touches only resources owned by this server and bot (`owned`). It does not cross the project/window or terminal-session boundaries: a bot's container is server-scoped, and the run being prepared is the one that asked for it.

### Fingerprint covers what is built

`dockerfileSources` reads the Dockerfile's COPY and ADD instructions, joining continuation lines and skipping `--from` copies. It returns their literal context paths. Anything it cannot read reliably is refused, so a source can never quietly escape the hash: the JSON form, heredocs, globs, absolute paths, and `..`.

The fingerprint hashes, in this order:

1. the browser seccomp profile;
2. the Dockerfile;
3. `.dockerignore`, if present;
4. each COPY/ADD source, recursively, as path, size, executable bit and bytes, with links and special files refused as before;
5. the agent layer, the agent ids, and the `bot` uid and gid.

Other files in the context folder, such as `test_*.py`, `PORTING.md` and `port-source.json`, are not hashed.

### Presentation: one notice, from the bot's own container

The update notice comes from the bot's own Overview `current` flag, which already covers fingerprint and AppArmor. It never comes from the shared image state. It appears only on Environment › Overview and only for a running bot: a stopped bot updates on start. It reads "An update is ready. It installs before the next run, while no shell or desktop is open." Its action is **Update now**, which goes through the existing confirmed Recreate.

The recovery area above Chat and Configure stops showing an outdated-image notice. That notice was driven by the shared image state, so it was wrong for any bot whose container had been updated, and silent for AppArmor-only updates. The engine card there appears only when the engine is unavailable or the image is missing or failed. An image that is only out of date is rebuilt on the next start and is not an engine problem.
