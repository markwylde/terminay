# Review and verification — bot-updates-apply-themselves

Verified on 2026-11-16 against the working tree, the change's proposal, design, ADR manifest, tasks and `bot-environment` delta, and ADR-0131.

## Scenario coverage

| Requirement › Scenario | Implementation | Evidence |
| --- | --- | --- |
| Image built locally › Files the image is not built from | `planBotImage` hashes only the Dockerfile, `.dockerignore` and `dockerfileSources` | `bot-image.test.mjs` 4.2: `test_extra.py` and `PORTING.md` leave the fingerprint unchanged; exec bit, `.dockerignore`, empty directories change it |
| Image built locally › Unreadable copy source | `dockerfileSources` refuses globs, absolute paths, `..`, URLs, variables, quoting, JSON and heredoc forms; linked sources and parents are refused | `bot-image.test.mjs` "the fingerprint reads exactly the context paths…" |
| Containers follow › Rebuilt while stopped | unchanged `startNow` path | `bot-environment.test.mjs` 4.3 stale stopped containers |
| Containers follow › Rebuilt while running and idle | `prepareSession` → `startNow(id, true)`: build, recheck idle, remove, create; no `stopSessions` | "an out-of-date running container updates itself before a run only while idle" |
| Containers follow › Rebuilt while running | activity guard (shell, desktop, second run); Shell/Desktop/source activity is reserved before their asynchronous start | same test, plus the activity-during-build, Shell and Desktop failure regressions; `bots-ui` Overview banner test |
| Containers follow › Update build fails | `ensureImage` failure returns with the container running; the engine service marks the image `failed` with its error | "a failed build during an idle update keeps the running container and the run" |
| Containers follow › Another bot already rebuilt the image | the notice is read from the bot's Overview `current`, never from the image state; `BotRecovery` has no outdated notice | `bots-ui` "an out-of-date image alone shows no engine card or update notice above Chat"; `botsModel.test.ts` |
| Containers follow › AppArmor choice changed | `botContainerCurrent` compares the AppArmor label | "an unknown fingerprint never updates; an AppArmor-only change does" |
| Containers follow › Restart applies an update | Restart = stop + start; a stopped out-of-date container is recreated | "restart applies an update, and any recreation applies pending limits" |
| Containers follow › Pending limits applied by an update | `create` uses the bot's current limits | same test asserts the new memory limit and `limitsChangePending: false` |
| Containers follow › Recreate while Files is open | `removeContainer` waits for the engine's `destroy` event on 409, under a one-shot deadline (ADR-0028) | `bot-files.test.mjs` conflict regression; `removeContainer` event, deadline, stalled-inspection and pass-through tests |
| Containers follow › old container cannot be removed | the final forced removal reports a persistent 409 and the recreate fails before `create` | "a recreate whose old container cannot be removed fails before creating one" |
| Engine card only for real problems | `EngineSummary` `hideReady` no longer requires a current image | `bots-ui` outdated-image test; existing not-running / engine-changed recovery tests |

## Boundaries

- Electron privilege: no renderer or preload change beyond presentation. Engine access stays in `packages/server-core`.
- Project/window and terminal-session boundaries: the update touches only resources `owned` by this server and bot, inside the bot's lifecycle queue.
- ADR-0028: no timer re-checks state. The removal wait is event-driven with a one-shot deadline.

## Checks run

- `node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-*.test.mjs`: 473 pass.
- `npm run test:bots-ui`: 58 pass.
- `node --test … src/workspace/bots/botsModel.test.ts`: 11 pass.
- `tsc --noEmit -p tsconfig.json` and `biome lint` on the changed areas: clean (warnings only, all already present).
- `openspec validate bot-updates-apply-themselves --type change`: valid. `openspec validate --all`: eight failures, all in other changes and all already present.
