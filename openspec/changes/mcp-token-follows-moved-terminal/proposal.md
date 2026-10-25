## Why

After a terminal is moved to another project, an agent running in it loses its
Terminay MCP tools. Every call fails with `invalid_token` ("missing, invalid,
stale, or revoked"). An agent started later in the same terminal fails the
same way. Only a new terminal recovers.

The move revokes the terminal's capability. The token reaches the terminal
only through its launch environment, which cannot be updated after launch, so
any replacement token has no way to reach the shell. A move therefore cuts the
terminal off from MCP permanently. The spec allowed "replaced or revoked", but
for a running shell, replacing the token does nothing.

## What Changes

- A terminal's capability follows the terminal when it moves between projects,
  or from the automation terminal space into a project. The same token resolves
  to the new project from the moment of the move. It no longer reaches the old
  project, and at no instant does it reach both.
- Approvals, session grants, and in-flight requests made under the old scope
  end at the move, just as they would on revocation.
- Moving a terminal *into* the automation terminal space still revokes its
  capability. That move would widen the token to workspace reach, and a token
  is never widened in place.
- The follow is persisted, so a terminal that survives a restart keeps the scope
  it was moved to.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: in the requirement "Capability token scope and lifecycle", a
  token now follows its terminal across a project move instead of being
  "replaced or revoked", and is revoked only on entering the automation space.

## Impact

- `apps/terminay-server/src/mcp/controlEndpoint.ts`: `ControlCapabilityStore`
  gains an in-place re-scope that keeps the digest and ends per-scope state. The
  unused `moveTerminal` is replaced.
- `electron/main.ts`: `onTerminalRehomed` re-scopes instead of revoking, and
  revokes only when the target is the automation space.
- Tests: new cases in `apps/terminay-server/test/control-endpoint.test.mjs` and
  `control-capability-persistence.test.mjs`. The end-to-end reproduction is
  `e2e/mcp-after-terminal-move.spec.ts`, which fails on `main` today.
- Ordering: this change modifies the same requirement as the unarchived change
  `mcp-token-lives-with-terminal`, and its delta builds on that text. Archive
  `mcp-token-lives-with-terminal` first.
