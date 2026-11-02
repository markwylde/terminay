## Context

The reports describe a packaged macOS launch with a minimal PATH, Docker CLI talking to Podman through `/var/run/docker.sock`, unstable Podman compatibility `info.ID`, missing-image stderr and a URI used as a bind path. Source inspection confirms the engine's separate CLI drivers are otherwise identical, but shell uses a host PTY and agent launch bypasses the driver. Files, desktop, helper runs, image builds and stats also depend on CLI output. This is a cross-service transport change, not just discovery.

The repository has no canonical bot-environment spec yet: it is in `add-terminay-bots`. That delta must agree with this capability. ADR inventory and supersession fields were reviewed, including in-force ADR-0011 (authority), ADR-0028 (no polling), ADR-0047/0048 (server/client boundary), ADR-0051/0067 (agent exceptions), ADR-0088 (durable state), ADR-0089 (bots) and ADR-0091 (bot-owned credentials). ADR-0090 is superseded and is not a live credential contract.

## Goals / Non-Goals

**Goals:** one Docker-compatible socket transport for every bot operation; no host CLI needed with a reachable socket; truthful status and stable engine identity; preservation of existing isolation and supported modes; a single branch/PR as authorized by the owner.

**Non-Goals:** engine installation or VM startup, remote TCP/SSH engines, Windows bot support, rootless Docker, changing ACP or credential ownership, pulling a prebuilt bot image, or granting renderers direct engine access.

## Decisions

### Shared API adapter

Use Node's HTTP Unix-socket transport behind the existing server-owned driver boundary. Keep the current internal command-shaped driver inputs as a private adapter vocabulary where that avoids rewriting unrelated environment logic; they are translated to API requests and never spawned. Introduce explicit exec-stream control and resize instead of pretending a socket is a host PTY. Build context is streamed as a tar archive using the existing pinned tar package with a direct dependency declared by server-core. Ordinary operations use Docker-compatible routes. Only Podman-specific discovery/capability metadata uses its native info route.

A full Docker SDK was considered: it reduces HTTP boilerplate but adds a second stream abstraction and dependencies. A small bounded transport keeps cancellation, framing and error redaction reviewable under the existing security contract. Keeping CLI subprocesses would preserve the failures reported here and is rejected.

### Endpoint discovery

Read server environment and Docker config/context metadata; enumerate known Docker Desktop, OrbStack and Podman Unix socket locations. Resolve aliases with realpath. Prefer the configured endpoint and do not contact remote endpoints. A configured Docker context must be resolved, not silently ignored. For Podman machine sockets outside standard locations, optional `podman machine list/inspect` supplies host socket metadata; it never runs a container operation. No shell PATH evaluation runs during discovery.

Read server `/version` and `/info` to negotiate the API and identify Podman by server component/platform metadata. Probe native Podman info only for a Podman server. Native security/cgroup metadata supplies rootless and limits information. Normalize its daemon socket URI into a path. Docker's daemon-side socket defaults to `/var/run/docker.sock`, independently of the host Docker Desktop socket.

### Stable pins

Use an engine-local labelled identity volume with a generated UUID. Discovery inspects but never creates it. Selecting an unpinned engine creates the marker; every subsequent check requires the same marker UUID. This avoids treating Podman's compatibility ID or a hostname as stable identity. The marker contains no bot data and no credentials. Concurrent selectors inspect the volume after creation so the engine's actual stored label wins. Pin endpoint aliases may be deduplicated by realpath and by an existing marker; endpoints without a marker are not treated as equal merely because their hostname matches.

Version the saved pin, retain its explicit Unix endpoint and use durable persistence. Existing CLI pins are kept readable. Native Podman pins are upgraded only after their saved connection resolves to the same verified local machine/root mode and the native identity matches the identity originally saved. Docker pins upgrade only when the server is Docker and its stable ID matches. Unverifiable pins, including Docker-compatibility IDs supplied by Podman, require explicit reselection. Never silently accept a changed engine or recreate a missing marker for an existing pin. Creation of the identity marker is the only new persistent engine resource.

### Streams and lifecycle

Implement bounded finite requests, API status errors and abortable event/exec/build streams. Exec start uses HTTP hijacking, with correct stdout/stderr framing for non-TTY and raw TTY bytes. Input EOF reaches the remote process without prematurely discarding output. Shell resize uses exec resize; exit inspection supplies the real exit code, including device sign-in success. Agents and shell retain `terminay-run` supervisors and explicit process-group cleanup; destroying an exec stream alone never releases a credential lease.

File helpers use attach-before-start with stdin and stdout attached. Temporary one-shot helpers wait for completion and remove themselves. Preserve binary VNC bytes, stream backpressure, bounded buffers, token redaction and authority checks. Events are subscribed once and retained across unchanged checks; stream end makes the engine unavailable without a polling retry loop.

### Status

