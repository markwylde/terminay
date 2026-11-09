## Context

The macOS package uses bundle id `com.terminay.app` and the developer-tools category but has no document handlers. `electron/main.ts` acquires the single-instance lock early; its second-instance callback only focuses a window. `createServerOwnedTerminalSession` already delegates PTY creation and recording to server authority. Workspace composition exposes validated host commands, project roots, and server-owned terminal panels.

The ADR inventory and supersession fields were reviewed. In-force ADR-0017 (server ownership), ADR-0047 (one server per window), ADR-0048 (window connections), ADR-0066 (root authority), ADR-0071 (visible terminal panels), and ADR-0082 (data-only shell integration) constrain this work. No accepted ADR needs modification or supersession.

## Goals / Non-Goals

Accept native folder opens and documented directory arguments on initial and subsequent launches; open a visible local terminal at the exact requested folder. Preserve normal no-argument startup.

Do not edit other applications' terminal lists, choose a global default on the user's behalf, claim unsupported executable or URL types, implement AppleScript terminal emulation, or execute arbitrary launch commands. This change introduces no new renderer filesystem access.

## Decisions

1. **Register only supported folder types.** Add alternate `public.folder`/`public.directory` document handling to macOS packaging, rather than pretending a category is a universal terminal registration. Do not claim `public.unix-executable` or SSH until execution semantics exist. Boundary: Launch Services to the privileged Desktop host.
2. **Normalize launch sources into literal folder requests.** A small testable privileged module parses app operands separately from Electron's executable/development entry point and known runtime switches. Support positional paths, local file URLs, `--working-directory` with separate or equals value, and `--`. Keep the original invocation working directory in single-instance additional data so forwarded relative paths do not use the primary process's directory. Unknown user options fail explicitly rather than being discarded. Boundary: external process data to host filesystem input; never use shell interpolation.
3. **Queue before readiness, drain serially after successful bootstrap.** Install `open-file` before `ready`; prevent the default event handling. Initial and forwarded requests enter the same FIFO. Catch individual request failures so later requests are not lost. Do not deduplicate separate intentional launches. Normal startup focus remains for invocations without folder operands. Avoid replaying launch operands through updater/recovery relaunches. Boundary: application lifecycle to ready embedded authority.
4. **Use local server authority and local presentation.** Resolve and validate canonical directories on the local server; match exact canonical project roots, create a project only when needed, create a server-owned terminal with explicit cwd, and focus its panel in the project's visible local workspace. Reuse an existing local window or create a local one without changing a remote window. Use normal workspace commands for durable records and normal window/view machinery for selection. No generic renderer command channel or remote path forwarding. Boundary: Desktop launch intent to embedded server mutation and device-local presentation.
5. **Make failures observable.** Report bounded actionable failures through the native error UI (and stderr for direct invocations); do not leave an invisible live session or swallow readiness failures. Metadata assertions and unit tests cover parser/queue/failure cases; Docker E2E checks actual server cwd and visible panel. Packaged macOS Launch Services delivery requires a native smoke check, separate from Linux Docker tests.

### Concrete handoff and failure policy

A main-only adapter delegates orchestration to a local-server helper, injected with the embedded workspace command application, server root canonicalizer, and server-owned terminal creator. This helper is not registered as IPC, MCP, or a protocol operation. It uses existing trusted host command authority, never a fabricated renderer/device principal. Project matching and terminal lifecycle stay in the server helper; Desktop supplies only native input and window presentation. Tests assert the production preload and operation registries expose no native-launch route.

The local window is selected through `windowServerControllers.currentProfileId()` and its bound view identity. A missing local window is created explicitly on Local. Before any project or terminal mutation, wait for the selected workspace client to attach so its initial snapshot and event subscription are established. Selection then uses the existing addressed workspace-view relay with a ten-second deadline; the host does not parse or inject renderer workspace state. Every successful server terminal already owns a durable panel. On presentation failure, retain that discoverable terminal and report the failure; do not kill it or falsely report successful presentation. A new empty project remains if terminal creation fails, allowing retry.

The queue admits up to 64 outstanding folders, each at most 4096 characters, rejecting an overflowing invocation atomically. Mixed and repeated options append requests in order. Syntax errors reject the entire invocation before enqueue; filesystem errors reject individual requests. Startup failure explicitly rejects pending work. Addressed presentation times out after ten seconds, so a closed or stalled client cannot block subsequent requests indefinitely. Forwarded secondary processes acknowledge submission, not asynchronous completion; the primary presents completion failures natively and on stderr.

## Risks / Trade-offs

- macOS caches associations → validate the built plist and use an installed app for the native smoke check.
- No universal terminal picker protocol → document supported invocation forms without promising inclusion in third-party menus.
- Early events and slow bootstrap → queue until authority and presentation exist; startup failure must not silently discard requests.
- A remote window is frontmost → explicitly select/create a local window; never repurpose the remote window.
- Chromium adds switches → parse known runtime arguments separately and preserve ordered original operands using single-instance additional data.
- Directory changes between validation and spawn → keep server-side launch validation authoritative and report the failure.

## Migration Plan

Ship metadata and handlers together. Existing user data requires no migration. Rollback restores the previous package; no default associations or running terminal configuration are rewritten.

## Open Questions

None requiring a product decision. Native smoke availability and baseline test failures are recorded as verification evidence, never inferred from unit coverage.
