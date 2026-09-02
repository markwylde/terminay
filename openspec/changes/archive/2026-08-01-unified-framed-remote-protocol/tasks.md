## 1. Current-path audit

- [x] 1.1 Inventory every constructor and call site for Electron/local framed
  transports
- [x] 1.2 Inventory every constructor and call site for `HttpByteTransport`
- [x] 1.3 Inventory standalone-server HTTP app-protocol routes
  (`/protocol/query`, `/protocol/command`, `/protocol/events`,
  `/protocol/events/subscribe`)
- [x] 1.4 Capture baseline remote timings and request counts for reconnect,
  project creation, terminal creation, and terminal attach. Final compose smoke
  evidence records that only reconnect bootstrap endpoints and the framed stream
  are used, and that project creation, terminal creation, terminal command
  execution, explorer refresh, reload reconnect, and post-server-restart
  reconnect all completed with zero pending requests and zero
  console/resource/CSP errors
- [x] 1.5 Classify every test and spec asserting HTTP/SSE app-protocol behaviour
  as bootstrap-only or obsolete

## 2. Single stream transport

- [x] 2.1 Add a browser-compatible framed byte-stream transport, verified by
  `packages/client-core/test/websocket-byte-transport.test.mjs`
- [x] 2.2 Add a standalone-server stream endpoint adapting each authenticated
  stream directly into `ServerConnection`, verified by
  `apps/terminay-server/test/local-ui-stream.test.mjs`
- [x] 2.3 Keep HTTP only for static assets, health/readiness, pairing, reconnect
  enrollment, and stream bootstrap/authentication, verified by route tests
- [x] 2.4 Ensure Desktop remote and web remote instantiate the same remote stream
  transport, verified by client tests
- [x] 2.5 Ensure Electron local continues on the existing local byte transport
  with no separate app-protocol implementation, verified by local transport tests

## 3. Delete the duplicate application protocol

- [x] 3.1 Remove JSON command dispatch from `LocalUiServer`
- [x] 3.2 Remove JSON query dispatch from `LocalUiServer`
- [x] 3.3 Remove SSE app-event subscription and replay from `LocalUiServer`
- [x] 3.4 Remove client-side HTTP event subscription, retry, replay, and
  filtering from `HttpByteTransport`, deleting it entirely once it had no
  bootstrap-only role left
- [x] 3.5 Remove client-side re-encoding of HTTP JSON responses into protocol
  frames
- [x] 3.6 Remove remote-only tests asserting the deleted split protocol, verified
  by their absence rather than by skipping them

## 4. Workspace mutation simplification

- [x] 4.1 Make project create/activate/close/root-update use the canonical
  command result plus the unified event stream, verified by
  `packages/server-core/test/workspace-project-move-protocol.test.mjs` and
  composition tests
- [x] 4.2 Make terminal create and open-at use the canonical command result plus
  the unified event stream rather than event-stream retry timing
- [x] 4.3 Remove remote-specific waits, sleeps, and fallback refreshes that only
  compensated for the split HTTP/SSE path
- [x] 4.4 Preserve server-owned workspace authority for panels, projects, and
  sessions, verified by `packages/server-core/test/server-composition.test.mjs`

## 5. Terminal attach and output simplification

- [x] 5.1 Route terminal attach, input, resize, detach, and output through the
  same framed stream as local
- [x] 5.2 Remove terminal output JSON/base64/SSE replay from the remote path
- [x] 5.3 Keep retained replay bounded as a general protocol safety property only
  where still needed after the unified stream is in place
- [x] 5.4 Verify a new terminal panel uses the unified framed attach path and not
  the removed JSON/base64/SSE replay path

## 6. Tests and evidence

- [x] 6.1 Add transport conformance tests proving the remote stream runs
  `ServerConnection` directly
- [x] 6.2 Add client tests proving Desktop remote and web remote use the same
  stream transport implementation
- [x] 6.3 Add regression tests proving `/protocol/query`, `/protocol/command`,
  and `/protocol/events/subscribe` carry no application traffic after bootstrap
- [x] 6.4 Add regression tests proving project and terminal creation completion
  does not depend on SSE retry/backoff
- [x] 6.5 Add regression tests proving no JSON/base64 event replay path exists
  for remote terminal output
- [x] 6.6 Add browser-manager reconnect regression coverage for HTTPS and
  loopback saved profiles after reload and restart
- [x] 6.7 Run `npm run build:app`
- [x] 6.8 Run the focused suite
  (`scripts/web-reconnect-attempt-lifecycle.test.mjs`,
  `scripts/task16-web-auth-retry-suppression.test.mjs`,
  `scripts/docker-compose-web-server-smoke.test.mjs`,
  `packages/server-core/test/workspace-host-event.test.mjs`,
  `packages/server-core/test/server-composition.test.mjs`,
  `packages/server-core/test/workspace-project-move-protocol.test.mjs`,
  `apps/terminay-server/test/local-ui-stream.test.mjs`,
  `packages/client-core/test/websocket-byte-transport.test.mjs`) — 48/48 passed
  after rebuilding `@terminay/server-core`
- [x] 6.9 Run `npm run smoke:docker-compose-web-server` against
  `http://127.0.0.1:8080` / `http://localhost:4317`; browser project creation,
  terminal creation, terminal command execution, explorer refresh, reload
  reconnect, and post-server-restart reconnect all passed
- [x] 6.10 Run `npm run smoke:docker-pairing` against the built
  `terminay-server:local` image
- [x] 6.11 Inspect Playwright network traffic against remote localhost/Docker and
  confirm no split app-protocol paths after bootstrap

## 7. Acceptance

- [x] 7.1 After bootstrap, remote app traffic uses one long-lived framed protocol
  stream
- [x] 7.2 After bootstrap, network inspection shows no application traffic on
  `/protocol/query`, `/protocol/command`, or `/protocol/events/subscribe`
- [x] 7.3 Desktop local, Desktop remote, and web remote execute commands,
  queries, subscriptions, and terminal streams through `ServerConnection`
- [x] 7.4 Creating a remote project does not wait on an HTTP/SSE event retry path
- [x] 7.5 Creating a remote terminal does not wait on an HTTP/SSE event retry
  path
- [x] 7.6 Reconnecting does not replay unrelated journal events through the
  client before filtering
- [x] 7.7 Browser reload/restart auto-restore retries the current saved HTTPS or
  loopback profile in-page instead of navigating away from the connected shell
- [x] 7.8 Terminal output is not transported as SSE JSON/base64 on the remote app
  protocol path
- [x] 7.9 The net implementation removes substantially more duplicated protocol
  code than it adds
