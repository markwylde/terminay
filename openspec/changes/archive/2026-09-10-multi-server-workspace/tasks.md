## 1. A protocol that can say no

- [x] 1.1 Give `packages/protocol` a real version range (`PROTOCOL_MIN_VERSION`, `PROTOCOL_MAX_VERSION`) and a `FEATURE_CAPABILITIES` registry of versioned strings (`workspace.v1`, `terminal.v1`, `files.v1`, `git.v1`, `agents.v1`, `settings.v1`, `macros.v1`, `recording.v1`, `dictation.v1`, `mcp.v1`, `extensions.v1`, `connection.heartbeat`), carried in `client_hello` and `server_hello`. Verified by protocol unit tests for negotiation of each of compatible, degraded, and incompatible.
- [x] 1.2 Make each feature client in `packages/client-core` export its capability constant beside its operation names, and add a test asserting every operation registered by `packages/server-core/src/composition.ts` belongs to exactly one declared capability. Verified by the test passing.
- [x] 1.3 Add a `serverCompatibility` declaration (protocol range plus required and optional capabilities) to the bundle manifest in `packages/ui-bundle`, emitted at build time from the client's constants, and a `ConnectionCompatibility` result type (`compatible` | `degraded` | `incompatible`, with the missing items and the side to upgrade) computed by `TerminayClient.connect`. Verified by a unit test feeding a `server_hello` missing a required capability and asserting `incompatible` naming the server.
- [x] 1.4 Remove the bundle-to-server identity binding: the `bundleId` and `applicationProtocolVersion` equality checks against a connected server in `packages/protocol/src/host.ts` and `apps/terminay-web/src/browserBundleHost.ts`, keeping every bundle-to-host check. Verified by the host compatibility tests passing with the server checks deleted.

## 2. Hosts hand out connections

- [x] 2.1 Add a versioned `connections` host capability to the host bridge contract in `packages/protocol/src/host.ts` and `electron/serverUiHostContract.ts`: list profiles with status, open a profile to an opaque byte endpoint, close, subscribe to status. Verified by the host contract validation tests covering each action.
- [x] 2.2 Implement it in Electron main over the existing per-profile transports, binding each opened endpoint to its own server identity, and make `electron/serverUiHost.ts` bind a window to a primary profile (always Local) plus an attached set. Verified by a main-process test opening two profiles from one window and asserting two endpoints with distinct server ids.
- [x] 2.3 Delete Desktop remote bundle download, the per-server verified bundle cache, and the "never run the Local renderer against a remote server" checks. Verified by `grep -rn "bundleCache\|remoteBundle\|installRemoteBundle" electron packages/ui-bundle` returning nothing and the Desktop startup tests passing.
- [x] 2.4 Replace the session transport singleton in `src/web/sessionTransportHost.ts` with a registry keyed by connection that the `connections` capability feeds, keeping the sealed, non-forgeable installation for each entry. Verified by a unit test installing two connections and refusing a duplicate.

## 3. The workspace UI runs many connections

- [x] 3.1 Introduce a connection context in `src/` that owns, per connection, the `TerminayClient`, heartbeat, recovery loop, `WorkspaceSnapshotStore`, agent status store, feature clients, and event subscriptions; convert `src/web/main.tsx`'s single refs into a map. Verified by the app running unchanged with a single connection and the existing end-to-end suite passing.
- [x] 3.2 Move every consumer in `App.tsx` and its hooks from the module-level `agentStatusStore` and the single `currentServerId` to the connection context keyed by the active tab's server. Verified by `grep -n "agentStatusStore\b" src` showing no module-level import and `npm run typecheck` passing.
- [x] 3.3 Give `ProjectTab` a `serverId`, make the tab strip a composition of `(serverId, projectId)` handles across attached connections with client-owned order, and key every client-held id as `(serverId, id)` including routes and deep links. Verified by a unit test attaching two connections whose project ids collide and asserting both tabs render.
- [x] 3.4 Persist the composition (attached profiles, one view per server, tab order) through the host allowlist on Desktop and manager storage on web, and restore it on startup with unreachable or incompatible servers shown greyed and inert. Verified by a Desktop test restarting with one attached server offline and asserting its tabs remain greyed.
- [x] 3.5 Replace the header server control with a connections control: attached servers with status and compatibility, attach from saved profiles, detach, and per-server exposure. Verified by the header end-to-end test attaching and detaching a second server.
- [x] 3.6 Make new-project creation choose the owning attached server (default the active tab's) and then a root on that server, and refuse panel moves between servers by not offering the drop target. Verified by the project creation end-to-end test on an attached server and a unit test that a cross-server drop is not a valid target.

## 4. Cross-server surfaces

- [x] 4.1 Add a server selector defaulting to the active tab's server to the Settings, Macros, Recordings, Shell profiles, and Extensions surfaces, each showing only the selected server's state. Verified by unit tests that switching the selector swaps the feature client and never merges rows.
- [x] 4.2 Make the Home dashboard, activity count badges, and the agent sidebar aggregate rows from every attached connection keyed by server and project, naming the server when more than one is attached. Verified by unit tests with two connections contributing rows.
- [x] 4.3 Route dictation to the target terminal's server and keep MCP one socket per server with cross-server addressing refused. Verified by existing dictation and MCP tests extended with a second connection.

## 5. Browser attached connections

- [x] 5.1 Extend the framed-host message schema in `apps/terminay-web` with attach, open, close, and status messages, and have the manager open attached transports with the vault's credential for that origin and hand the framed primary a `MessagePort` byte endpoint. Verified by a browser test attaching a second server from the framed bundle and asserting the credential never crosses into the frame.
- [x] 5.2 Delete secondary bundle installation paths from `apps/terminay-web/src/browserBundleHost.ts`. Verified by the browser host tests passing with only the primary-origin install path.

## 6. Specs, docs, and close out

- [x] 6.1 Update `docs/product-overview.md` (client hosts, core model) for one bundle and many connections, and the release policy in `docs/operations/release-update-policy.md` to keep the packaged bundle's declared protocol range at least one version wide. Verified by both documents describing primary and attached connections.
- [x] 6.2 Run `openspec validate --all`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, and the Desktop end-to-end suite through `npm run test:e2e` with a fixture that attaches two embedded servers. Verified by all passing. Note: the two-server attachment is covered by `scripts/desktop-window-connections.test.mjs` (two profiles from one window, distinct endpoints) and `scripts/multi-connection-workspace.test.mjs`; the Docker e2e harness runs one embedded server, so a two-server e2e fixture remains a follow-up.
