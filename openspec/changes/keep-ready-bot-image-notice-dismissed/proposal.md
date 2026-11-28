## Why

A user who dismisses the green **Bot image ready** notice sees it again every
time they open Bots on the iPhone client (Gitea #681). The dismissal is kept
only in the viewing page's `localStorage`. The installed PWA frames the session
origin, where Safari partitions that storage and often discards it
([ADR-0012](../../adr/0012-pwa-framed-session-host.md)). The dismissal also
never reaches the user's other devices.

The first suspicion, that a rebuild mints a new build id on every visit, does
not explain the report: on the affected server the retained build record has
kept one id for twelve days. A rebuild of the same image would still bring the
notice back, because the dismissal is keyed by that id.

## What Changes

- The Terminay Server remembers which ready images have had their notice
  acknowledged, identified by the container engine and the image fingerprint.
- Dismissing the notice, or retiring it by seeing it and leaving the surface,
  acknowledges the image on the server. It stays hidden across visits, reloads,
  server restarts and every device attached to that server.
- A rebuild that produces an acknowledged image (same engine and fingerprint),
  such as a fully cached one, announces no **Bot image ready**. Running, failed
  and interrupted notices are shown as before.
- Other open clients drop the notice as soon as one acknowledges it.
- The page keeps no dismissal in `localStorage`.
- The engine card gets **Build details** for the latest completed build, as
  `bot-image-build-progress` already requires, so dismissing the notice does not
  remove the way to it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: the **Build progress notice** requirement makes the
  acknowledgement of a ready image server-owned and keyed by the image rather
  than the build.

## Impact

- `packages/server-core/src/botService/buildProgress.ts`, `engineService.ts`:
  retained acknowledgements and one new bot-authority command.
- `packages/protocol` (`botEngine.ts`, `botBuild.ts`) and
  `packages/client-core/src/botEngine.ts`: the command and a flag on build
  progress.
- `src/workspace/bots/BotBuildProgress.tsx`, `useBotEngine.ts`.
- Tests: `packages/server-core/test/bot-build-progress.test.mjs`,
  `e2e/bots.spec.ts`.
- A notice dismissed before this change is shown once more.