Separate image errors from engine availability; 404 means image missing, other failures set the existing image failed/error fields. Reads are coalesced and do not emit invalidations. UI clears status after failed reads and reloads after engine-changing actions even if later image work fails. Safe diagnostics expose a stable error class, not raw request bodies or daemon diagnostics.

## Risks / Trade-offs

- Podman compatibility differences, especially rootless user namespaces and helpers -> protocol tests plus real Docker and Podman smoke evidence are required; report unavailable real-engine coverage explicitly.
- Exec attach half-close, framing or resize regressions -> fragmented binary protocol tests, TTY exit/resize tests and existing ACP/file/desktop/shell coverage.
- Removing the marker or restoring an engine backup -> explicit reselection required; never automatic adoption.
- Optional metadata tooling unavailable -> configured/standard sockets still work; nonstandard endpoints can be configured with `DOCKER_HOST=unix:///...`.
- Build compatibility and registry authentication -> preserve local build semantics; build stream errors fail without retagging. Private registry authentication is not newly added by this change.

## Migration Plan

Ship socket implementation and updated fixtures together. Verified saved CLI pins are upgraded automatically; unverifiable pins show engine changed until explicitly reselected; bot records, images and homes remain intact. Accepting the same endpoint adopts only correctly labelled resources. Rollback restores the former transport; a socket-version pin must not be interpreted as an old CLI connection. No accepted ADR is edited.

## Open Questions

ADR-0089's CLI transport commitment is superseded in a new narrowly scoped ADR; its ACP, isolation and session-supervision decisions remain in force. Live Podman versions/providers available for verification are unknown until checked. Any compatibility failure must be fixed or reported as incomplete, rather than narrowing the supported modes silently.

The engine recovery action is always offered for a reachable candidate when the current pin is unavailable, even when kind and address are unchanged. Candidate addresses wrap within the summary rail and the action occupies its own row. An alias of the selected engine is not presented as another engine.

### Browser startup

The owner requested an already-open browser after testing a background launch that left no Chromium window. The container init starts Chromium after the existing event-driven X socket readiness gate, with the same bot uid/gid and DISPLAY=:1 as Openbox. Chromium retains its sandbox and its profile in the bot home. It opens about:blank without first-run prompts and uses temporary filesystem storage for shared-memory pressure. Init owns its process group; ending an agent session does not end the desktop browser. Dockerfile DISPLAY also makes the existing desktop discoverable to ordinary exec commands.

### Chat revisions and browsing guidance

The owner requests editing/deleting either participant's messages through a context menu and clearing the current chat. They explicitly select updating future agent context too. Revisions operate only while a chat is idle and require server write authority and matching bot/session ownership. The client supplies the expected message text as a stale-edit guard. The server constructs the revised transcript; clients cannot replace arbitrary session state.

A revision ends the prior agent process with the existing supervised cleanup, creates a fresh session containing the revised transcript and bounded replay context, and only then removes the old session record. The old provider session is never resumed and old tools are not replayed. Oversized replay is refused before changing history. Clear chat confirms, closes and removes only the selected chat, and sends the next message into a fresh provider session. Files, credentials, memories, trigger records and completed external effects remain. Stored revisions follow the existing redaction, transcript bounds and durable session writes.

Atlas inspection shows a supervised shared browser plus explicit browser/desktop MCP tools, not a prompt-only solution. Terminay guidance must accurately describe its installed shell tools, reuse the shared browser, inspect screenshots/window state, and verify visible results before claiming success. Existing sessions retain their recorded context; a new or revised chat receives current guidance.

### Browser launch ownership

Init starts the browser launcher once, as the bot user. It opens Chromium once at startup and then blocks on a private, bounded Unix-socket request interface. It does not watch browser state, poll processes or restart exited browsers. The explicit `terminay-browser open URL` command delegates to Chromium's native single-instance URL dispatch, so existing-window navigation and launch-after-close share one path. Browser children inherit the desktop process group, not the agent tool group. SIGCHLD auto-reaping prevents exited child zombies. Startup clears only stale singleton lock entries before accepting requests; profile content remains in the bot home. A launch acknowledgement is separate from observing a loaded page.

### Inline container images

Markdown local images resolve through the canonical authenticated Bot I/O query, never through file:// or host filesystem access. The server checks bot ownership and engine identity, reads as bot using directory-relative no-follow descriptors, caps images at 2 MiB and identifies supported raster types by signature. Renderer image elements use revocable blob URLs; remote Markdown image URLs remain inert text. These are previews of files currently in the running container; missing files or stopped containers produce an unavailable state. The browser uses Chromium's standard start-maximized option for both startup and explicit launches.

### Container workload attribution and panel width

The Containers view filters by bot ID, then excludes Terminay-managed infrastructure and helper labels during inspection. The action path uses that same inspected workload list, so hidden Files helpers and probes cannot be stopped or removed through workload controls. Bot-created workloads remain labelled by the existing in-container docker wrapper. Attribution is best effort rather than an engine permission boundary: sharing the socket still grants access to the whole selected engine. The Triggers page uses the panel's available width and standard padding without a fixed max-width.
