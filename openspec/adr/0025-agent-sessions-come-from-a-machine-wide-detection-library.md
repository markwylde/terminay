# ADR-0025: Agent sessions come from a machine-wide detection library; the host scopes them by directory and binds them by process ancestry

Status: accepted, supersedes ADR-0014, ADR-0024
Date: 2026-09-19
Supersedes: ADR-0014, ADR-0024

## Context

ADR-0014 made each agent provider extension declare its capabilities and prove them against its real CLI. ADR-0024 made a provider that could not bind name the directories it was waiting on, so the host could re-run a terminal-scoped observation. Together they produced this stack:

- five provider extensions, each with its own journal parser, binding rules, mapping versions, fixtures, and real-CLI Docker harness
- a host runtime that matched foreground processes, admitted terminal incarnations, brokered `ps`/`lsof`/directory evidence, and re-ran observation on directory changes

Users still saw wrong status. Sessions stayed working after finishing, failed to bind, or bound to the wrong conversation. Every fix had to reason about both the provider's journal and the host's admission state machine. The design also could not show an agent the user started outside a Terminay terminal, even in the same project, because observation began from a terminal's foreground process.

`@markwylde/all-your-agents` now exists as a separately maintained library. It:

- watches every coding-agent session on a machine without polling
- reduces each harness's own files into one session object with status, title, model, activity, and subagents
- proves each harness against its real CLI in its own suite

## Decision

1. **Detection lives in one library, inside one extension.** The built-in agents extension runs `@markwylde/all-your-agents` and contains no parser, matcher, inference rule, or timer of its own. Terminay fixes detection defects upstream in the library, not in Terminay.
2. **Extensions report sessions, not lifecycle events.** The Extension API contract for agents is a session source. It publishes bounded, machine-wide snapshots of live sessions (reset, upsert, and remove). Terminal-scoped provider callbacks, the observation broker, not-bound wait sets, and the lifecycle publisher no longer exist.
3. **The host owns project scope and terminal binding.**
   - **Project scope:** a session belongs to a project when its working directory is at or below the project root, or at or below any worktree of the project's Git repository. The worktree set is refreshed by watching repository metadata.
   - **Terminal binding:** a session binds to a terminal when its owning process descends from that terminal's PTY shell. The host reads process ancestry itself, on new-session and terminal edges only. Nothing an extension says is terminal evidence.
4. **Unbound sessions are shown, not hidden.** A session in a project's scope that no terminal owns appears as external. It is inert, and it never contributes unread indicators.
5. **Capability claims are the library's.** Terminay publishes the pinned library version's capability matrix and proves the Agents pane end to end with the library's fixture drivers. It keeps no real-CLI harness of its own.

## Consequences

- One reducer from snapshot to entry replaces two state machines. Status bugs have one place to live.
- The Agents pane shows agents started anywhere on the server's machine under a project's directories. Viewing such an agent's terminal is not possible, and resuming it from Terminay is out of scope.
- Terminay's agent coverage is exactly the library's. A harness the library does not support, OpenCode at the time of this record, has no agent status.
- ADR-0022 still governs. The library never polls. Ancestry is read only on edges, and the worktree watch uses the shared ramp. ADR-0022's agent-specific open items are overtaken by this record.
- Third-party agent extensions built on the terminal-observer API are incompatible with Extension API 3.0 and must be rewritten as session sources.
- Detection now depends on a library outside this repository. Upgrades are pinned exactly and change the published matrix in the same change.

## Open items

- The library is AGPL-3.0-or-later and Terminay is MIT. It must be relicensed or dual-licensed before a release ships it.
