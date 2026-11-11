## 1. Reproduce

- [x] 1.1 Add a server-core test that creates enabled interval and command triggers, toggles them and the bot, and asserts health is `waiting` when active and `disabled` only when off. Verified: it fails on `main` with `actual: 'disabled', expected: 'waiting'`.

## 2. Server

- [x] 2.1 Make `initialCheckpoint` start health at `waiting`. Verified by the test in 1.1.
- [x] 2.2 Make `enable(…, true)` and `retry()` reset health to `waiting`. Verified by the test in 1.1 and a retry assertion on an interval trigger (`waiting` after `retry()`).
- [x] 2.3 Make `list()` report `waiting` for an active trigger whose stored state is `disabled`, `disabled` for an inactive one, and every other stored state unchanged. Verified by a test that writes a stored `disabled` checkpoint for an enabled trigger and lists `waiting`, and asserts a stored `healthy` and `failed` state list unchanged, including across a bot disable/enable.
- [x] 2.4 Cover the remaining scenarios: a trigger created disabled, a trigger enabled while its bot is off, and a once trigger after it fires all report `disabled`. Verified by server-core assertions in the same test file.

## 3. Renderer

- [x] 3.1 Change `statusOf` in `BotTriggersPanel.tsx` to take the bot's enabled state, return a neutral Disabled when the trigger or bot is off, and map `disabled` health on an active trigger to Waiting; move it to a small module with a unit test. Verified by unit tests for: trigger off, bot off with switch on, active with `disabled` health, and unchanged failed/retrying/healthy labels and tones.

## 4. Checks

- [x] 4.1 Run the full `bot-triggers`, `bot-sources` and `bot-failure-follow-ups` server-core suites, the renderer unit test, typecheck and lint. Verified by clean runs.
- [x] 4.2 Run `openspec validate --all`. Verified by this change passing; any failures in other changes are listed as pre-existing.
