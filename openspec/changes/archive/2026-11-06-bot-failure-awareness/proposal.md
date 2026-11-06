## Why

A bot stopped answering chat and stopped running its trigger, and the only thing the user saw was "The native agent could not complete the request." The bot itself could not see what had gone wrong and was never told, so nobody investigated until the user went digging through container processes.

The cause was a process leak in the bot container. Every `tea` call made by the trigger's minute poll ran with the shared desktop's `DISPLAY` but no session bus address. That made the Go D-Bus client auto-launch a private `dbus-daemon`. The daemon forks into its own session, so it escapes the supervised process group and is never cleaned up. In about 20 minutes, 822 orphaned daemons filled the container's 1024-process limit, after which every execution failed with `spawn EAGAIN`.

## What Changes

- Supervised container commands (agent executions, trigger sources, shells, desktop launches) receive the shared desktop's session bus address. When no desktop bus is running they receive a disabled bus address, so no D-Bus client can auto-launch a private daemon.
- An execution or trigger check that fails with `EAGAIN` while the engine shows the container at its process limit reports that cause, with the count and limit, instead of the generic native-agent message. Without that evidence it says the agent could not start a process.
- The runtime MCP exposes why an execution failed: execution summaries carry the failure reason, and a new bounded, redacted read returns an ended execution's runner output.
- Execution briefings list the bot's recent failed executions and any trigger whose condition check is failing or blocked.
- **Failure follow-up.** When a trigger's condition check starts failing, a trigger firing fails, or an execution fails, the bot is woken in a new execution whose origin is *failure*. That execution receives the failure details and can investigate, fix its own trigger code and report to the user. Each underlying failure is reported once, details are redacted before they are kept, dispatch survives restarts, follow-ups are coalesced and rate-limited, and they never chain: a follow-up's own failure is recorded but does not wake the bot again. A per-bot profile setting, **Investigate failures**, turns this on or off and is on by default.
- The Sessions tab's origin filter adds *Failure*, and a failure execution names the failure it was woken for.

## Capabilities

### New Capabilities

- `bot-failure-follow-up`: when the bot is woken because one of its executions, firings or trigger condition checks failed, what it is told, how follow-ups are coalesced, and how chaining is prevented.

### Modified Capabilities

- `bot-container-engine`: supervised commands share the desktop session bus or a disabled bus, so no session daemon outlives its process group; process exhaustion is reported as its own cause.
- `bot-message-log`: execution summaries carry their failure reason, a bounded runner-output read is added, and briefings include recent failures and unhealthy triggers.
- `terminay-bots`: sessions record the *failure* origin; the Sessions tab filters by it; the bot profile gains **Investigate failures**.

## Impact

- `docker/terminay-bot/bin/terminay-desktop-session`, `terminay-run`: publish and propagate the session bus address. Requires an image rebuild, which existing bots pick up through the normal out-of-date image flow.
- `packages/server-core/src/botService/`: `runtime.ts` (summary, new `sessions_output` tool, briefing), `failure.ts` and the agent process path (process-exhaustion classification), `triggers.ts` and `sessions.ts` (failure follow-up dispatch), and the bot store (profile setting).
- `packages/protocol/src/bots.ts`: a `failure` session origin and the `investigateFailures` profile field.
- `src/workspace/bots/`: Sessions origin filter and label, and the profile toggle.
- No change to project, terminal or other-bot authority: all new reads and wake-ups are scoped to the bot that owns the failure.
