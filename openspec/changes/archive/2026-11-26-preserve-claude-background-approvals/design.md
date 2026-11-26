## Context

Claude Code can emit a successful result while background tasks are still running. In a local reproduction with Claude Code 2.1.312, closing stdin at that result left the process alive. The background task completed and woke Claude, but the subsequent shell write failed with a closed approval stream. Holding stdin open through the follow-up let Terminay answer the approval and the write succeeded. A clean exit followed both cases.

## Goals / Non-Goals

**Goals:** Preserve the execution-scoped approval channel across interim results and report an approval stream failure accurately.

**Non-Goals:** Inferring task fulfillment from model text, changing the chat contract, or changing either provider's approval policy.

## Decisions

- Use Claude 2.1.312's `system/background_tasks_changed` event and its `tasks` array, a snapshot of active work. A nonempty snapshot makes results interim. An empty snapshot updates the state without closing stdin. A task can finish before the current result, leaving an empty snapshot and a queued wake-up. Count each completed or failed `task_notification` until a subsequent `system/init` starts its turn. Multiple notifications can queue separate turns, including a turn that returns a result without querying the model. A `stopped` notification from TaskStop queues no wake-up. Close stdin on a result only when both active work and queued wake-ups are drained. A wake-up that starts more work produces another nonempty snapshot. Ignore malformed snapshots and use ordinary result handling if no valid snapshot has arrived. The server still uses process exit to settle the execution. Waiting indefinitely after every result would strand ordinary executions that expect EOF. A grace timer could end legitimate background work and conflicts with ADR 0140.
- Treat an errored tool result with the exact host permission-stream closure text and matching provider metadata for an unexecuted permission-rule rejection as a runner failure. Retain the diagnostic and use existing durable status and failure-follow-up handling. Generic tool errors can be part of successful work, so they remain in the transcript without deciding the execution outcome.
- Keep approval handling and shutdown in the execution's server-side adapter. A bot's subprocess gets no broader authority, and runtime tools still enforce their separate execution-scoped rules.

## Risks / Trade-offs

Claude event shapes are provider-specific. Test the observed sequence, including the empty snapshot before a wake-up tool call. Ordinary completion, cancellation, and process cleanup remain governed by the existing lifecycle. Limit status classification to the observed provider error.
