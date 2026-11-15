# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Claude (Opus 5.5), for the repository owner
- Change: claude-runs-without-agent-view

## In-Force ADR Context Reviewed

- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - setting a variable to change how an agent behaves needs owner approval; granted and recorded in ADR-0124.
- openspec/adr/0105-a-launcher-may-start-an-agent-with-a-user-confirmed-initial-prompt.md - in force for command defaults (flags only); superseded by ADR-0124 to allow environment. Initial-prompt rules carry forward unchanged.
- openspec/adr/0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md - its gating and "the user's choices win" rules carry forward through ADR-0105.
- openspec/adr/0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md - environment reaches the shell as data; no script changes.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - detection and the binding rule are unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - extension answers are validated by the host and again by the registry.

## Repository-Level ADRs Created

- openspec/adr/0124-a-command-default-may-set-environment-on-the-integrated-shell.md - owner-approved: a command default may set environment on the integrated shell; `claude` → `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` is approved alongside `codex` → `--no-daemon`.

## Notes

- The unarchived `terminal-command-defaults` change adds the `shell-integration` capability and the Codex requirement. This change's deltas avoid depending on it: they modify `extension-platform`, already in the main specs, and add requirements to `builtin-agents-extension` and `shell-profiles-and-terminal-launch`.
