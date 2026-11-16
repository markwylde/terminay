## Context

ADR-0093 let a bot's executions overlap within bounded admission (four work executions plus one reserved user-message coordination slot) "while shared work is leased". The lease is a single per-bot owner held in `BotExecutionRuntime.work`. An execution takes it with `work_acquire`; finishing, stopping, replacement and `work_release` give it back. Every shell command goes through `terminay-tool-shell` or `terminay-shell-env`, and every desktop tool call goes through `terminay-desktop-mcp.mjs`. Each of them runs `terminay-bot-mcp --check-work`. That sends `runtime/check-work` to the host, and the host calls `assertWork`, which refuses any execution that is not the owner.

The briefing already gives each execution `otherExecutions` (up to five summaries) and `totalOtherExecutions`. The coordination tools `sessions_list`, `sessions_get`, `sessions_post`, `sessions_stop` and `sessions_replace` already exist. The owner's intended model needs only those tools; the lease is the part that was never asked for.

Boundary: the bot container is the trust boundary. Same-bot executions share one container, uid and desktop, and they are cooperative peers, not security domains (ADR-0093, `bot-message-log` "Shared resources and admission"). The execution capability (socket token, revocation, epoch) is the authority boundary between a live execution and the host. This change removes a coordination rule inside the container. It does not move either boundary.

## Goals / Non-Goals

**Goals:**

- Every live execution can use the shell and desktop tools without acquiring anything.
- A new execution is told how many others are active and decides whether to stop, steer, replace or ignore them.
- A revoked or ended execution still cannot run gated shell commands or desktop tools.

**Non-Goals:**

- Changing admission limits, the reserved coordination slot, the queue, or trigger pending-firing rules.
- Arbitrating the shared desktop or browser between executions. That is left to the agents, guided by the briefing.
- Isolating executions from one another.

## Decisions

1. **Remove the lease outright, keeping no advisory version.** `work_acquire`, `work_release`, the owner map, the `work.*` events and `ownsWork` all go. An advisory lock would keep the same "who owns it" vocabulary and invite the same misreading. The coordination tools already let an execution see what else is running.
   - *Alternative:* make `work_acquire` wait for the owner. Rejected because the waiting execution still can't do unrelated work, and a monitor run that takes the full 30-minute turn limit would stall everything behind it.
   - *Alternative:* serialize executions per bot. Rejected because ADR-0093 already rejected a single per-bot queue, and the owner wants corrections to start immediately.

2. **Keep the shell and desktop gate as a liveness check.** `runtime/check-work` stays on the wire, and the host answers it with the existing `assert(id)`: the capability is live, not revoked, the epoch matches, and the state is running or needs-you. A replaced or stopped execution therefore can't run shell or desktop actions in the window between revocation and the end of its process group. Keeping the method name avoids changing the container adapter's argument contract (`--check-work`). It crosses the execution-capability boundary in the same direction as before, with a narrower check.
   - *Alternative:* drop the gate entirely. Rejected because revocation would then stop chat posts but not shell commands, which the "Execution revoked" contract implies it should.

3. **The reserved coordination slot is admission only, and it is given back as soon as possible.** An execution in that slot has the full tool set. Previously `work_acquire` promoted it into an ordinary slot when one was free. Instead, whenever an execution ends, `BotTurnQueue` moves the oldest reserved-slot execution into the freed ordinary slot before it dispatches waiting work. Replacement keeps its existing reservation and promotion. So the reserved slot is busy only while all four ordinary slots are, and a later correction is not held up behind unrelated work that started in the reserve. The briefing's `coordinationOnly` flag is removed, because it no longer limits anything.
   - *Alternative:* leave the execution in the reserve until it ends. Rejected because one unrelated request could hold the correction slot for a whole turn (thirty minutes by default).

4. **The briefing makes the decision explicit.** The wording replaces the "call work_acquire" line. "Active" means running or waiting on the user, matching admission. `otherExecutions` and `totalOtherExecutions` both use that filter, so queued records can neither inflate the count nor crowd running executions out of the bounded list. A separate `queuedExecutions` count reports waiting work. The briefing names the active count and tells the agent to compare its task with `otherExecutions` and choose. It can stop the other execution, steer it with `sessions_post`, replace it with `sessions_replace`, or leave it running and do its own work. It also says the desktop and browser are shared: don't drive them while another active execution appears to be using them, and coordinate first. Shell work in separate directories runs side by side. The briefing is a snapshot taken at startup, so it also tells the agent to re-check with `sessions_list` or `events_next` before taking the desktop. Two executions that start at the same moment can still race. That is accepted rather than adding another exclusive lease.

5. **A refused gate must not strip the token from later commands.** Recorded runs show the same sequence each time. The agent runs a shell command before `work_acquire`, and the gate correctly refuses it. Every later command in that run then fails with "runtime request failed or capability revoked", which is the adapter's report for a runtime socket with no token. Runs that acquired the lock first kept a working shell throughout. Both gate scripts unset `TERMINAY_RUNTIME_TOKEN` but leave `TERMINAY_RUNTIME_SOCKET` set. So any environment that one gated command captures and a later command reuses (a nested `bash`, or the agent's persisted shell state) passes the socket without the token, and fails the next gate. Once a command has passed the gate, the scripts also unset `TERMINAY_RUNTIME_SOCKET`, so a nested shell inside that command is never gated again without a token. A regression test runs a gated command, then a nested shell, then a second command that reuses the captured environment. Removing the lease already removes the usual trigger, the refused first command, and this closes the underlying hole.

6. **Desktop tools receive the runtime pair they check with.** The desktop MCP checks liveness before each tool call by running the adapter. Before this change it never had a token to check with. Claude launched it through `terminay-tool-shell`, which strips the pair, and Codex launched it with the empty environment the server declared, so every call was refused. Verification surfaced this once the refusal no longer read as a lock. The server now declares the runtime pair for `terminay_desktop` and `terminay_browser`, as it does for `terminay_bot`. `terminay-tool-shell` passes the pair through for exactly those two launch commands, the same fixed-string bootstrap it uses for the adapters. The desktop MCP moves the pair out of its own environment at startup and passes it only to the adapter check, so `chrome-devtools-mcp` and the desktop tools it runs never inherit the token. This stays inside the execution-capability boundary: the token goes only to Terminay-owned processes that check it.

## Risks / Trade-offs

- [Two executions drive the desktop or browser at once and interfere] → The briefing warns against it and the coordination tools let an execution check first. Interference stays inside one bot's own container and affects only that bot's work.
- [Two executions edit the same files] → Same mitigation. Agents already work in a shared home, and this matches how two user terminals behave.
- [A bot prompt, instruction or memory still says to call `work_acquire`] → The tool no longer exists, so the call fails with "Unknown bot runtime tool" and the agent carries on without it. The briefing no longer mentions it, but retained instructions or memories still can, so the failure is harmless rather than impossible.
- [Unsetting the socket hides it from a legitimate nested gate] → A nested command runs inside one that already passed the gate, and process-group cleanup still ends it when the execution is stopped or replaced.

## Migration Plan

Ship the server and the rebuilt bot image together. The image check already rebuilds a bot whose image inputs changed, and replaces its container when the bot next starts. A server upgrade restarts the server, and the restart contract ends remaining session process groups and marks active executions interrupted. Rollback restores the previous image and server, and nothing persisted changes.

## Open Questions

None. ADR-0093 is superseded in part by a new ADR that records the removal of the lease.
