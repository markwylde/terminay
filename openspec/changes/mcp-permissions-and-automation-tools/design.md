## Context

The Terminay MCP server is a stdio adapter (`apps/terminay-server/src/mcp/stdio.ts`)
that forwards each tool call over a user-only local control socket
(`controlEndpoint.ts`). Every terminal is minted a random per-terminal token
(`electron/main.ts`, `terminalLaunchEnvironmentFor`). The token resolves to an
immutable `ControlCapabilityScope {terminalSessionId, projectId, scope, reach}`,
and `dispatcher.ts` checks an operation scope rank (`read`/`write`) before it
calls a handler from an explicit table. Every token is minted `write`, so in
practice every tool is allowed. The request lifetime is a fixed 120 s
(`CONTROL_REQUEST_TIMEOUT_MS`).

Automations are server-owned and workspace-wide
(`packages/server-core/src/automationService/`). Clients reach them over the
`automations.*` protocol operations. `assertAutomationAuthority` refuses any
claim that carries a session or project, precisely so MCP has no route in. The
`automations` spec and ADR-0030 both say that MCP never manages automations.

The client renderer is one bundle used by the desktop window, browser clients
and the mobile layout, and server state reaches all of them through the ordered
event journal. `TerminalPanel.tsx` already renders inline strips as siblings of
the xterm root, for example the presentation-control bar. Remote device pairing
is the precedent for a server-owned request that any authorized client can
approve.

The user has set these constraints:

- Defaults are Always Allow for both terminal groups and for Read Automations,
  and Ask for Full Automation Management.
- "Allow This Session" covers only the requesting terminal until it exits.
- Run and stop belong to Full Automation Management.
- An unanswered prompt never times out.
- The prompt has an explicit Decline button.
- The prompt is inline in the terminal, never a modal or window, and works in
  the desktop, web and mobile clients.

## Goals / Non-Goals

**Goals:**

- MCP tools covering the full automation lifecycle, server-wide.
- A four-group permission policy set in Settings, enforced on the server.
- An inline approval prompt that any authorized client can answer, bound to the
  exact request.
- Keep today's terminal behaviour as the default, so nobody gets new prompts
  for tab management.

**Non-Goals:**

- Sandboxing the agent. An agent that holds a shell can already run `crontab`,
  launchd or anything else. The permission policy is a guardrail on Terminay's
  own surface, not a containment boundary.
- Per-project or per-agent policies. A single server-wide policy set is enough
  for now.
- Persisted "always for this agent" grants.
- Exposing missed-run dismissal, macros, or any other admin surface through MCP.

## Decisions

### 1. The permission group is a property of the operation table

Each entry in the control operation table gains a `permissionGroup`.
`get_mcp_capabilities` has none. Enforcement is one gate in
`createServerControlDispatcher`: it runs after capability validation and the
existing scope-rank check, and before the handler. Both the desktop adapter
wiring in `electron/main.ts` and the standalone server go through that
dispatcher, so both hosts enforce the policy the same way.

*Alternative considered:* mint tokens with narrower scope ranks from the
policy. That was rejected because policies change at runtime and "ask" is not a
rank. Re-minting tokens would also churn every terminal's environment.

*Boundary:* the gate reads only the operation, the server's stored settings, and
the in-memory grant store keyed by the capability's digest. It never reads
anything the renderer or caller supplies. This preserves the ADR-0011 control
socket invariant.

### 2. Policy lives in server-owned settings

`TerminayMcpSettings` becomes `{ enabled, permissions: { terminalsRead,
terminalsManage, automationsRead, automationsManage } }`, where each value is
`'ask' | 'allow' | 'deny'`. `terminayMcp` is already classified as server
authority, so web and mobile clients read and write the same values through
`settings.update` with no new sync path. The Settings UI is four `select`
fields in the existing `terminay-mcp` section, and `renderFieldControl` already
supports `select`. Normalization fills in the defaults, so an existing
`{enabled}` value upgrades silently.

### 3. A server-owned approval service

A new `mcpApprovals` service in `packages/server-core` holds:

- **Pending approvals.** Each has an id, the calling terminal's session id and
  project id, the operation, the permission group, the retained validated
  request, a structured `detail` for display, the agent label, the terminal
  title, and a creation time. They are queued FIFO per terminal, with a bound of
  8 per terminal.
- **Session grants.** A set of `(capabilityDigest, group)` pairs held in memory
  only.

It publishes `mcp.approvals.changed` with the full pending list, which is small
and bounded. It answers the query `mcp.approvals.get` and accepts the command
`mcp.approvals.decide {approvalId, decision: 'once' | 'session' | 'decline'}`.

Deciding requires the same authority as `terminals.create` on the server. This
reuses the check automations already use for their own wire authority. The
first decision wins. A second decision for the same id returns `not_found`,
which is harmless.

