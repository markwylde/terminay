## Context

See proposal.md. The defect was reproducible: a single Codex process held both a root
rollout and a newer subagent rollout open for writing, and newest-modification-time
selection bound the terminal to the subagent.

## Goals / Non-Goals

Goals:
- Bind a terminal to its Codex root rollout deterministically.
- Keep resumed and branched root sessions working.

Non-Goals:
- Projecting subagent journals as terminal roots in any form.
- Changing discovery for other providers.

## Decisions

- **Root eligibility is proven from provider metadata, not from file timing.** A writable
  rollout is admitted only when its records carry valid root CLI session metadata; a rollout
  without that metadata is not admitted at all.
- **Selection stays deterministic among eligible roots.** When several proven root rollouts
  are eligible, the most recently modified one wins, which keeps resumed and branched root
  sessions resolving predictably.
- **The existing safety envelope is unchanged.** Fail-closed path handling, exact
  process-tree binding, size bounds, and malformed-record tolerance are preserved rather
  than reimplemented.

## Risks / Trade-offs

- Tightening admission means a Codex build that stops emitting root session metadata would
  present no agent rather than the wrong agent. That is the intended fail-closed direction.
