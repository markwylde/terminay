# ADR-0072: MCP reach is the authority line, and workspace reach controls the app except for a fixed excluded set

Status: accepted, supersedes ADR-0068
Date: 2026-10-20
Supersedes: ADR-0068

## Context

ADR-0068 decision 3 made workspace scope widen reach but not powers. A workspace-reach caller got the same tools as a project-scope caller over more terminals. Since then, a user has to reach for the mouse for anything beyond terminals, the agent's view and automations, even when talking to Pixel or to an agent in a Home terminal, whose whole purpose is the app. A user asked Pixel to create a project in their home directory, and it had no tool to do it.

The owner decided the Terminay MCP should be able to do anything a user can do to Terminay, under the permissions in Settings. The one exception is that an agent in a project terminal stays confined to its project. Some things stay UI-only because an agent must never raise its own authority or reach credentials, or because they are Git, file or administration actions the owner chose to keep out.

## Decision

1. **Unchanged from ADR-0068:**
   - MCP authority has two parts: capability scope and a server-owned permission policy per fixed operation group.
   - A capability belongs to exactly one terminal or chat.
   - Ask means a server-owned approval, bound to the exact request.
   - MCP may manage automations through an internal principal.
2. **Reach is the authority line.**
   - Workspace reach is held by automation-space terminals and workspace-reach chats. It grants app-level control: projects, workspace windows, server settings, shell profiles, cross-project terminal moves, Home, notifications across projects, and macros.
   - Project reach grants terminal, view, automation, macro and notification control inside its own project. It also lets the caller rename, re-icon and recolour that project, and nothing beyond it.
3. **Whether a reach may use an operation is fixed per operation, in the server's operation table, beside its permission group.** It is checked before the policy, so an out-of-reach call fails with `out_of_scope` and never prompts. It never depends on parameters, focus or renderer state. A field-level rule, such as project reach editing only its own project's name, icon and colour, is part of that fixed table.
4. **A fixed excluded set is outside every reach:**
   - the MCP permission policies and the Enable Terminay MCP switch;
   - stored credentials;
   - Remote Access;
   - recordings and recording settings;
   - extensions, device pairing and server upgrade;
   - Git and worktree actions;
   - file create, rename, delete and edit, and root-folder browsing;
   - device-local presentation settings.

   Settings are reachable through an explicit allow-list of server setting paths, never a deny-list.
5. **App-level operations execute on the server through a server-internal MCP principal**, never through client wire operations. A presentation effect, such as showing a new workspace window, is applied by the agent's client (ADR-0070), and the server change stands without it.

## Consequences

- Adding an MCP tool means choosing three things: its permission group, whether it needs a calling terminal, and whether it needs workspace reach.
- Adding a server setting does not expose it to MCP. Someone must add it to the allow-list deliberately.
- Workspace reach is now close to a local user's power over the app. Creating a workspace-reach chat still needs only terminal-create authority. That authority could already open an automation-space terminal and run arbitrary commands, so the escalation is in convenience, not capability. The default Ask policy on Change Settings and the excluded set are the mitigations.
- The trust-boundary review (ADR-0011) gains two invariants. No MCP operation reads or writes the MCP policy or a stored credential. Reach is checked from the capability before the policy.
- Expanding the excluded set later is a narrowing and needs no new ADR. Shrinking it, for example to let agents push Git branches, needs one.
