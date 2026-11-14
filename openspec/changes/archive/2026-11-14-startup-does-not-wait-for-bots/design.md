## Context

`createServerCoreComposition().start()` awaited, in order: extensions,
`bots.reconcile()`, `bots.triggers.start(...)`, settings, agents, workspace
restore, and only then reported ready. Desktop shows its loading state until
the local server is ready.

`BotService.reconcile()` first gets an engine driver, which probes Docker or
Podman sockets and checks the bot image, then reconciles every bot's container,
ends leftover agent processes in running bots, and removes helper containers.
Each engine request has a deadline of 5 to 30 seconds. While the engine is slow
or waking, startup waits on those deadlines.

The change stays inside Terminay Server. It crosses no renderer, connection
host, or project/terminal-session boundary: the bot service keeps owning its
own state, and clients reach it through the same protocol.

## Goals / Non-Goals

**Goals:**

- Server readiness never depends on the container engine answering.
- Bot behaviour after reconciliation is unchanged: interrupted executions are
  marked, leftover processes ended, triggers started.

**Non-Goals:**

- Making engine discovery or reconciliation faster.
- Changing engine request deadlines.
- Showing bot reconciliation progress in the UI.

## Decisions

1. **Reconciliation runs beside startup.** `start()` launches
   `reconcile()` followed by `triggers.start()` as one background task and does
   not await it.
   *Alternative:* keep awaiting it with a shorter overall deadline. Rejected: it
   still delays every launch on a slow engine, and a reconciliation cut short
   leaves bot records in an unknown state.
2. **Executions guard themselves.** `dispatchExecution` already awaits
   reconciliation when it has not completed and refuses with an `engine` block
   when it fails. That makes running it in the background safe for chats,
   triggers, and failure follow-ups alike.
3. **Shutdown joins the task.** `shutdown()` awaits the background task before
   tearing down, so reconciliation never writes into a stopped bot service, and
   the task does not start triggers once shutdown has begun.
4. **A failed reconciliation does not fail startup.** It used to fail
   `start()` entirely. Now the failure is swallowed: the next execution
   retries reconciliation through decision 2, and triggers still start.

## Risks / Trade-offs

- [The bot list is visible before reconciliation finishes, so a bot can show
  its last recorded state for a moment] → Reconciliation publishes its changes
  through the existing `changed` events, so clients update when it finishes.
- [Quitting during a slow reconciliation waits for it] → Quitting before this
  change could not happen any sooner, because startup itself was still waiting.
- [Tests that assumed `start()` had reconciled bots] → The bot composition test
  setup now awaits `service.reconcile()`, which joins the in-flight run.
