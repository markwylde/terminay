# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-24
- Reviewer: Claude (Opus 5.5)
- Change: add-antigravity-agent-support

## In-Force ADR Context Reviewed

- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md: Antigravity detection, and its fixture driver for the Agents-pane proof, come entirely from the pinned library. The pin bump and the README capability matrix change together in this change.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md: the new harness needs no hooks or agy configuration. MCP registration stays a separate, explicit user action.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md (supersedes ADR-0068, which superseded ADR-0031; partly superseded by ADR-0098 and ADR-0100, whose changes concern workflow templates and bots and do not touch terminal capabilities): the Antigravity entry grants nothing. An agy process in a Terminay terminal holds that terminal's reach through the inherited capability, which never appears in the configuration file.
- openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md: agy's MCP child gets the capability only by inheriting it from the terminal.
- openspec/adr/0108-every-server-host-composes-one-mcp-host-with-no-opt-outs.md: install targets keep using the host-supplied MCP command.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Adding a harness and swapping one MCP install target are both covered by the existing session-source and install-target contracts. Dropping Gemini CLI is a product-support decision, not an architectural one.
