# Claude Code background-wait: what a host can do

Measured 2026-11-28 with Claude Code 2.1.312 (the bot runtime pin), model
Haiku, launched as bots launch it (`-p --input-format stream-json
--output-format stream-json --no-session-persistence`,
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`). Each probe asked the agent to leave
one kind of background work behind and end its turn.

## Standard input held open (what Terminay does while it sees background work)

| Left behind | In `background_tasks_changed` | A user message sent 8 s after the result | `stop_task` |
| --- | --- | --- | --- |
| Background shell | yes (`local_bash`) | new turn at once, answered | task killed, list empties |
| Monitor | yes (`local_bash`) | new turn at once, answered | task killed, list empties |
| Background subagent | yes (`local_agent`; its children carry `parent_task_id`) | new turn at once, answered | stopping a subagent's child shell resumed the subagent, whose end started one more main turn |

After the last task stopped, closing standard input ended the process with
status 0.

## Standard input closed straight after the result

| Left behind | Process |
| --- | --- |
| `ScheduleWakeup` (10 minutes) | exited 0 within 1 s; the wakeup is dropped |
| One-shot `CronCreate` job | exited 0 within 1 s; the job is dropped |
| Monitor | still alive after 66 s |

Neither a wakeup nor a cron job appears in `background_tasks_changed`.

## Conclusions

- A host can deliver a message during background-wait: it is an ordinary
  `user` frame on the still-open standard input. No resume is needed, which
  matters because bot executions run with `--no-session-persistence`.
- A `control_request` with subtype `stop_task` and a `task_id` stops listed
  work.
- A wakeup or cron job alone does not hold a `-p` process open.

## Not measured

Which item held the sessions in ticket 680 is unknown. Besides listed tasks,
Terminay holds standard input open while its own count of task notifications
awaiting a follow-up turn is above zero.

## The built driver against the pinned CLI

Same date, `BotNativeClient` with the five-minute interval shortened to ten
seconds. An agent that left a Monitor and a background shell and said its task
was finished answered the first check with the line; the driver stopped both,
the process exited 0 and the turn completed 2 s after the check. An agent
told it must wait for a shell answered two checks without the line and kept
running with the shell listed.
