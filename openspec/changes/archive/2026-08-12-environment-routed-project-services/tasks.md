## 1. Terminal and launch

- [x] 1.1 Make PTY/runtime, shell catalogue, home/cwd/path validation, and launch environment resolve per canonical project environment, verified by sentinel launches in two environments never crossing adapters.
- [x] 1.2 Preserve session, stream, attachment, and presentation contracts and filter server-local MCP, control, and provider variables at remote boundaries, verified by launch-environment redaction tests.
- [x] 1.3 Gate cwd and foreground observation and close protection by declared capabilities, verified by capability-gated observation tests.

## 2. Files, roots, and drafts

- [x] 2.1 Route root prepare/browse, canonical resolver, catalog/content/session, folder tasks, uploads, and observation through environment filesystems, verified by filesystem routing tests in two environments.
- [x] 2.2 Normalize provider errors, preserve dirty drafts on disconnect, and model ambiguous writes without blind retry, verified by transport-loss and ambiguous-write tests.
- [x] 2.3 Commit root and context changes transactionally and remove generic bypasses, verified by tests asserting no fall back to This server on provider failure.

## 3. Optional services

- [x] 3.1 Route Git, path, and CLI only when declared and otherwise report unavailable, verified by capability-absent tests showing typed unavailable state.
- [x] 3.2 Keep recording at the server stream boundary and terminal-output activity universal while gating agent journals and process observation, verified by recording and activity suites passing for both environment kinds.
- [x] 3.3 Prevent local MCP sockets and local provider paths entering remote shells and route macro file fields through the environment, verified by remote-shell environment assertions.

## 4. Acceptance checks

- [x] 4.1 Sentinel paths and commands in two environments never cross adapters or fall back to This server.
- [x] 4.2 A missing provider or capability leaves the project and its panels represented with typed state.
- [x] 4.3 Existing terminal recovery, recording, activity, file, and Git suites pass through This server routing.
- [x] 4.4 Provider transport loss scopes interruption, drafts, and status correctly.