*Alternative considered:* route the prompt through the renderer that owns the
terminal. That was rejected because the MCP spec forbids the renderer from
being an authority or a routing hop. It would also fail on mobile, and it would
fail when no client shows that terminal.

### 4. The request waits on a promise, not a timer

When the gate returns `ask`, the dispatcher awaits
`approvals.request(scope, op, params, signal)`. That promise resolves to
`'allow'` or rejects with `permission_declined`, `permission_denied` or
`cancelled`. While the request is awaiting, the endpoint exempts it from
`CONTROL_REQUEST_TIMEOUT_MS`. Once it is approved, the ordinary timeout applies
to the handler that follows.

The request's `AbortSignal`, which fires when the stdio client cancels or the
socket closes, withdraws the approval. The capability store's revoke hook
(terminal exit, move, MCP disable) withdraws every approval and grant for that
digest, and so does server shutdown.

A settings change re-evaluates every pending approval for the affected group:
`allow` resolves it, `deny` rejects it, and `ask` leaves it pending. The change
also clears that group's grants.

The in-flight connection limit (8 per connection, 64 in total) still bounds
concurrent waiting requests. The per-terminal queue bound of 8 keeps one
terminal from occupying the endpoint.

*Risk accepted:* MCP clients have their own tool-call timeout. Claude Code, for
example, honours `MCP_TOOL_TIMEOUT`. When that fires, the client cancels, the
prompt disappears, and the agent sees a cancellation. That is the correct
outcome, and the user chose "never" for Terminay's own timeout.

### 5. Approve exactly what was shown

The approval retains the params after schema validation. The handler runs those
retained params after approval. For `update_automation`, the params include
`expectedRevision`, so a user edit made while the prompt is pending turns the
approved call into a conflict instead of a silent overwrite.

The `detail` sent to clients is derived from the same retained params:

- the automation name, trigger, action including the full command or text, and
  settings;
- for updates, the changed fields, computed against the current definition when
  the approval is created.

Clients render the plain-words summary with the existing `describeTrigger`,
which moves from `src/workspace/automations/automationsModel.ts` into
`packages/client-core` so the prompt and the Automations section describe
triggers the same way.

### 6. MCP reaches automations through a dedicated internal principal

MCP handlers call the automation registry and executor directly, with an
internal principal `{ kind: 'mcp', terminalSessionId }`. They never use the
client wire operations. `assertAutomationAuthority` keeps refusing session- or
project-bearing claims on the wire path, so a token presented to the client
protocol still gets nowhere. The run log's `startedBy` gains an `'mcp'` value.

Project-scope callers get run-log entries with the subject and output tail
redacted when the subject lies outside their project. The handler does this
with the same `mcpReaches` helper that terminal tools use. Automation
definitions carry no project identity, so they are returned whole.

### 7. Inline prompt in `TerminalPanel`

A `McpApprovalStrip` renders as a sibling above `terminal-panel-root`, following
the presentation-control bar:

- `role="alert"` for screen readers;
- the summary line, then an expandable detail block with a monospace command;
- three buttons: Allow One Time, Allow This Session, and Decline.

It subscribes to a per-connection `useMcpApprovals` hook, patterned on
`useServerAutomations`, and filters by the panel's
`data-terminay-terminal-session-id`. The same component therefore serves the
desktop, web and the mobile `SharedTerminalRouteBody`.

A pending approval also sets the terminal tab's attention indicator through the
existing tab attention path, so a background tab gets noticed. With several
approvals queued, the strip shows the oldest one with a "1 of 3" count.

The agent label comes from the terminal's detected agent session, such as
"Claude" or "Codex", and falls back to "An agent".

## Risks / Trade-offs

- [A project agent with Always Allow on Full Automation Management can create
  an automation whose run terminal holds workspace scope, which is an
  escalation from project to workspace reach.] → The default for that group is
  Ask. The Settings row description says so, and the ADR records it.
- [An agent with Full Terminal Management can type the automation into the Home
  UI or edit crontab.] → This is accepted and stated as a non-goal. The policy
  governs Terminay's MCP surface, not the shell.
- [Prompt fatigue leads to reflexive approval.] → The detail block always shows
  the full command, and "Allow This Session" is scoped to one terminal.
- [A pending approval with no client attached waits forever.] → That is
  intended. It ends on cancellation or revocation, the queue is bounded per
  terminal, and the in-flight limit is bounded per connection.
- [Race between approval and cancellation.] → The service resolves each
  approval once, under a single state transition. A decision for an approval
  that is already withdrawn returns `not_found`.

## Migration Plan

Settings normalization defaults the new `permissions` object. Existing installs
keep terminal behaviour unchanged and gain Ask for Full Automation Management,
which is new surface, so nothing regresses. Rolling back to a build without the
field drops it harmlessly, because normalization ignores unknown keys.

## Open Questions

- ADR-0030 decision 3 ("workspace scope never manages automations") is revisited.
  The adr step records ADR-0031, which supersedes it and restates the rest of
  ADR-0030 as still in force.
