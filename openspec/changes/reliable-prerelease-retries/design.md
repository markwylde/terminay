## Context

Canary run 44194905552 planned 6.10.0-main.3636.canary against v6.9.0. Its first attempt built Windows but exited 127 packaging the update probe. Later retries fetched v6.10.0 at the same commit, calculated 6.10.1-main.3636.canary and failed the saved plan comparison. Native runner reproduction will establish the packaging repair.

## Goals / Non-Goals

Goals: preserve the planner's release-base input and fail with actionable packaging diagnostics; verify the actual Windows packaging path. Non-goals: change signing, notarization, version grammar, publication gates or update policy.

## Decisions

Expose the selected canonical release tag as a planner output, using an explicit no-tag value. Pass it back to the version script for desktop jobs, preserving the existing version equality check. Freezing the input also preserves notes. Merely removing the comparison would allow mismatched server and desktop versions. Rerunning all jobs is an operator workaround, not a repair.

Reproduce Windows packaging on a native runner in the existing isolated Windows test repository. Keep diagnostics visible and retain next-version and installer/feed verification. Record the observed failure and final correction with verification evidence.

No renderer, server or credential authority boundary changes. ADR-0110 governs track versions and signing; ADR-0083 governs Windows certification; the Node/npm baseline remains pinned by ADR-0078.

## Risks / Trade-offs

A selected tag could be deleted: fail rather than silently choose another base. A missing planner output must fail rather than fall back to current tags. Native Windows packaging needs runner evidence in addition to local regression tests.

## Migration Plan

Land the workflow and scripts together. Existing failed runs still execute their original workflow; start a new run after merge. Reverting this commit restores the original workflow.

## Open Questions

The Windows packaging exit must be reproduced before choosing its correction. No accepted ADR needs supersession.
