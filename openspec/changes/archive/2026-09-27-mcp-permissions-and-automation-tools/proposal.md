## Why

An agent running in a Terminay terminal can manage terminal tabs through the
Terminay MCP server, but it cannot see or manage automations. The user has to
leave the agent, open Home, and build the automation by hand. Every MCP tool is
also silently allowed today, so the user has no way to say "open tabs freely,
but ask me before you schedule something that runs on its own".

Automations are the riskier of the two. They run unattended, on a schedule or on
events, in the automation terminal space, which holds workspace-scoped MCP. An
agent that can create one without asking can arrange for work to run later with
wider reach than its own project. The user wants that power, but behind a prompt
they answer in place, next to the terminal that asked.

## What Changes

- **New MCP automation tools**, server-wide like automations themselves:
  `list_automations`, `get_automation`, `list_automation_runs`,
  `create_automation`, `update_automation`, `delete_automation`,
  `set_automation_enabled`, `run_automation`, and `stop_automation_run`. They are
  available to project-scope and workspace-scope callers alike.
- **MCP permission policy.** Every MCP operation belongs to one of four
  permission groups: **Read Terminals**, **Full Terminal Management**, **Read
  Automations**, and **Full Automation Management**. Each group has a policy of
  **Ask Permission**, **Always Allow**, or **Never Allow**. The policies are set
  in Settings > AI > Terminay MCP. The defaults are Always Allow for both
  terminal groups and for Read Automations, which keeps today's behaviour, and
  Ask Permission for Full Automation Management.
- **Inline approval prompt.** An operation whose policy is Ask waits for an
  inline prompt attached to the calling terminal, for example: "Claude in
  Terminal 1 wants to add an automation 'Email digest' that runs … every 10
  seconds." The prompt offers **Allow One Time**, **Allow This Session**, and
  **Decline**. It appears inside the terminal pane in the desktop, web, and
  mobile clients, never as a modal or a separate window. The request waits until
  the user answers, the caller cancels, or the terminal's authority ends.
- **Session grants.** "Allow This Session" allows that permission group for the
  requesting terminal until the terminal's capability is revoked. Revocation
  happens on terminal exit, a move to another project, MCP being disabled, or a
  server restart. Session grants are never persisted.
- **Never Allow** returns a stable `permission_denied` error that names the
  setting to change. The tool stays registered, and `get_mcp_capabilities`
  reports each tool's effective policy.
- **BREAKING (contract):** this reverses the rule that automations are never
  created, edited, enabled, or run through MCP. A new ADR supersedes ADR-0030's
  "workspace scope never manages automations" commitment.
- The completed `home-sidebar-and-automations` change is archived as part of
  this branch, so the `automations` spec exists in `openspec/specs/` for this
  change to modify.

## Capabilities

### New Capabilities

- `mcp-permissions`: covers the four permission groups and how operations map
  to them, the per-group policy settings, and server-side enforcement. It also
  covers the inline approval prompt and how it appears in every client, who may
  answer the prompt, binding an approval to the exact request, session grants,
  and the lifecycle of a pending approval.

### Modified Capabilities

- `mcp-server`:
  - Adds the automation tools.
  - The security boundary admits automation management, gated by the permission
    policy.
  - Workspace scope no longer forbids automation tools.
  - Request lifetime is bounded by the approval lifecycle while an approval is
    pending.
  - Capability reporting includes each tool's effective policy.
- `automations`:
  - Automation authority admits MCP callers, subject to the MCP permission
    policy.
  - The run log records runs started by an MCP agent.

## Impact

- **MCP server:** new tools in `apps/terminay-server/src/mcp/stdio.ts`. The
  operation table and policy gate go in `controlEndpoint.ts` and
  `dispatcher.ts`. Desktop adapter wiring goes in `electron/main.ts`. The
  control request timeout changes for approval-gated requests.
- **Automation service:** `packages/server-core/src/automationService/`. It
  gains an internal MCP principal alongside the client wire authority in
  `protocol.ts`, and the run log gets a started-by value for MCP agents.
- **New server-owned approval service** (pending approvals and session grants),
  with protocol events and commands: `mcp.approvals.get`, `mcp.approvals.decide`
  and `mcp.approvals.changed`. The client lives in `packages/client-core`.
- **Settings:**
  - `TerminayMcpSettings` gains `permissions`, with defaults and normalization
    in `src/terminalSettings.ts` and `packages/server-core/src/settings/`.
  - The Settings > AI > Terminay MCP section gets four select rows.
- **Renderer:** an inline approval strip in `src/components/TerminalPanel.tsx`,
  which is shared by the desktop, web, and mobile routes, plus a tab attention
  indicator.
- **Specs and ADRs:** `openspec/specs/mcp-server`, `openspec/specs/automations`,
  a new `openspec/specs/mcp-permissions`, and a new ADR superseding ADR-0030.
