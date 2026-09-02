## 1. Root eligibility

- [x] 1.1 Specify the provider metadata that distinguishes a root Codex CLI rollout from an in-process subagent rollout, verified by the governing specification stating the root eligibility rule.
- [x] 1.2 Add a process-bound regression test with a root journal and a newer subagent journal held by the same writer, verified by the test failing on the old newest-file behaviour.
- [x] 1.3 Filter discovered writable rollouts to proven root CLI journals before selecting the most recently modified eligible root, verified by the regression passing.
- [x] 1.4 Preserve fail-closed path, process-tree, size, and malformed-record handling, verified by the existing exact-process-tree and delayed-resume discovery tests staying green.
- [x] 1.5 Run the focused server-core agent journal tests, verified by a passing run on supported journal-discovery platforms.

## 2. Acceptance checks

- [x] 2.1 A newer writable subagent rollout cannot be selected as a terminal's root journal.
- [x] 2.2 Multiple eligible root CLI rollouts resolve deterministically to the most recently modified root, supporting resumed or branched sessions.
- [x] 2.3 A writable rollout without valid root session metadata is not admitted.
