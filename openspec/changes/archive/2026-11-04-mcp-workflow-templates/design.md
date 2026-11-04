## Context

Workflow templates are server-owned, revisioned state (`WorkflowTemplateRepository`, file `workflow-templates.v1.json`). They are edited in Settings > Workflows through the `workflows.templates.get` / `upsert` / `remove` / `reorder` / `replace` protocol operations. A terminal's workflow is a separate record, bound to one session in `WorkflowStore`. A template becomes a workflow through `workflow.launch`, which copies the template and types the `/goal` launch text, or an agent writes a workflow directly through `create_workflow` → `workflow.create`.

The MCP surface has only the three workflow tools (ADR-0097), bound by `workflowAdapter.ts` through the server-internal MCP principal. Under ADR-0072, project reach covers only its own project's terminals, views, automations, macros, and notifications. Templates belong to the whole server.

## Goals / Non-Goals

**Goals:**
- Agents can list, read, create, update, and delete workflow templates over MCP, from either reach.
- Agents can start a terminal's workflow as a copy of a template.
- The tool surface makes it unmistakable whether a call acts on a template or on a terminal's workflow.

**Non-Goals:**
- Reordering templates or reordering, renaming, or deleting categories over MCP. Those stay in Settings.
- Typing the `/goal` launch text from MCP. A user's Command Bar launch remains the only path that writes to the terminal (ADR-0097).
- Macro CRUD over MCP.

## Decisions

### 1. Template tools are MCP adapters over the existing template operations

`list_workflow_templates` and `get_workflow_template` call `workflows.templates.get` and project the result. `create_workflow_template` and `update_workflow_template` call `workflows.templates.upsert`, and `delete_workflow_template` calls `workflows.templates.remove`, all as the MCP principal. Settings and MCP therefore share one validation path, one durable write path (ADR-0088), and one `workflows.templates.changed` event, which is how other clients see an agent's edit.

*Alternative:* new MCP-only service methods. They would duplicate validation and could drift from what Settings accepts.

### 2. Read-merge-write with the expected revision, retried

`update_workflow_template` and `delete_workflow_template` read the state, check that the template exists (otherwise `template_not_found`), build the full template (merging the given fields into the stored ones; steps given replace the list, with known ids kept by `validateTemplate`), and submit it with `expectedRevision` set to the revision they read. On a revision conflict they re-read and retry, up to three times, then fail with `conflict`. This keeps a concurrent Settings edit to another template. It also stops an update from silently re-creating a template that was deleted meanwhile, because `upsert` of an unknown id would otherwise create it. `create_workflow_template` sends no id, so the server assigns one, and it needs no revision check.

*Alternative:* a new atomic `patch` command in the repository. It is cleaner, but it adds a protocol operation for one caller. The retry loop uses what exists and is bounded.

### 3. Categories by name, refused rather than dropped at the bound

The upsert path already appends an unknown category to the list and matches existing ones ignoring case. Today `normalizeCategoryList` silently drops a 65th category, and the template then loses its category. The repository will instead refuse an upsert or replace whose templates would need more than `maxCategories` categories, with `invalid_workflow`, which MCP reports as `bad_request`. This also changes Settings from silently losing a category to showing an error, which is the correct behaviour there too.

### 4. `create_workflow` with a template is copied on the server

`workflow.create` gains an optional `templateId`. When it is present, the server reads the template, refuses with `template_not_found` if it is missing, and uses `instantiateWorkflow(template, template.id, now)`, the same copy `workflow.launch` makes, minus the typed text. The adapter refuses `template_id` combined with name, opening prompt, or steps as `bad_request` before calling the server. Copying on the server keeps the read and the attach in one request and records `templateId` on the workflow, which `get_workflow` now returns as `template_id`.

**Boundary:** the terminal-session boundary is unchanged. The target terminal is resolved and authorised exactly as for `create_workflow` today. Nothing is written to the PTY, so ADR-0097's "only the launch and resume texts are typed" still holds.

### 5. Reach: both reaches may write templates (supersedes part of ADR-0072)

Template tools need no calling terminal and are allowed for project reach. A project-reach agent can therefore change state that every project on the server sees: the Command Bar of every terminal. This crosses the project boundary that ADR-0072 drew around project reach. ADR-0098 records the decision and the narrow conditions on it:
- The content is user-authored text that is never executed. A template's prompts reach a terminal only when a user launches it, or when an agent copies it into its own reachable terminal.
- The writes sit in their own permission group, which defaults to Ask.
- The approval prompt shows the template's name, category, and every step title.

### 6. New permission group "Workflow Templates", default Ask

`create_workflow_template`, `update_workflow_template`, and `delete_workflow_template` go into a new group `workflowTemplates`, labelled "Workflow Templates", with default `ask`. `list_workflow_templates` and `get_workflow_template` go into Read Terminals beside `get_workflow`: they disclose only user-authored checklists, and putting reads in an Ask group would make discovery prompt. `create_workflow` stays in Full Terminal Management whatever its parameters, because a group never depends on parameters.

*Alternative:* reuse Change Settings, which is already Ask. Change Settings is workspace-only in reach terms. Sharing it would also force a user who wants agents to curate templates to let them change server settings too.

### 7. Naming and descriptions carry the distinction

Template tools all contain `workflow_template`, and workflow tools never do. Each description opens with one sentence that defines its noun: "A workflow template is a reusable definition in Settings > Workflows …" or "A workflow is the checklist attached to one terminal …". `create_workflow` says that `template_id` copies a template into this terminal. `create_workflow_template` says it saves a reusable template and attaches nothing.

### 8. Error codes

`template_not_found` joins the MCP error codes in `controlEndpoint.ts` and `stdio.ts`. `serverControlError` maps a protocol `not_found` whose `details.reason` is `template_not_found` to it, carrying `templateId`, the same way `no_workflow` is mapped today.

## Risks / Trade-offs

- [A project-reach agent edits or deletes a template another project relies on] → The writes are in an Ask-by-default group, and the approval shows the content. Workflows already copied are unaffected. A user who doesn't want this sets the group to Never Allow.
- [An agent writes a large or misleading prompt into a template that a user later launches] → The template bounds apply. The Settings editor shows the full launch text before saving and the Command Bar shows the name. Nothing runs until a user launches the template and the agent in that terminal follows it, which is the same trust as a user typing it.
- [The retry loop gives up under heavy concurrent editing] → It fails with `conflict` and changes nothing. The agent can retry.
- [Refusing a 65th category changes Settings behaviour] → A category used to be silently lost. The refusal is visible and recoverable.

## Migration Plan

No data migration. The permission settings normaliser fills the missing `workflowTemplates` policy with its default (`ask`) on load, as it does for any absent group. Rollback is a code revert. Templates created through MCP are ordinary templates.

## Open Questions

None. ADR-0098 records the partial supersession of ADR-0072.
