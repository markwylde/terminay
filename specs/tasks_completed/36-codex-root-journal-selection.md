# Codex root journal selection

## Goal

Keep a Terminay terminal bound to its Codex root rollout when the same Codex
process also holds branch or subagent rollout journals open.

## Governing specification

- [Agent status and Agents sidebar](../features/agent-status-and-sidebar.md)

## Why this was needed

Codex can keep several rollout files writable in one process tree. Discovery
previously chose the rollout with the newest modification time without first
proving that it represented a root CLI session. A recently active subagent
could therefore displace the root and prevent reliable project agent
presentation.

## Work slices

- [x] Specify the provider metadata that distinguishes a root Codex CLI rollout
  from an in-process subagent rollout.
- [x] Add a process-bound regression test with a root journal and a newer
  subagent journal held by the same writer.
- [x] Filter discovered writable rollouts to proven root CLI journals before
  selecting the most recently modified eligible root.
- [x] Preserve fail-closed path, process-tree, size, and malformed-record
  handling.
- [x] Run the focused server-core agent journal tests.

## Acceptance checks

- [x] A newer writable subagent rollout cannot be selected as a terminal's root
  journal.
- [x] Multiple eligible root CLI rollouts continue to resolve deterministically
  to the most recently modified root, supporting resumed or branched sessions.
- [x] A writable rollout without valid root session metadata is not admitted.
- [x] Existing exact-process-tree and delayed-resume discovery tests remain
  green.

## Definition of done

The governing feature specification states the root eligibility rule, the
regression fails on the old newest-file behavior and passes with the fix, and
the focused server-core tests pass on supported journal-discovery platforms.
