# ADR-0109: Terminay reports execution failures as facts, retries only before task hand-over, and the bot judges what they mean

Status: accepted, supersedes ADR-0099 (in part)
Date: 2026-11-11
Supersedes: ADR-0099 (the clause "the server starts a failure execution when one of that bot's executions fails", for temporary startup failures and for repeated failures of one trigger only; every other decision continues)

## Context

Bots share one modest host with other agents, compose stacks and E2E runs. On 2026-11-11 the podman VM was at load 16 on 5 vCPUs. Engine execs took 8–9 s, and a 10 s startup check that measured from before the exec was created failed three executions in four minutes. The failures carried no structured cause, so ADR-0099 started an investigation for each. The investigations found nothing. The owner expects runs to fail sometimes on that machine. They want each run to try again when that is safe and the next run to start fresh. They want the bot itself to decide whether a failure is outside its control or needs a human, and they want to be asked only when they must act.

ADR-0099 woke the bot for every execution failure. Its only filter is a structured `cause` that also stops every execution. A temporary overload therefore had two outcomes, and both were wrong: an investigation, or a blocked bot.

## Decision

1. **Hand-over is the retry boundary.** The server durably records the moment it hands an execution its task. Only failures before that moment may be retried. A crash in between counts as handed over.
2. **Facts, not verdicts.** A startup failure records its stage, a temporary flag and a code, taken from structured errors and adapter exit statuses, never from message text. "Temporary" is separate from the blocking `cause` and never blocks the bot.
3. **Bounded, fresh retries.** A temporary startup failure is retried in the same execution, at most three times with backoff. Each attempt has a fresh provider session and runtime token. Retries never start after the trigger's next due firing, or more than five minutes after the first attempt for executions without a trigger. The wait is a single timer (ADR-0028).
4. **The engine is protected from retries.** At most two executions per server are in startup at once.
5. **The bot judges.** A temporary startup failure that exhausts its retries does not start a failure execution. It appears in later briefings marked temporary. An execution may report `outside-control`, `needs-human` (with an action) or `fixed` through a scoped runtime tool. `needs-human` records a blocker on a trigger, posts once, and by default pauses that trigger until the user resumes it or the bot reports `fixed`.
6. **One investigation per trigger episode.** Execution failures of one trigger are counted as one episode until an execution of that trigger completes, and only its first failure wakes the bot.

## Consequences

- An overloaded host costs a few delayed starts instead of failed runs plus investigation runs.
- A new failure path must decide whether it can happen before hand-over and, if so, throw a structured startup error with an honest temporary flag.
- Side-effecting work is never replayed automatically. Recovering a failure after hand-over is left to the bot's next run and its judgment.
- The user hears from a bot when it reports `needs-human`, or when it chooses to post. Terminay itself posts nothing for transient failures.
- ADR-0099's coalescing, hourly cap, no-chaining rule, server-owned dispatch and per-bot setting continue unchanged.
