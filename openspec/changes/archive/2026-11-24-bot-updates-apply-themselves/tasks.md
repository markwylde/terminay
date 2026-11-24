## 1. Removal race

- [x] 1.1 Add `removeContainer` to `engine.ts`. 404 means done. On 409 it subscribes to `driver.events`, inspects once, and finishes on a missing container or a `destroy` event for that name. A one-shot 15 s wall-clock deadline ends in a final force-remove, where 404 is success and anything else is thrown. It never re-checks state on a timer (ADR-0028). Verify: `bot-environment.test.mjs` covers: 409 then `destroy` event resolves; 409 with the container already gone resolves without waiting; persistent 409 past the deadline rejects; inspection failure rejects; other errors pass through; the event subscription is always closed.
- [x] 1.2 Use it in `BotFilesService.closeBot` and `BotEnvironmentService.removeResources`. Verify: `bot-files.test.mjs` "closing a helper the engine is already auto-removing…" passes; a `bot-environment.test.mjs` test shows a recreate whose bot-container removal keeps failing rejects without creating a container.
- [x] 1.3 Reword the 409 message so it covers a busy container and a name still in use. Verify: the leftover-storage test asserts the new text.

## 2. Idle update before a run

- [x] 2.1 `prepareSession` runs `startNow(id, true)`. For a running container, with a known fingerprint and an idle bot (`runningSessions <= 1`, no shells, no desktops), it runs `ensureImage` first, then compares against the built fingerprint and the AppArmor choice. It removes and recreates only when the container is not current. It never calls `stopSessions`. Verify: `bot-environment.test.mjs` covers idle success with the home kept and no `sessions-stop`; a shell, a desktop, or a second running session each keeping the old container; an unknown fingerprint keeping it; an AppArmor-only mismatch updating it; `start` never replacing a running container.
- [x] 2.2 A build failure during the idle update keeps the running container: `prepareSession` resolves, the state stays `running`, and nothing is removed. Verify: a `bot-environment.test.mjs` test with a failing `ensureImage`.
- [x] 2.3 Restart applies an update, and a recreate applies pending limits. Verify: `bot-environment.test.mjs` restarts an out-of-date running bot and sees `current: true`; an update after a limits change creates the container with the new limits and clears `limitsChangePending`.

## 3. Fingerprint

- [x] 3.1 `dockerfileSources` parses continuation lines and flags, and skips `--from`. It refuses the JSON form, heredocs, globs, absolute paths and `..`. The fingerprint hashes the seccomp profile, the Dockerfile, `.dockerignore` (if present), and each source with its executable bit, then the agents, uid and gid. Verify: `bot-image.test.mjs` shows that `test_extra.py` and `PORTING.md` leave the fingerprint unchanged, that a changed `bin/` script, a changed executable bit, and a new `.dockerignore` change it, and that every refused form throws, as does a linked source.

## 4. Presentation

- [x] 4.1 `BotRecovery` shows no outdated-image notice, and shows the engine card (via `EngineSummary`'s `hideReady`, which no longer requires a current image) only for an unavailable engine or a missing or failed image. `recoveryNotice` loses its outdated branch. Verify: `botsModel.test.ts` asserts that `recoveryNotice` returns nothing for running and stopped bots; a `bots-ui.test.mjs` test with an `outdated` image and a running bot finds no `[data-terminay-bots-engine]` card and no recovery notice above Chat.
- [x] 4.2 The Overview banner is driven by the bot's own `current` and shown only while `running`, with the new wording and **Update now**, which opens the Recreate confirmation. Verify: `bots-ui.test.mjs` asserts the banner text and that Update now opens the confirmation; a stopped out-of-date bot shows no banner.

## 5. Checks

- [x] 5.1 Verify: `node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-*.test.mjs`, `npm run test:bots-ui`, `tsc --noEmit`, and `biome check` on the changed files all pass. `openspec validate bot-updates-apply-themselves --type change` passes. `openspec validate --all` reports nothing for this change; its failures in other changes (add-terminay-bots, bot-chat-image-attachments, linked-folders, …) were already there before this change and are recorded here, not fixed.

## Review follow-up

- [x] Reserve Shell, Desktop and source activity before asynchronous opening; release failed admissions and recheck activity after building, before removal. Regression coverage includes activity admitted during the build, Shell start failure and Desktop engine failure.
- [x] Race inspection with the removal deadline so a stalled inspection cannot prevent the final force-remove. Add a stalled-inspection regression.
- [x] Reject variable/quoted COPY paths and traversal before normalization; inspect parent components for links and fingerprint empty directories. Add parser, linked-parent and empty-directory regressions.

Rerun after review outside the sandbox: all 473 `packages/server-core/test/bot-*.test.mjs` tests, `npm run test:bots-ui` (58), `botsModel.test.ts` (11) and `tsc --noEmit` pass. The change validates; `openspec validate --all` still reports eight failures, all in other changes.
- [x] Count the view-only desktop preview beside Chat as `previews`, not `desktops`: it keeps a bot from idling but never holds back an update. Verify: the idle-update test updates with `previews: 1`; the E2E "an out-of-date container…" test updates the container on the next Chat message.
