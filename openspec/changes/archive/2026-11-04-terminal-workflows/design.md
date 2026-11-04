## Context

Users already run long routines through an agent by pasting one prompt per stage. Terminay has the pieces such a routine needs, but nothing joins them:

- **Macros** (`packages/server-core/src/macroService`) are server-owned, revisioned definitions with ordered categories, a Settings library, and Command Bar groups. A macro types text into a terminal and is finished. It has no state while an agent works.
- **App window records** (ADR-0037, ADR-0076) are per-session server records persisted one file per record under the data root. They are restored only for sessions still running after the held sessions are reattached. They are drawn inside the terminal's pane: the minimised-window rail narrows the viewport instead of covering it.
- **The MCP surface** (ADR-0072, ADR-0074) addresses terminals through capability reach. It binds tools through a parser module and an adapter (`macroTools.ts`, `macroAdapter.ts`) and gates every operation by a fixed permission group in the operation table.
- **Typed input to a terminal** already has a contract for window messages: one paste, bracketed when enabled, submitted once, bounded to 16 KiB.

The design reference is the Round 2 boards on the Workflows concept canvas (signal rail with stage icons, and the template editor).

## Goals / Non-Goals

**Goals:**

- Show an agent's progress through a routine at a glance, in the terminal it is running in.
- Start a saved routine in one Command Bar action, and resume it in one action after the agent loses its place.
- Give the agent a durable, addressable list of steps to read and report against.
- Reuse the macro library model and the app-window record lifetime rather than inventing new ones.

**Non-Goals:**

- A workflow engine. Terminay never runs, times out, retries, branches, or advances a step (ADR-0097).
- Branching, parallel steps, or dependencies between steps. Steps are a flat, ordered list.
- Template inputs or variables (macro-style `{{field}}`).
- Agent-specific launch text. Launching types `/goal`, which Claude Code understands. Other agents are not targeted yet.
- MCP tools to create or edit templates. Templates are user-authored in Settings.
- Per-template panel presentation. Collapsed or expanded is one device-local setting.

## Decisions

### 1. Terminay records progress and the agent does the work

A workflow is data: steps, statuses, notes, and times. The agent reads it with `get_workflow` and reports with `update_workflow_step`. Terminay writes to the terminal only when the user launches or resumes, and only the fixed launch or resume text, never a step's prompt. This is recorded as ADR-0097 because it bounds every later request to "make Terminay run the next step".

*Alternatives:* typing each step's prompt when the previous step is marked done (a macro-style runner). This needs Terminay to decide when an agent is ready for input, which it cannot do reliably. It also turns a status report into a terminal write, which is a privileged action. Rejected.

*Boundary:* the terminal-session write boundary. Status updates never write to the PTY.

### 2. Templates follow macro state, and workflows follow app-window records

- **Templates** are a separate revisioned repository (`workflowService/templateRepository`), with the macro repository's normalisation, revision, categories-as-ordered-list, and "a command without categories keeps the stored list" rules. They are kept separate from macro state so that a schema change to one never migrates the other.
- **Workflows** are a per-session record store keyed by session: one file per terminal session, named by the session id, holding that session's workflow or none, and deleted when the session ends. Replacing or removing a workflow is one durable replace of that one file, so there is never a moment with two committed workflows or none. The file name, not its contents, says which terminal a corrupt file belongs to, so an unrestorable workflow is reported on the right terminal and stays reported until the user removes it. After the session holder's sessions are reattached, workflows of running sessions are restored and the rest discarded. A shutdown that leaves sessions in the holder keeps their files. The lifetime is ADR-0076's rule for app windows.
- **Durability differs from app windows.** The app-window store queues writes and treats records as rebuildable. Step progress cannot be rebuilt from anything else, so workflows are ADR-0088 *canonical* state: durable replace with a `.previous` copy. Each change is written synchronously before it is acknowledged or published, and a failed write rolls the in-memory change back and fails the request with `internal`. Because nothing is queued, shutdown has nothing to flush. On restore, a corrupt file is set aside and `.previous` is used. With no valid copy, the panel offers removal and nothing is invented, which is ADR-0088's "never choose defaults" for a per-terminal record. Step updates are minutes apart, so the extra flushes cost nothing that matters.

