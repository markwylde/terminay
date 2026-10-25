## 1. Capability store

- [x] 1.1 Replace `ControlCapabilityStore.moveTerminal` with
      `followTerminal(sessionId, projectId, placement)`. It rewrites the
      session's stored `projectId` and `reach` under the same digest, and it
      refuses (throws) a follow from project reach to workspace reach.
      Verified by new cases in `apps/terminay-server/test/control-endpoint.test.mjs`:
      the same token resolves to the new project, not the old; a follow from
      the automation space to a project yields project reach; a widening follow
      throws and leaves the capability unchanged.
- [x] 1.2 Before re-scoping, `followTerminal` notifies the revocation listeners
      for the old digest, and the listener doc comment is reworded to cover
      re-scope. Verified by a test that an in-flight request on the token is
      aborted with `revoked` and the listener fires once with the session id.
- [x] 1.3 `followTerminal` triggers `changed()`. Verified by a case in
      `apps/terminay-server/test/control-capability-persistence.test.mjs`:
      snapshot, then restore into a fresh store, and the token resolves to the
      moved project.

## 2. Desktop

- [x] 2.1 In `electron/main.ts`, `onTerminalRehomed` calls `followTerminal` for
      a target project, and `revokeSession` when the target is the automation
      space. Verified by `npm run typecheck`.

## 3. End-to-end

- [x] 3.1 `e2e/mcp-after-terminal-move.spec.ts` (already added; fails on `main`
      with `invalid_token`) passes. Verified by
      `npm run test:e2e -- e2e/mcp-after-terminal-move.spec.ts`.
- [x] 3.2 The existing move and MCP suites still pass. Verified by
      `npm run test:e2e -- e2e/terminal-move-between-projects.spec.ts e2e/mcp-approvals.spec.ts e2e/mcp-workspace-view.spec.ts`.

## 4. Validation

- [x] 4.1 `openspec validate --all` passes, and the server test suite passes.
      Verified by running both.
