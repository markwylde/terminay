# Verification

Verified 2026-11-08 against the archived delta, canonical built-in-extensions spec, implementation, and tests.

- Completeness: all five tasks complete; canonical Gitea mapping block equals the delta. The overlapping merged-pull-request-on-both-forges delta retains the new rule and its own deleted-branch scenario.
- Correctness: local-first and order independence, base tracking, upstream fallback, fork exclusion, absent head metadata, detached worktrees, and deleted local merged precedence are covered in parsing.test.mjs. Existing refresh tests cover open-over-merged, deleted branches, no-PR checks and branches without upstreams. New refresh tests prove head-SHA checks, bounded request count, and invalid local publication suppression.
- Coherence: only matchPullRequest changes; trackedBranch remains the no-PR checks fallback. No credential, remote selection, API, UI, or refresh scheduling changes.
- Commands: 34/34 Gitea tests pass; Gitea typecheck and Biome checks pass; git diff --check passes.
- Validation: this archive and canonical spec pass. openspec validate --all retains seven baseline failed active changes: add-terminay-bots, bot-chat-image-attachments, linked-folders, one-window-one-server, outbound-bot-triggers, server-notification-manager, unified-settings-window. openspec validate --all --archived retains four baseline failed archives: 2026-09-06-agent-provider-status-conformance, 2026-10-07-notifications-icon-and-project-dot, 2026-10-10-macros-script-editor, 2026-11-04-mcp-workflow-templates.
- Screenshots and local Electron E2E are skipped for this nonvisual extension mapping change, as authorized by the workflow opening prompt. Extension refresh tests exercise the relevant publication path; PR CI remains required.

No implementation/spec gaps remain. Known limitation: name matching can select a historical merged PR when a local branch name is reused; branch identity intentionally takes priority over an upstream PR. Bounded forge listings are unchanged.
