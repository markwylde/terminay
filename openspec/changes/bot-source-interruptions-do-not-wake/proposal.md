## Why

A bot's minute-by-minute command trigger shows "Source worker unavailable; recreate bot to update its image" after the laptop wakes from sleep or the bot container has just started. The check simply did not finish. The message sends the owner and the bot looking at the image, and each one-off interruption wakes the bot into an "Investigate failure" session that cannot fix anything. On 2026-11-06 both of Codexia's failure sessions came from this: one at the exact second the host woke (the container VM was frozen while asleep), one during container startup. Run by hand, the same check returned in 22 s every time.

The technical cause is that any source run that ends without a result frame is reported with the old-image message. The worker's stderr and exit status are thrown away, and polled checks are not retried, so the first interruption immediately starts a failure episode.

## What Changes

- A source run that ends without a result keeps the worker's exit status and a bounded stderr tail, and puts them in the trigger's health error. The tail is redacted with the bot's secrets before it is stored.
- Three cases that used to share one message are told apart. In the first, the worker could not be executed: `terminay-run` exits 126 or 127, and the recreate advice still applies. In the second, the check ran past its own time limit, including the 10 s test window. In the third, the run was interrupted: it stopped before reporting, for example after host sleep, during container startup or because the exec stream broke. The interrupted message never tells the owner to recreate the bot. Process-limit and engine causes keep their structured cause.
- A polled (command or HTTP) check that is interrupted is retried once, within the same check, after a short delay. The retry happens only after container-side cleanup of the first run succeeded, so the two runs never overlap. Meanwhile health shows *retrying*, which does not start a failure episode. Only when the retry fails too is the check recorded as failed, which may wake the bot under the existing failure follow-up rules. Continuous sources (files, SSE) keep their existing bounded reconnect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-triggers`: adds a requirement that source runs ending without a result are classified (missing worker, over time limit, interrupted), report bounded redacted worker diagnostics, and retry an interrupted polled check once before it counts as failed.
- `bot-failure-follow-up`: adds a requirement that a polled condition check interrupted once and recovered on retry does not start a failure episode or a failure execution.

## Impact

- `packages/server-core/src/botService/sourceRunner.ts`: keep bounded stderr and the exit status, mark a time-limit kill, and raise distinct errors.
- `packages/server-core/src/botService/triggers.ts`: retry an interrupted polled check once, and show health as retrying in between.
- `packages/server-core/test/bot-sources.test.mjs` and `bot-triggers.test.mjs`: new unit coverage.
- No protocol, UI, image or storage format change. `retrying` is already a health state, and the Triggers tab already shows the error text.
