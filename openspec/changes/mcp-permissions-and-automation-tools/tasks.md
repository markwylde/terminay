## 1. Permission settings

- [ ] 1.1 Extend `TerminayMcpSettings` with `permissions { terminalsRead, terminalsManage, automationsRead, automationsManage }` (`'ask' | 'allow' | 'deny'`) in `src/types/settings.ts`, with defaults (allow, allow, allow, ask) in `src/terminalSettings.ts` and `packages/server-core/src/settings/defaults.ts`, and normalization that fills missing or invalid values. Verify: a settings normalization test shows `{enabled:true}` normalizes to the defaults and an invalid value falls back to its default.
- [ ] 1.2 Add four `select` rows (Read Terminals, Full Terminal Management, Read Automations, Full Automation Management; options Ask Permission / Always Allow / Never Allow) to the `terminay-mcp` section. The Full Automation Management description notes that automation runs have workspace reach. Verify: the settings section renders the rows in the Settings window and in the browser client, and changing one on one client shows on the other.

## 2. Permission gate in the control dispatcher

- [ ] 2.1 Add `permissionGroup` to every entry of the control operation table (`controlEndpoint.ts` / `dispatcher.ts`), with none for `get_mcp_capabilities`, per the `mcp-permissions` group list. Verify: a table test asserts every operation except `get_mcp_capabilities` has exactly one group and matches the spec list.
- [ ] 2.2 Add the policy gate in `createServerControlDispatcher` after capability validation and the scope-rank check. `deny` returns `permission_denied` (naming the group and the Settings path), `allow` dispatches, and `ask` awaits the approval service. Verify: `scripts/control-server.test.mjs` cases for each policy, including no handler side effect on deny, and a caller-supplied "approved" field being ignored.
- [ ] 2.3 Exempt requests awaiting approval from `CONTROL_REQUEST_TIMEOUT_MS`, and restore the ordinary timeout for the handler that runs after approval. Verify: a fake-clock test holds an approval past 120 s and it is still pending, then approves it and the handler runs.
- [ ] 2.4 Extend `get_mcp_capabilities` to report each tool's effective `permission` (`allow` / `ask` / `deny`, including session grants). Verify: a control-server test with a session grant reports `allow` for that group only.

## 3. Approval service

- [ ] 3.1 Create `packages/server-core/src/mcpApprovals/` holding pending approvals (FIFO per terminal, bound 8, `approval_queue_full` beyond it) and in-memory session grants keyed by capability digest and group. Resolve each approval exactly once. Verify: unit tests for ordering, the bound, and single resolution when decide and cancel race.
- [ ] 3.2 End approvals on the request `AbortSignal`, capability revoke/replace (terminal exit, move, automation-space transition, MCP disable) and server shutdown. The same hooks clear that capability's grants. Verify: tests for each ending show the operation never runs and `mcp.approvals.changed` drops it.
- [ ] 3.3 Re-evaluate pending approvals and clear the group's grants when a policy setting changes (allow resolves, deny rejects with `permission_denied`). Verify: a unit test changes the policy while an approval is pending.
- [ ] 3.4 Protocol: query `mcp.approvals.get`, command `mcp.approvals.decide {approvalId, decision}` requiring terminal-create authority, and event `mcp.approvals.changed`. Register them in composition and advertise a capability. Also add `McpApprovalClient` in `packages/client-core`. Verify: protocol tests for an authorized decide, an unauthorized decide being refused, a second decide returning `not_found`, and payloads containing no token.
- [ ] 3.5 Build the display `detail` from the retained validated params: the agent label from the terminal's detected agent session (else "An agent"), the terminal title, and the automation name, trigger, action, full command or text, and settings, plus the changed fields for updates. Verify: a unit test for create and update details.

## 4. Automation tools

- [ ] 4.1 Give `automationService` an internal MCP principal API (list, get, runs, upsert with expected revision, remove, setEnabled, run with optional subject, stop). Keep `assertAutomationAuthority` refusing session- and project-bearing claims on the wire path, and add `startedBy: 'mcp'` to run entries. Verify: `automation-protocol.test.mjs` still refuses a token presented on the wire, and `automation-service.test.mjs` covers MCP-principal CRUD and an `mcp` run entry.
- [ ] 4.2 Add control operations and handlers for `list_automations`, `get_automation`, `list_automation_runs`, `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, and `stop_automation_run`. Validate definitions like the Automations section does, require a subject handle within the caller's reach for subject actions, and redact subject and output tail for out-of-project runs under project scope. Verify: control-server tests for each tool, a stale-revision conflict, an out-of-scope subject being refused, and redaction.
- [ ] 4.3 Register the nine tools in `apps/terminay-server/src/mcp/stdio.ts` with zod input schemas and concise descriptions, and wire them in the desktop adapter in `electron/main.ts`. Verify: `scripts/mcp-stdio.test.mjs` lists the new tools and round-trips `create_automation` → `list_automations`.
- [ ] 4.4 Execute approved requests from the retained params only. Verify: a test mutates the caller's params object after the approval is created, and the executed request is unchanged. An automation edited in Home while the approval is pending makes the approved update fail with a conflict.

## 5. Inline approval prompt

- [ ] 5.1 Move `describeTrigger` from `src/workspace/automations/automationsModel.ts` to `packages/client-core` and re-export it for existing callers. Verify: `npm run test:workspace-models` passes unchanged.
- [ ] 5.2 Add a `useMcpApprovals` hook, one per server connection, patterned on `useServerAutomations`, that refetches on `mcp.approvals.changed`. Verify: a hook-level test drives events and sees the list update.
- [ ] 5.3 Add `McpApprovalStrip` as a sibling above `terminal-panel-root` in `TerminalPanel.tsx`: `role="alert"`, a summary line ("Claude in Terminal 1 wants to add the automation 'X', which runs every 10 seconds"), expandable full detail, the Allow One Time / Allow This Session / Decline buttons, and an "n of m" count when queued. It is responsive at phone width. Verify: component test for rendering and the three decisions.
- [ ] 5.4 Raise the terminal tab's attention indicator while it has a pending approval. Verify: a tab presentation test.
- [ ] 5.5 E2E (`npm run test:e2e`): a new `e2e/mcp-approvals.spec.ts` covers:
  - a fake MCP caller creates an automation, and the prompt appears in the terminal;
  - Allow One Time creates it, and a second call prompts again;
  - Allow This Session suppresses the next prompt for that terminal only;
  - Decline returns `permission_declined`;
  - Never Allow returns `permission_denied` with no prompt;
  - the prompt is answered from the mobile-width browser client and disappears on desktop.

  Verify: the spec passes in the container.

## 6. Specs, docs and PR

- [ ] 6.1 Update the `mcp-server` spec Purpose at archive to mention automation management, and update `docs/product-overview.md`'s MCP description. Verify: `openspec validate --all` passes.
- [ ] 6.2 Run `npm run lint`, `npm run typecheck:workspaces`, `npm run test:control-server`, `npm run test:mcp-stdio`, the server-core automation tests and `npm run test:e2e`. Verify: all pass locally.
- [ ] 6.3 Open the Gitea PR with `tea` and read back every commit status on the head SHA. Verify: every status is `success` or `skipped`.
