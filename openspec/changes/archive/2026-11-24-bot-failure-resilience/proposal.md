## Why

Bots share one modest Mac with other agents, compose stacks and E2E runs. When the container engine is overloaded, a bot's run can fail before the agent even starts, and today that one slow moment is final. The run is marked failed with the message "Rebuild the bot image and recreate the environment". That message is wrong. The bot is then woken to investigate something it cannot fix. On 2026-11-11 a podman VM at load 16 on 5 vCPUs failed three runs in four minutes. Each spawned an investigation that found nothing, while the engine was still overloaded.

The user expects some runs to fail on a busy machine. What they want is for each run to try again a few times when that is safe, for every scheduled run to start fresh, and for the bot to judge failures itself. "The CPU was overloaded, the next run will be fine" means do nothing. "I need a password I don't have" means stop and ask a human, once.

Technically, the startup check in `runtimeBridge.ts` has a 10-second deadline. That deadline includes the engine's own exec start-up. Its catch block discards the real error. Terminay has no record of whether the agent was handed its task, so it cannot tell a safe retry from a dangerous one. And the agent has no way to tell Terminay "I'm blocked and need you".

## What Changes

- **Honest startup failures.** Each startup stage reports what failed and why, for example "Startup timed out while the engine was slow; the host may be overloaded". The real error is never replaced with "rebuild the image". That advice is given only when the adapter program itself is missing from the image. Startup deadlines count from when the command is running in the container, not from when it is requested from the engine.
- **Temporary startup failures are recorded as facts.** An execution that fails before its task is handed to the agent records a structured *startup failure* with a stage and whether it is temporary. Temporary means engine slow, engine connection dropped, or relay/adapter not answering in time. This is separate from the existing blocking `cause`, so a temporary failure never blocks the bot.
- **The task hand-over is recorded.** The server durably records the moment it hands an execution its task. Only executions that fail before that moment are ever retried.
- **Automatic startup retries.** A temporary startup failure is retried in the same execution after about 10 s, 30 s and 60 s, with jitter, up to the trigger's retry setting (default 3). A retry happens only after the failed attempt's cleanup is confirmed. No attempt begins more than 5 minutes after the first one, or after the trigger's next firing is due. If the next firing arrives while the old execution is still waiting, the old one is replaced, so the next firing starts fresh. The attempt history is kept separate from the final failure.
- **Machine-wide startup budget.** At most two bot executions on a server are starting at the same time. The others wait their turn, so retries do not add to the overload.
- **The bot judges, Terminay does not.** A temporary startup failure that used up its retries does not start a failure investigation. It appears in the next execution's briefing, marked temporary with its attempt count, and the bot decides whether to do anything.
- **A new runtime tool, `outcome_report`.** An execution can report `outside-control`, `needs-human` (with the action a human must take) or `fixed`. `needs-human` posts one message to the bot's chat, which raises the normal bot notification. It also marks the trigger as **Needs you** and, by default, pauses it (including firings already queued) until the user resumes it or the bot reports `fixed`. Trigger changes use the existing revision checks. The one chat message is posted crash-safely, through an idempotency key tied to the blocker.
- **No repeated alerts.** Failures of one trigger are counted by episode. One failure investigation starts per episode, and a trigger already waiting for the user does not post again. The rule that a bot is woken by its own failures is updated to list these exceptions.
- **Two new per-trigger settings:** *Startup retries* (0–3, default 3) and *When the bot needs you* (Pause this trigger, the default, or Keep running). The existing per-bot *Investigate failures* setting is unchanged.
- **UI.** The Triggers table and editor show the Needs you state, its reason and action, and **Resume**. The editor offers the two new settings. Sessions shows startup attempts and any reported outcome.
- The bot image's MCP adapter exits with distinct statuses for temporary and lasting connection problems. This changes the image fingerprint, so existing bots rebuild their image once.

## Capabilities

### New Capabilities
- `bot-execution-resilience`: how an execution's startup failures are classified, retried, bounded by the next firing and the machine-wide startup budget, and reported to the bot. Also covers how a bot reports its own outcome, including needing a human.

### Modified Capabilities
- `bot-failure-follow-up`: the wake rule lists its exceptions; temporary startup failures do not wake the bot; execution failures of one trigger are counted by crash-safe episodes.
- `bot-triggers`: the per-trigger *Startup retries* and *When the bot needs you* settings, the Needs you state, Resume, and firings skipped while a trigger waits for the user.
- `bot-message-log`: briefings mark temporary failures and their attempts; the `outcome_report` tool and its scope; execution details carry the startup failure and the reported outcome.
- `bot-engine-recovery`: runtime bridge failures name the stage and the real cause, and advise an image rebuild only when the adapter program is missing; startup deadlines count from when the command runs; exit statuses reach the bridge.

## Impact

- `packages/protocol/src/bots.ts`: session `startupFailure`, `attempts`, `dispatchedAt`, `retryAt` and `outcome`; the trigger `startupRetries`, `onNeedsHuman` and `blocker` fields. Health states are unchanged, and Needs you is derived from `blocker`.
- `packages/server-core/src/botService/`: `runtimeBridge.ts` (stage-aware errors, deadlines from exec start), `socketDriver.ts`/`engine.ts` (a start-relative deadline option, and exit status carried on errors), `service.ts` (dispatch marker, retry loop, startup budget), `runtime.ts` (briefing fields, `outcome_report`, tool list), `failureFollowUps.ts` (skip temporary failures, trigger episodes), `triggers.ts` (settings, blocker, pause, resume) and the session and trigger stores.
- `docker/terminay-bot/bin/terminay-bot-mcp`: exit statuses 75 (temporary) and 69 (lasting).
- `src/workspace/bots/BotTriggersPanel.tsx`, `BotTriggerEditor.tsx` and the Sessions view: Needs you, Resume, the new settings, attempts and outcome.
- Server and runtime-tool tests, real-container bridge tests, and E2E coverage of the Triggers UI.
- No new dependencies. No polling: retries and the next-firing bound use single deadline timers (ADR-0028).
