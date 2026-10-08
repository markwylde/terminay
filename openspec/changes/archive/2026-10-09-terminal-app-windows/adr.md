# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-04
- Reviewer: Claude (with Mark Wylde)
- Change: terminal-app-windows

## In-Force ADR Context Reviewed

The supersession graph was built from the index in `openspec/adr/README.md`;
0001, 0004, 0007, 0008, 0009, 0014, 0022, 0024, 0030 and 0032 are superseded and
were treated as history only. In-force ADRs that constrain this change:

- openspec/adr/0003-vault-interface-and-key-protectors.md - upstream server credentials are vault entries.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the workspace partition and origin binding the view origin sits beside.
- openspec/adr/0011-security-trust-boundary-model.md - renderer and view content are untrusted at privileged boundaries.
- openspec/adr/0012-pwa-framed-session-host.md - framed sessions constrain how a second origin can be provided.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - upstream processes run on the server that owns the project.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - one bundle for both hosts; the feature is a negotiated capability.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - upstream servers start lazily.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - no agent CLI hooks.
- openspec/adr/0028-no-polling-without-owner-approval.md - reconnection is on demand, never on a timer.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - new operations join the group table; scope stays token-derived.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - windows are server-process state and do not outlive it, unlike PTYs.
- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md - new E2E suites must fit the shard budget.

Reviewed and not constraining: 0002, 0006, 0010, 0013, 0015, 0016, 0019, 0020,
0023, 0026, 0027, 0029, 0033, 0034.

## Repository-Level ADRs Created

- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - Terminay's MCP server is the gateway for third-party MCP Apps and agent-authored UI; windows belong to the calling terminal session.
- openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md - views run in an opaque-origin frame inside a self-sandboxing proxy document shipped in the bundle; unavailable rather than weakened.

## Notes

- No in-force ADR is superseded. ADR-0031's group model is extended, not changed.
- ADR-0038 was revised before acceptance into history, after task 1.1 measured that a self-sandboxing proxy document needs no workspace CSP change, no custom scheme, and no second origin.
- ADR-0038 carries two open items: the hosted session surface (a separate repository) must serve the proxy with its header, and Safari and Firefox are unmeasured.
- Evidence: openspec/adr/evidence/mcp-apps-terminal-windows-spike.md.
