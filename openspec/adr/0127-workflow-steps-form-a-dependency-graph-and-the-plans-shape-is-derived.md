# ADR-0127: Workflow steps form a dependency graph, and the plan's shape is derived from it

Status: accepted, supersedes ADR-0097 in part
Date: 2026-11-16
Supersedes: ADR-0097 (decision 4: templates are flat, ordered lists with no branches, dependencies, or parallel steps)

## Context

ADR-0097 made workflows checklists that an agent drives. Its decision 4 kept
templates flat because the routines users brought were linear. Users now bring
routines with independent work: two reviews of one proposal, then server, UI
and docs built side by side. Agents can run such work in parallel with
sub-agents. A flat list makes them run it one step at a time, and the panel
cannot show two steps under way.

ADR-0097's decisions 1 to 3 still hold. A workflow is a server-owned record
bound to one terminal session. The agent does the work and reports it by step
id. Terminay never executes, schedules or advances a step.

## Decision

1. **Each step names the earlier steps it waits on (`after`).** A step may wait
   only on steps above it in the list, so a plan can never loop and the list
   stays a topological order. A step supplied without `after` waits on the step
   above it, so a plain list still runs one step after another.
2. **Any number of steps may be active.** Dependencies constrain only starting
   a step: starting one whose dependencies are not all done or skipped is
   refused with `step_blocked`. A step already under way can always report
   and finish. The single-active-step rule and `step_active` no longer apply.
3. **The plan's shape is derived, never authored or stored.** Brackets, tracks
   and metro lanes are computed by one client-side function from the
   dependencies. Any dependency that function cannot express is shown in words.
   The template editor's outline is a way of writing dependencies, and the
   server stores only `after`.
4. **The agent still chooses what to run.** Terminay reports which steps are
   ready. It does not start them.

## Rejected alternatives

- **Storing an authored tree of stages.** Workflows created over MCP give only
  dependencies. Two sources of shape would disagree, and an authored tree
  cannot hold a partial dependency.
- **Terminay starting ready steps.** It would turn Terminay into a step runner,
  which ADR-0097 rejected for reasons that still hold.

## Consequences

- MCP clients that relied on `step_active` to serialise themselves see a
  breaking change. The launch and resume instructions now explain dependencies.
- Every surface that shows a workflow's shape uses one derivation, so panel,
  drawer, Home and the editor always agree.
- The outline editor cannot express every graph. It keeps dependencies it
  cannot show until the user changes the outline's shape.
- Downgrading to a server that predates this decision loses the graph of any
  template or workflow it rewrites: the older server drops `after`, and a later
  upgrade reads the record as a plain chain.
- The approved prototype, including the reference layout code, is kept at
  `evidence/0127-dag-run-layouts-prototype.html`.
