# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Mark Wylde
- Change: mcp-token-lives-with-terminal

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the endpoint still
  authenticates the token digest and rechecks revocation on every request; only
  the time-based expiry goes, and revocation on exit, move, shutdown, and MCP
  disablement is unchanged.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md -
  capability reach from canonical placement; reach and
  scope derivation are untouched.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix: the main spec already ties a token's life to its terminal; the
24-hour TTL contradicted it.
