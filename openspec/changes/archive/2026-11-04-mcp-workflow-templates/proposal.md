## Why

An agent can attach a one-off workflow to its own terminal, but it cannot see or touch the reusable workflow templates the user keeps in Settings > Workflows. A user who asks an agent to "save this as a workflow I can reuse" or "start the review template here" has to do it by hand. The MCP surface also has only one noun, "workflow", so nothing tells an agent that a template and a terminal's workflow are different things.

## What Changes

- New MCP tools for **workflow templates** (the reusable definitions listed in Settings > Workflows and the Command Bar): `list_workflow_templates`, `get_workflow_template`, `create_workflow_template`, `update_workflow_template`, and `delete_workflow_template`.
- A template's category is set by name. A name that matches no existing category creates it. There are no separate category tools.
- `create_workflow` takes an optional `template_id`. The terminal's new workflow is then a copy of that template's name, opening prompt, and steps. Terminay types nothing into the terminal: the calling agent is already the one that will work through it.
- Every workflow and template tool description states which of the two it acts on: a **workflow template** is a reusable, server-wide definition; a **workflow** is the one checklist instance attached to a single terminal, possibly copied from a template.
- Both reaches can use the template tools. Project-reach agents can therefore change server-wide templates, gated by the permission policy.
- A new MCP permission group, **Workflow Templates**, holds the three template write tools and defaults to Ask Permission. Listing and reading templates join **Read Terminals**, next to `get_workflow`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: adds the workflow template MCP tools, starting a terminal's workflow from a template through `create_workflow`, and the template/workflow distinction that the tool surface must state.
- `mcp-permissions`: adds the Workflow Templates group (default Ask Permission), places the template read tools in Read Terminals, and raises the group count shown in Settings from ten to eleven.

## Impact

- `apps/terminay-server/src/mcp/`: `workflowTools.ts` (parsing), `workflowAdapter.ts` (binding to the workflow service), `dispatcher.ts` (operation, scope, group, and handler tables), `controlEndpoint.ts` (operation list), and `stdio.ts` (tool registration and descriptions).
- `packages/server-core/src/workflowService/`: no new protocol operations. The adapter uses the existing `workflows.templates.get` / `upsert` / `remove` operations with expected revisions. The `create_workflow` path accepts a template id.
- `packages/server-core/src/mcpApprovals/`, `settings/defaults.ts`, `src/terminalSettings.ts`, and `src/types/settings.ts`: the new permission group and its default.
- `electron/main.ts` and `packages/server-core/src/agentChat/activity.ts`: availability, approval-prompt summaries, and chat activity lines for the new tools.
- Tests: unit tests for parsing, the adapter, and dispatcher tables; an MCP conformance/E2E scenario that creates a template through MCP and sees it in Settings.
