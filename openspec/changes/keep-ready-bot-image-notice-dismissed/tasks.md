## 1. Protocol and server

- [x] 1.1 Add `bots.image.acknowledge` to `BOT_ENGINE_OPERATIONS` and optional boolean `acknowledged` to `BotBuildProgress`, validated by `parseBotBuildProgress`; verified by a parser test accepting a missing or boolean value and rejecting any other.
- [x] 1.2 Retain the bounded acknowledged list in `BotBuildTracker` with `acknowledge(buildId)` and the derived snapshot flag; verified by `bot-build-progress.test.mjs` covering same-image rebuild, different fingerprint, different engine, restart, failed rebuild, stale or non-completed id, repeat calls, oldest-first eviction, a failed write followed by a successful retry, and records with an absent or malformed list (the build record still loads).
- [x] 1.3 Register the command in `BotEngineService.operations()` with bot authority and publish the change; verified by a service test: one `changed` event per new acknowledgement, a restricted principal refused, an invalid payload refused.
- [x] 1.4 Add `BotEngineClient.acknowledgeImage(buildId)`; verified by the type check and the end-to-end test.

## 2. Workspace UI

- [x] 2.1 Expose the acknowledgement from `useBotEngine` without touching busy or error state, and replace the `localStorage` dismissal in `BotBuildProgress.tsx` with the server flag plus a React-free acknowledgement module that sends on dismissal and resends on a new status; verified by unit tests of that module (immediate send, one in flight, resend after failure, no resend once acknowledged), the server-switch browser regression in `scripts/bots-ui.test.mjs`, the type check, lint and the end-to-end test.
- [x] 2.2 Add **Build details** to the engine card for a completed build, on wide and compact workspaces (`bot-image-build-progress`, image controls); verified by the end-to-end tests opening the page after dismissal and from the phone engine sheet.

## 3. Verification

- [x] 3.1 Extend `e2e/bots.spec.ts`: dismiss stays dismissed after clearing browser storage and reloading, and after the same image is rebuilt; seen-and-left retires it, verified by reloading with storage cleared before returning to Bots; crossing the compact width keeps the notice and acknowledges nothing; an acknowledgement made by another client of the server removes the open notice; verified with `npm run test:e2e`.
- [x] 3.2 Capture screenshots of the ready notice and of Bots after dismissal and reload, at desktop and phone widths; verified by viewing the images.
- [x] 3.3 Run the affected package tests, `openspec validate --all`, lint and type check; verified by clean exits, with `validate --all` failing only for other open changes.
