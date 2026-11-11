## Context

`postUserMessage` (server-core `botService/service.ts`) stores each user message with `dispatch: pending`, starts an execution, then writes `dispatch: started` or `dispatch: failed` with a reason through `messages.setDispatch`. On server start, `reconcile` checks each `pending` message. If an execution linked to it exists, the message becomes `started`. Otherwise it becomes `failed`. `BotChat.tsx` draws a `bots-note--warn` paragraph for every loaded message whose dispatch is `failed`. Nothing writes the dispatch again after that, so the warning is permanent.

In the reported case the user's 17:00 message failed to start during a Terminay bug. The bot later answered it through another execution. The warning still showed, because it belonged to the 17:00 message and not to the message the user deleted.

## Goals / Non-Goals

**Goals:**
- Hide stale warnings automatically once chat works again.
- Let the user dismiss a warning, on every device.
- Let the user retry the failed message in place.

**Non-Goals:**
- Retrying trigger, failure-follow-up or other non-chat executions.
- Changing how executions start or why they fail.
- Retrying automatically.

## Decisions

1. **"Later message started" is a reversible client-side display rule.** Chat hides a failed message's warning while any user message with a higher sequence has `dispatch.state === 'started'`. The stored failure is unchanged, so the message record stays accurate. If that later message is deleted, the earlier failure is unresolved again and its warning comes back. That is intended: Dismiss is the permanent way to hide it. *Alternative:* have the server mark earlier failures dismissed when a later message starts. That rewrites records as a side effect, and it needs a scan on every post.

2. **Each dispatch carries an attempt number.** `BotMessage['dispatch']` gains `attempt` (absent means 1) and `dismissed`. Retry and Dismiss name the `revision` and `attempt` the client saw. Each accepted retry writes `pending` with `attempt + 1`. A stale request names an old attempt and is refused, even across clients and reconnects. *Alternative:* guard only on `state === 'failed'`. A delayed request from another client would then retry a newer failure it never saw.

3. **Retry and Dismiss require the observed message revision.** This matches the existing contract that message mutations require an unchanged revision (`bot-container-engine`, "Chat messages can be revised and cleared"). A client cannot retry text that was edited elsewhere without first seeing the edit.

4. **Dismiss is stored on the message.** A new `bots.messages.dismiss` command writes the same failed dispatch with `dismissed: true` through `setDispatch`. That emits a `message.dispatch` event, so every open Chat updates. *Alternative:* per-device local storage like the read position. That would leave the warning showing on other clients.

5. **Retry reuses the post dispatch path.** A new `bots.messages.retry` command calls `BotService.retryUserMessage(botId, messageId, revision, attempt)`. Inside the bot's `serialize` section, it checks author, state, dismissal, revision and attempt, then writes `pending` with the next attempt. Outside the section, it runs the start-and-record tail that `postUserMessage` uses, factored into one private method. That tail already turns a failed `setDispatch`, such as one after the message was deleted, into a conflict, so a late result cannot bring a deleted or cleared message back. Like post, the protocol handler records the requesting client as the bot's viewer, so the retried execution acts for that client's window (ADR-0102).

6. **Restart during a retry uses the existing reconciliation.** A retried message is `pending`, so `reconcile` treats it like any pending post. If an execution linked to the message exists, the message becomes `started`. Otherwise it becomes `failed`, with the restart reason and no new start. Recovery never starts work itself. The linked-execution lookup can only match the retry's execution, because a failed attempt never created one.

7. **Both commands sit behind the existing bot authority check.** `messageProtocol.ts` resolves the bot through `data()`, which calls `assertBotAuthority`. Message IDs are looked up within that bot. They use the same `write` scope policy as the other message commands. No new boundary is crossed: like posting, retry starts an execution of a bot the caller can already message.

8. **Failure texts say "retry".** The start-failure text and the restart text change from "send a new message" to "retry".

## Risks / Trade-offs

- [A hidden warning comes back when the later started message is deleted] → This is intended and documented. The user can dismiss it.
- [A retried message's execution answers out of order with newer messages] → This is acceptable. Executions already run concurrently, and the bot sees message order in its briefing.
- [Old clients ignore `dismissed` and `attempt`] → They still show a dismissed warning and cannot retry. The fields are optional and additive, so nothing breaks.

## Validation baseline

Before this change, `openspec validate --all` already reported 7 failing items, all in other in-flight changes (`add-terminay-bots`, `bot-chat-image-attachments`, `linked-folders`). This change is judged on its own validation, `openspec validate bot-chat-dispatch-failure-recovery`, and on not adding failures to that list.
