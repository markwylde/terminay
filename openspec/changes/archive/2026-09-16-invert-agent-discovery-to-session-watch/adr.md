# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-16
- Reviewer: Mark Wylde
- Change: invert-agent-discovery-to-session-watch

## In-Force ADR Context Reviewed

- openspec/adr/0022-watch-do-not-poll.md - the rule this change implements: watch, never poll; agent discovery driven by session files; shared ramp; a switched-off feature schedules nothing. Its open item "convert agent discovery to watching the sessions directory" is closed by this change.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - the success metric: `ps`/`lsof` spawns on the idle path go to zero.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - the Detect capability must be proven against each real CLI; the new "evidence written after launch" scenario is added to that proof.
- openspec/adr/0011-security-trust-boundary-model.md - terminal-session and host-issued-context boundaries; the design keeps discovery watches inside the admitted context and rejects cross-context handles.
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - reviewed for the extension-host contract; not affected.
- openspec/adr/0020-per-operation-canonical-roots.md - reviewed; directory handles are resolved per attempt, not cached across contexts, so it is respected.

Superseded and therefore not in force: 0007, 0008, 0009.

## Repository-Level ADRs Created

- openspec/adr/0024-providers-name-the-directories-they-await.md - a `not-bound` observation names the terminal-scoped directories whose change decides binding; the host watches exactly those for the incarnation, re-observes through the shared ramp, and nothing else (no timer, no process sampling) re-runs discovery. A bare `not-bound` ends discovery until the next foreground edge.

## Notes

ADR-0024 refines, and does not supersede, ADR-0022: it fixes the placement of the watch (inside the admitted terminal context, declared by the provider) that ADR-0022 left open. The ADR index at openspec/adr/README.md was updated.
