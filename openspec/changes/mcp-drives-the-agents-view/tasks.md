## 1. Server relay

- [x] 1.1 Add `packages/server-core/src/workspaceView/` with `WorkspaceViewRelay`
      (attach, request, respond, connection close, deadline, cancellation) and
      export it. Verified by a server-core test covering delivery to the
      addressed connection only, a reply from another connection refused,
      timeout, cancellation, close, and the reply size bound.
- [x] 1.2 Record the sending client and connection on each `agent-chat.send`
      and expose it as the chat's viewer, forgotten on connection close.
      Verified by an agent-chat service test.
- [x] 1.3 Compose the relay in `composition.ts`, route connection close to it,
      and expose `workspaceView.targetFor(caller)` resolving the presentation-lease holder
      or chat viewer. Verified by a composition test.

## 2. Client relay

- [x] 2.1 Add `packages/client-core/src/workspaceView.ts`: attach, subscribe
      to requests, respond, and the `workspace-view.v1` capability the server
      advertises with MCP. Verified by a client-core test with a fake
      transport and a server-core composition test with real connections.

## 3. MCP surface

- [x] 3.1 Add the view operations to the operation tables, permission
      groups, scopes, and handler map. Verified by `dispatcher.test.mjs` and
      `mcp-permissions.test.mjs`.
- [x] 3.2 Add `workspaceViewTools.ts` (parsing) and `workspaceViewAdapter.ts`
      (scope resolution, relay calls, reply sanitising, folder commands).
      Verified by `workspace-view-adapter.test.mjs`: every tool, scope
      refusals, out-of-scope reply filtering, `renderer_unavailable`.
- [x] 3.3 Compose `split_terminal`, `open_terminal` (`split`, `beside`,
      `focus`), and `focus_terminal` through the view adapter in the
      dispatcher, and drop the hosts' `panel.split`/`panel.activate`. Verified
      by adapter tests asserting exactly one terminal is created and
      `placed: false` without a client.
- [x] 3.4 Register the tools and descriptions in `stdio.ts`. Verified by
      `stdio.test.mjs` and `scripts/mcp-stdio.test.mjs` tool lists.
- [x] 3.5 Bind the adapter in `electron/main.ts`, the host that serves MCP; the
      standalone terminal adapter only opens split terminals.
      Verified by typecheck and the E2E suite.
- [x] 3.6 Update Pixel's instruction. Verified by its unit test.

## 4. Renderer

- [x] 4.1 Add the pure Dockview-grid-to-layout function. Verified by
      `src/workspace/workspaceView.test.ts` in `test:workspace-models`.
- [x] 4.2 Add the view controller and the `viewApi()`/`openFileTab()` handle
      methods on project workspaces (layout, focus, place, resize, arrange, show project, select
      folder, open file, close tab). Verified by the E2E suite.
- [x] 4.3 Remove `useTerminalControlController`. Verified by typecheck and
      lint.

## 5. End-to-end

- [x] 5.1 Add `e2e/mcp-workspace-view.spec.ts` driving every view tool
      through MCP from a terminal: the 2x2 request, split, open with and
      without focus, move, resize, arrange, folder switching,
      folder tools, file tab, close tab, and an out-of-scope refusal; each
      asserted against the DOM and the returned layout. Verified by
      `npm run test:e2e`, plus a Pixel test in `e2e/pixel.spec.ts` replaying
      the 2x2 request through the fake Claude chat provider.

## 6. No terminal out of sight

- [x] 6.1 Recover running held shells the workspace does not name into a
      "Recovered terminals" project on restart; end ended or foreign ones.
      Verified by `session-holder-restore.test.mjs`.
- [x] 6.2 List terminals outside the window's projects in Tabs and open them
      from there. Verified by `src/workspace/elsewhereTerminals.test.ts`,
      `e2e/automations-ui.spec.ts`, and a Pixel test in `e2e/pixel.spec.ts`.

## 7. Verification

- [x] 7.1 `openspec validate --all` and `openspec validate --all --archived`.
- [x] 7.2 `npm run lint`, `npm run typecheck`, and the touched unit suites
      exit zero.
- [ ] 7.3 Open the Gitea pull request and read back every CI status as
      `success` or `skipped`.
