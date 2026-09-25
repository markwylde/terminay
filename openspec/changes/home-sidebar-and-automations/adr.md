# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-24
- Reviewer: Claude (with Mark Wylde)
- Change: home-sidebar-and-automations

## In-Force ADR Context Reviewed

- openspec/adr/0002-sqlite-state-repository.md: the automation stores sit behind a repository/backend interface, like macros, so they move with the SQLite repository.
- openspec/adr/0003-vault-interface-and-key-protectors.md: automations do no secret interpolation; secrets stay in the vault.
- openspec/adr/0011-security-trust-boundary-model.md: the local control socket and privileged client-action rows. ADR-0030 adds the workspace-scoped token row.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md: automations belong to and execute on one server; the automation space runs in the server's local environment.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md: automations are negotiated per connection through the `automations.v1` capability, with a server selector in the section.
- openspec/adr/0028-no-polling-without-owner-approval.md (supersedes 0022): the scheduler arms one one-shot timeout to the earliest due time, and triggers subscribe to canonical event sources. No poll is introduced.
- Others reviewed (0001, 0004–0006, 0010, 0012, 0013, 0015, 0016, 0019–0021, 0023, 0025–0027): not affected.

## Repository-Level ADRs Created

- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md: automations run in a reserved server-owned project kind that is never presented as a project, and only terminals in that space hold a workspace-scoped MCP capability, derived from canonical placement alone.

## Notes

- No in-force ADR is superseded.
- `openspec/adr/README.md` index gains a row for 0030.
