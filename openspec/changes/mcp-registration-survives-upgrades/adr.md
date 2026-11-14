# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude
- Change: mcp-registration-survives-upgrades

## In-Force ADR Context Reviewed

- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - defines the standalone archive and release channels whose versioned directories the registration named.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - installing the Terminay MCP server is the one approved write to agent configuration; Replace stays within that exception and touches only the `terminay` entry.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md - Desktop updates in place, which is why its registered paths stay valid and it is left unchanged.

## Repository-Level ADRs Created

- openspec/adr/0119-a-standalone-server-names-its-installations-stable-pointer.md - a standalone server names `<prefix>/current`, never a release directory, in anything that outlives it, and never repairs agent configuration without a user action.

## Notes

None.
