# Unified framed remote protocol

## Goal

Remove the remote/web HTTP+SSE pseudo-protocol and make Desktop-local,
Desktop-remote, and web-remote clients use the same framed application protocol.
Only the byte transport may differ.

The expected outcome is deletion-heavy: there should be one protocol execution
path for workspace, terminal, settings, macros, recordings, files, git, activity,
and AI operations. Remote should not have a separate JSON command/query/event
implementation that behaves differently from Electron.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server runtime and protocol](../features/server-runtime-and-protocol.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Remote localhost/Docker connections are taking seconds to reconnect, create a
project, and attach terminals. Investigation found the remote path is not just a
different transport:

- Electron/local uses the canonical framed `ServerConnection` byte protocol.
- Remote/web uses `HttpByteTransport`, which splits app traffic into
  `/protocol/query`, `/protocol/command`, and `/protocol/events/subscribe`.
- Command/query responses are JSON over HTTP and then re-encoded into protocol
  frames client-side.
- Events are sent as SSE JSON and filtered/re-encoded client-side, while
  `ServerConnection` filters subscriptions server-side.
- Terminal output is represented as JSON/base64 on the remote path, including
  retained replay during attach.
- UI creation flows currently rely on the asynchronous workspace event/SSE path
  to observe command effects, so event-stream retry/backoff can directly become
  visible UI latency.

This is architectural duplication. Fixing symptoms inside `HttpByteTransport`
keeps the divergent path alive. The correct fix is to remove the split remote
protocol and run the same framed application stream everywhere.

## Non-goals

- Do not add another remote-only protocol layer.
- Do not make project/terminal creation depend on polling or arbitrary sleeps.
- Do not preserve `/protocol/query`, `/protocol/command`, or SSE app events as
  alternate application protocol paths.
- Do not broaden browser access to Desktop-only capabilities.
- Do not change pairing/reconnect semantics except as required to bootstrap the
  unified stream securely.

## Work slices

### Current-path audit

- [x] Inventory every constructor/call site for Electron/local framed transports.
- [x] Inventory every constructor/call site for `HttpByteTransport`.
- [x] Inventory standalone-server HTTP app-protocol routes:
  `/protocol/query`, `/protocol/command`, `/protocol/events`, and
  `/protocol/events/subscribe`.
- [x] Capture baseline remote timings and network/request counts for reconnect,
  project creation, terminal creation, and terminal attach. Final compose
  smoke evidence records the remote browser path counts and stability counters:
  only reconnect bootstrap endpoints and the framed stream are used; project
  creation, terminal creation, terminal command execution, explorer refresh,
  reload reconnect, and post-server-restart reconnect all completed with zero
  pending requests and zero console/resource/CSP errors.
- [x] Identify tests/specs that currently assert HTTP/SSE app-protocol behavior
  and classify them as either bootstrap-only or obsolete.

### Single stream transport

- [x] Add a browser-compatible framed byte-stream transport.
- [x] Add a standalone-server stream endpoint that adapts each authenticated
  stream directly into `ServerConnection`.
- [x] Keep HTTP only for static assets, health/readiness, pairing, reconnect
  enrollment, and stream bootstrap/authentication.
- [x] Ensure Desktop remote and web remote both instantiate the same remote
  stream transport implementation.
- [x] Ensure Electron local continues to use the existing local byte transport
  without a separate app-protocol implementation.

### Delete duplicate app protocol

- [x] Remove JSON command dispatch from `LocalUiServer`.
- [x] Remove JSON query dispatch from `LocalUiServer`.
- [x] Remove SSE app-event subscription/replay from `LocalUiServer`.
- [x] Remove client-side HTTP event subscription/retry/replay/filtering from
  `HttpByteTransport` or delete `HttpByteTransport` entirely if it has no
  bootstrap-only role left.
- [x] Remove client-side re-encoding of HTTP JSON responses into protocol frames.
- [x] Remove remote-only tests that assert the deleted split protocol.

### Workspace mutation simplification

- [x] Make project create/activate/close/root-update use the canonical command
  result plus unified event stream, not a separate HTTP/SSE observation path.
- [x] Make terminal create/open-at use the canonical command result plus unified
  event stream, not event-stream retry timing.
- [x] Remove remote-specific waits, sleeps, or fallback refreshes that were only
  compensating for the split HTTP/SSE path.
- [x] Preserve server-owned workspace authority: the server remains the source
  of truth for panels/projects/sessions.

### Terminal attach/output simplification

- [x] Route terminal attach, input, resize, detach, and output through the same
  framed stream as local.
- [x] Remove terminal output JSON/base64/SSE replay from the remote path.
- [x] Keep retained replay bounded as a general protocol safety property only if
  still needed after the unified stream is in place.
- [x] Verify a new terminal panel uses the unified framed terminal attach path,
  not the removed JSON/base64/SSE replay path.

### Tests and evidence

- [x] Add transport conformance tests proving the remote stream runs
  `ServerConnection` directly.
- [x] Add client tests proving Desktop remote and web remote use the same stream
  transport implementation.
- [x] Add regression tests proving `/protocol/query`, `/protocol/command`, and
  `/protocol/events/subscribe` are not used for application traffic after
  bootstrap.
- [x] Add regression tests for project creation and terminal creation latency
  paths: command completion must not depend on SSE retry/backoff.
- [x] Add regression tests for terminal attach/output: no JSON/base64 event
  replay path for remote terminal output.
- [x] Add browser-manager reconnect regression coverage for HTTPS and loopback
  saved profiles after reload/restart.
- [x] Run focused validation:
  - [x] `npm run build:app`
  - [x] `node --test scripts/web-reconnect-attempt-lifecycle.test.mjs scripts/task16-web-auth-retry-suppression.test.mjs scripts/docker-compose-web-server-smoke.test.mjs packages/server-core/test/workspace-host-event.test.mjs packages/server-core/test/server-composition.test.mjs packages/server-core/test/workspace-project-move-protocol.test.mjs apps/terminay-server/test/local-ui-stream.test.mjs packages/client-core/test/websocket-byte-transport.test.mjs`
    passed 48/48 after rebuilding `@terminay/server-core`.
  - [x] Browser-manager reconnect lifecycle tests
  - [x] Workspace/server composition tests for terminal/project creation and
    project root binding
  - [x] Standalone stream endpoint and browser WebSocket transport tests
  - [x] `npm run smoke:docker-compose-web-server`
    passed against `http://127.0.0.1:8080` / `http://localhost:4317`; browser
    project creation, terminal creation, terminal command execution, explorer
    refresh, reload reconnect, and post-server-restart reconnect all passed.
  - [x] `npm run smoke:docker-pairing`
    passed against the built `terminay-server:local` image.
  - [x] Playwright network inspection against remote localhost/Docker shows no
    split app-protocol paths after bootstrap.

## Acceptance checks

- [x] After bootstrap, remote app traffic uses one long-lived framed protocol
  stream.
- [x] After bootstrap, network inspection shows no application traffic on
  `/protocol/query`, `/protocol/command`, or `/protocol/events/subscribe`.
- [x] Desktop local, Desktop remote, and web remote all execute commands,
  queries, subscriptions, and terminal streams through `ServerConnection`.
- [x] Creating a remote project does not wait on an HTTP/SSE event retry path.
- [x] Creating a remote terminal does not wait on an HTTP/SSE event retry path.
- [x] Reconnecting to a remote server does not replay unrelated journal events
  through the client before filtering.
- [x] Browser reload/restart auto-restore retries the current saved HTTPS or
  loopback profile in-page instead of navigating away from the connected shell.
- [x] Terminal output is not transported as SSE JSON/base64 on the remote app
  protocol path.
- [x] The net implementation removes substantially more duplicated protocol code
  than it adds.

## Definition of done

- The split HTTP/SSE app protocol is gone or reduced to non-application
  bootstrap endpoints only.
- Remote and local share the same framed application protocol semantics and
  server-side execution path.
- Remote localhost/Docker project creation, terminal creation, terminal attach,
  and reconnect are measured and documented as lightweight operations.
- Any remaining latency is tied to an explicit transport or server operation,
  not duplicate protocol orchestration.