*Alternatives:* store workflows in the workspace snapshot. Rejected for the same reason ADR-0076 gives: the snapshot is rewritten and synced on every workspace command, and step updates arrive every few minutes per terminal. Storing them in the session holder was also rejected: the holder spans releases in frozen generations and must stay minimal.

*Boundary:* server-owned persisted state. Clients render and request changes, and never persist workflows.

### 3. Step identity is a server-assigned id

Each template step gets an id when created, and the id survives renames and moves. Launching copies the steps with fresh workflow-step ids. MCP addresses steps only by id. Titles repeat in real routines ("Fix findings" appears twice in the reference routine), so titles and positions cannot identify a step.

### 4. Free transitions, one active step, and a defined resume point

Any status may move to any status, so an agent can retry a failed step, skip ahead after a failure, or reset a step. Ordering is guidance in the instruction text, not a server rule, because "fail and carry on to the step that fixes it" is a real pattern (an e2e failure followed by the test-review step).

At most one step is `running` or `needs_input`. A second one fails with `step_active` and names the active step, so an agent that forgot to close a step learns which one. The server never repairs this silently (for example by auto-completing the earlier step), because that would record progress the agent never reported.

Times follow one table:

| To \ From | `not_started` | `running` / `needs_input` | `done` / `failed` |
|---|---|---|---|
| `running` | start = now | keep both | start = now, clear end |
| `needs_input` | start = now | keep both | start = now, clear end |
| `done` / `failed` | start = end = now | end = now | end = now (only when status changes) |
| `not_started` | — | clear both and note | clear both and note |

The **resume point** is the active step if there is one, else the first step that is not `done`. `get_workflow` returns it, so Resume never has to guess between "the running step" and "the first unfinished step".

### 5. MCP tools reuse existing permission groups and reach

`get_workflow` belongs to Read Terminals. `create_workflow` and `update_workflow_step` belong to Full Terminal Management, beside `run_macro` and `update_terminal`. All three default to the calling terminal and resolve any other terminal through the caller's reach (ADR-0072, ADR-0074). An unreachable terminal returns `terminal_not_found`, so a workflow's existence is not disclosed outside reach.

*Alternatives:* a new "Workflows" permission group. A new group adds a policy setting the user must understand, for tools that change only Terminay's own display of the caller's terminal. Rejected for now; it can be split out later without changing the tools.

Per ADR-0072, each tool decides whether it needs a calling terminal: none of them does. A chat capability gets them under its reach, must pass a terminal, and gets `bad_request` when it omits one. This differs from the app-window tools, which are terminal-only because a window is drawn over its caller.

The four new error codes (`workflow_exists`, `no_workflow`, `step_not_found`, `step_active`) are added to `ControlErrorCode`, the endpoint and stdio wire allow-lists, and `serverControlError()`. Otherwise they would collapse to `internal`. `step_active` and `workflow_exists` carry the id they name in the error's `candidates` field, which the endpoint already transports.

*Boundary:* MCP capability scope and the terminal-session security boundary. A workflow belongs to the session, so it moves with the terminal between projects exactly as the terminal's capability does.

### 6. Size bounds fit the ordinary MCP frames

The control endpoint limits ordinary requests to 64 KiB of serialized JSON and responses to 256 KiB. Only `show_window` and connected-server calls get large frames. Fifty 8 KiB prompts would not fit. Neither does a bound on decoded text: quotes, backslashes and control characters expand when encoded, and codex built a 48 KiB-of-text workflow that serialized to 99 KiB. So the bound is on what is sent. The JSON encoding of the name, opening prompt and steps (title, prompt, icon), measured with the same serializer the request uses, must be at most 56 KiB. That leaves 8 KiB for the request envelope, terminal handle and `replaceWorkflowId`. Templates use the same measure, so any saved template can be launched and read back. A `get_workflow` response of that content plus statuses, notes and times, wrapped again as MCP text content (which can roughly double it again in the worst case), stays under 256 KiB. The per-field bounds stay as they are.

*Alternatives:* add the tools to the large-frame sets. Rejected: large frames exist for documents and opaque payloads, and a checklist that needs more than 56 KiB of prompts is better split into several workflows.

