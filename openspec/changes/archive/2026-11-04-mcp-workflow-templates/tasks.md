## 1. Workflow service

- [x] 1.1 `workflow.create` accepts an optional `templateId`: read the template, refuse with `template_not_found` (carrying `templateId`) when missing, re-authorise the target, and attach `instantiateWorkflow(template, template.id, now)` without typing anything. Verified by server-core unit tests for the copy, new ids, `templateId` recorded, missing template, and no `typeText` call.
- [x] 1.2 `WorkflowTemplateRepository` refuses an upsert or replace whose templates need more than `maxCategories` categories with `invalid_workflow`, instead of dropping the category. Verified by a repository unit test at 64 and at 65 categories.

## 2. MCP parsing and adapter

- [x] 2.1 Add parse functions in `workflowTools.ts` for the five template tools and `template_id` on `create_workflow`, refusing `template_id` together with name, opening prompt, or steps. Verified by unit tests for each tool's bounds and the mutual exclusion.
- [x] 2.2 Extend `WorkflowControlAdapter` / `createWorkflowControlAdapter` with `listWorkflowTemplates`, `getWorkflowTemplate`, `createWorkflowTemplate`, `updateWorkflowTemplate`, and `deleteWorkflowTemplate` over `workflows.templates.get` / `upsert` / `remove`. Update and delete do read-merge-write with `expectedRevision` and up to three retries. Pass `templateId` through `createWorkflow`, and return `template_id` from `get_workflow`. Verified by adapter unit tests: partial update keeps fields, step ids are kept, an unknown id gives `template_not_found` without creating anything, and a concurrent revision bump is retried and keeps both edits.
- [x] 2.3 Map `template_not_found` through `serverControlError`, `controlEndpoint.ts`, and `stdio.ts` error codes, carrying the template id. Verified by a stdio round-trip test that receives `template_not_found`.

## 3. Dispatcher, permissions, and registration

- [x] 3.1 Add the five operations to the dispatcher's operation list, scope table (read/write), handler table, and `WORKFLOW_CONTROL_OPERATIONS`, available to both reaches and to chats, with no calling terminal required. Verified by dispatcher table tests and a project-reach call that is not `out_of_scope`.
- [x] 3.2 Add the `workflowTemplates` permission group (label "Workflow Templates", default `ask`) to `mcpApprovals`, server settings defaults, `src/types/settings.ts`, and `src/terminalSettings.ts`. Map the three template writes to it and the two template reads to `terminalsRead`. Verified by unit tests for the defaults and the group table, and by Settings > AI > Terminay MCP showing eleven groups.
- [x] 3.3 Register the five tools in `stdio.ts`, with descriptions that each define "workflow template" or "workflow", and update the `create_workflow` / `get_workflow` descriptions for `template_id`. Verified by a test that asserts each template tool's description names templates and each workflow tool's names the terminal.
- [x] 3.4 Add approval summaries (name, category, step titles; the id for delete) and availability in `electron/main.ts`, and chat activity lines in `agentChat/activity.ts`. Verified by the chat activity unit test, and by the E2E scenario's approval strip naming Workflow Templates (the summary builder lives in `electron/main.ts`, which has no unit harness).

## 4. End-to-end and specs

- [x] 4.1 E2E (via `npm run test:e2e`): an agent capability calls `create_workflow_template` with a new category, and Settings > Workflows lists the template under that category. Then `create_workflow` with its id shows the panel with the template's steps. Verified by the new Playwright scenario passing in Docker.
- [x] 4.2 Run `npm run lint`, `npm run typecheck`, the affected unit suites, and `openspec validate --all`. Verified by clean output.
- [ ] 4.3 Open the PR on Gitea and read back every commit status as `success` or `skipped`. Verified with `tea`/API status output.
- [x] 4.4 Archive the change so the deltas fold into `terminal-workflows` and `mcp-permissions`. Verified by `openspec validate --all` passing after the archive.
