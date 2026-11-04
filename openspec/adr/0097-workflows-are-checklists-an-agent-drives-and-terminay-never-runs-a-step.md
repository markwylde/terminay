# ADR-0097: Workflows are checklists an agent drives, and Terminay never runs a step

Status: accepted
Date: 2026-11-04

## Context

Users drive coding agents through repeatable routines: propose, review, fix, apply, test, archive, and open a pull request. They wanted Terminay to hold those routines as templates, show progress in the terminal, and let the routine survive a lost agent session.

There are two ways to build that. Terminay could run the routine: type each step's prompt when it judges the agent ready, and advance on completion. Or the agent could run it: Terminay stores the steps and their status, and the agent reads the list and reports progress through MCP.

Running it in Terminay is a workflow engine. It has to decide when an agent has finished and is ready for input, which Terminay can only guess from terminal activity. It would also make status reports write to the PTY, and every new routine shape (branches, retries, timeouts) would become engine work. Agents can already follow an ordered list well when they have a durable place to read it from.

## Decision

1. **A workflow is a record of steps and their status, bound to one terminal session.** It is server-owned and lasts as long as its session, as app window records do (ADR-0076).
2. **The agent does the work and reports it.** It reads the workflow with `get_workflow` and changes a step's status only through `update_workflow_step`. Steps are addressed by stable server-assigned ids, never by title or position.
3. **Terminay never executes, schedules, times out, retries, or advances a step.** The only terminal writes a workflow causes are the fixed launch and resume texts, which the user starts from the Command Bar. A step's prompt is never typed by Terminay.
4. **Templates are flat, ordered lists.** They have no branches, dependencies, or parallel steps.

## Rejected alternatives

- **A step runner that types each prompt in turn.** It depends on guessing agent readiness, turns status updates into privileged terminal writes, and grows into an engine.
- **Branching or graph-shaped templates.** The routines users brought are linear, and the agent can make decisions within a step's prompt.

## Consequences

- If the agent does not report, the panel is stale. The launch instruction, the single-active-step rule, and Resume mitigate this. Terminay does not guess progress.
- A request to "run the next step automatically" or to add conditional steps needs a new ADR that supersedes this one.
- Supporting another agent means adding launch text for it. Templates and the MCP tools stay the same.
