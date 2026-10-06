# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude (with Mark Wylde)
- Change: app-window-files-and-attachments

## In-Force ADR Context Reviewed

The supersession graph was built from the index in `openspec/adr/README.md`;
0001, 0004, 0007, 0008, 0009, 0014, 0022, 0024, 0030 and 0032 are superseded and
were treated as history only. In-force ADRs that constrain this change:

- openspec/adr/0011-security-trust-boundary-model.md - a view's bytes and an agent's data are untrusted at the workspace and server boundaries; no client-chosen write path.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - an attachment must exist on the machine that owns the PTY.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - attachments are a negotiated capability in one bundle.
- openspec/adr/0020-per-operation-canonical-roots.md - the server opens no path an MCP caller chose; the adapter reads the document.
- openspec/adr/0023-server-owned-clipboard-scratch.md - the scratch-write pattern followed, and its rule that a new feature needs its own named write.
- openspec/adr/0028-no-polling-without-owner-approval.md - upload flow control is acknowledgement-driven, never timed.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - attachments are evaluated under the Window Messages policy.
- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md - new E2E must fit the shard budget.
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - windows and their data are server-owned state of one terminal session.
- openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md - bytes cross the proxy; the confirmation is drawn outside the view.
- openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md - only the controlling client uploads; a mirror cannot.

Reviewed and not constraining: 0002, 0003, 0005, 0006, 0010, 0012, 0013, 0015,
0016, 0019, 0021, 0025, 0026, 0027, 0029, 0033, 0034, 0035, 0040.

## Repository-Level ADRs Created

- openspec/adr/0041-the-mcp-adapter-may-read-a-document-the-agent-names.md - the stdio adapter may read the one document an agent names for `show_window`; the server never opens the path and the contents never return to the agent.
- openspec/adr/0042-window-attachments-are-an-unbounded-streamed-scratch-write.md - attachments ride on a window message into a server-named scratch file, streamed with no size limit, and are not removed by Terminay.

## Notes

- No in-force ADR is superseded. ADR-0023 is followed as a pattern and left as it is.
- ADR-0042 rests on one unmeasured point: moving file parts out of the opaque-origin view through the proxy. Task 1.1 measures it first and records the result in `openspec/adr/evidence/`.
- The size, retention, and delivery choices in ADR-0042 are the owner's, made in a questionnaire on 2026-10-07.