### 7. Launch and resume are server commands that type once

The Command Bar sends `workflow.launch { templateId, terminal }` or `workflow.resume { terminal }`. The server authorises the exact terminal and project, as the macro service does. It builds the text from the template or workflow plus a fixed server-owned instruction, checks the 16 KiB bound, then attaches the workflow (on launch) and writes the text once through the same path window messages use: one paste, bracketed when enabled, submitted once. The bound is checked before anything changes, so an oversized launch leaves no half-attached workflow.

Replacing an unfinished workflow is confirmed in the client for a specific workflow. The command carries `replaceWorkflowId`, the id the user saw, and the server compares it with the attached workflow inside the same commit. A mismatch, including a workflow attached by another client or an agent while the dialog was open, is refused with `workflow_exists` naming the current id, and the client asks again. `create_workflow` uses the same field, so an agent cannot clobber a workflow it has not read.

The Command Bar lists only templates of the server that owns the active terminal, and sends the launch to that server. Settings › Workflows follows the Settings server selector, as macros do. Template ids are per server and never resolved across connections.

*Boundary:* client requests are untrusted (renderer boundary). The client names a template id and a terminal, never the text to type. Server scoping (ADR-0075 decision 4): no template list or command crosses connections.

### 8. The panel is pane chrome, like the app-window rail

The panel lives in `TerminalPanel`. It reserves a right-edge strip and the terminal is fitted to the remaining width, as the bottom rail does for minimised windows. Collapsed is about 40px wide and expanded about 280px. When expanded would leave the terminal under 60 columns, the panel shows collapsed whatever the setting is. Expanding it there opens a transient overlay that does not resize the terminal, does not change the setting, holds focus so no keystroke reaches the PTY, and closes on Escape, the collapse control, or focus returning to the terminal. The persistent layout never covers the terminal. Only an overlay the user opened does, and only until they dismiss it. Collapse state is one device-local setting in client settings, which follows the "device-specific presentation" category of client-owned state. It is not a server setting and is never exposed to MCP.

Icons are names from a fixed set drawn by the client (inline SVG paths in a client module). Unknown names normalise to none on the server. All workflow text renders as text nodes.

*Boundary:* the renderer renders only known icons and plain text, so no agent-supplied markup reaches the DOM.

### 9. Settings › Automation › Workflows uses the list column

Per ADR-0075, Workflows is a Settings category with a list model (categories, templates, step counts, filter, unsaved markers) and a detail editor. It reuses the macro library's drag-and-keyboard reorder components and window-level save. Template order is the Command Bar order.

## Risks / Trade-offs

- [The agent forgets to update steps, so the panel lies] → The fixed instruction tells the agent to set `running` before and a final status after every step. `step_active` errors surface missed closes. Resume re-anchors the agent on the stored state.
- [`/goal` is Claude Code-specific] → Documented as a non-goal. The instruction text is server-owned in one place, so per-agent launch text can be added later without changing templates.
- [The agent lacks Terminay MCP, or MCP is disabled] → The agent cannot read the workflow and will say so in the terminal. Open question: whether to hide workflow launch when MCP is disabled.
- [Many terminals with workflows write files often] → One small file per workflow, written on change only. Step updates are rare (minutes apart). Each write costs two flushes as ADR-0088 canonical state.
- [The panel narrows narrow panes] → Collapsed is 40px. Below 60 terminal columns, expanded is only a transient overlay.
- [56 KiB is too small for someone's routine] → The bound is shown in the editor with the current size. It can be raised later by moving the tools to large frames.
- [Template edited while a workflow runs] → The workflow holds a copy. This is intended, and the spec states it.

## Migration Plan

This change adds new state only. The template repository starts empty when its file is absent. Workflow records start empty. Rollback leaves the files unread and harmless. No existing state changes shape.

## Open Questions

- Should the Command Bar hide workflow launch while Terminay MCP is disabled, or launch anyway and let the agent report that it cannot see the workflow? The proposed default is to launch anyway and show a one-line warning in the confirmation when MCP is disabled.
- Should a finished workflow clear itself after a while, or stay until the user removes it or launches another? The proposed default is to stay.
