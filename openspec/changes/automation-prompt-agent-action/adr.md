# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-05
- Reviewer: Mark Wylde
- Change: automation-prompt-agent-action

## In-Force ADR Context Reviewed

- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md -
  a prompt-agent run is a run-command run: same server-owned space and run
  terminal.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md -
  creating or editing the new action over MCP uses the existing automation
  scope and policy.
- openspec/adr/0011-security-trust-boundary-model.md - the prompt crosses to
  the command as environment data and is never parsed as shell by Terminay.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  the run executes on the owning server.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

One more action kind on the existing launch path. Passing user text as an
environment variable rather than splicing it into a command line follows the
existing `TERMINAY_*` context pattern.
