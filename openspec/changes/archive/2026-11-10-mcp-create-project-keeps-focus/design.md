## Context

`create_project` (in `apps/terminay-server/src/mcp/appControlAdapter.ts`) creates the project, starts it, opens its first terminal, and then sends the agent's client a `showProject` view request (ADR-0070). The renderer handles that by activating the project, which moves the user off whatever project or Home section they were on and takes keyboard focus with it. The result reports whether that happened as `shown` and `reason`.

Every other path that adds a project leaves the client's active project alone: a projection that adds a project runs `pickLocalActiveProjectId`, which keeps the current selection. Only a user's own creation (the `+` control) activates the new project, and only if they have not moved elsewhere. `open_terminal` already defaults to not taking focus and needs `focus: true` to do so.

## Goals / Non-Goals

**Goals:**
- An MCP-created project never changes what any client shows or where keyboard focus is.
- The agent can still show the project when the user asks, using the existing `focus_project` tool.

**Non-Goals:**
- Changing the explicit view tools (`focus_project`, `focus_terminal`, `focus_home`, `open_terminal` with `focus: true`, `open_workspace_window`), whose purpose is to change the view.
- Changing what the user's own `+` creation flow does.
- Changing a closed project's fallback selection; closing the shown project necessarily shows another.
- Changing which window a project goes into. When the agent's client is on Home, `shownWindow()` has no project to derive a window from and falls back to the server's first window; that placement rule predates this change and is untouched.

## Decisions

**Drop the `showProject` request rather than add a `focus` option to `create_project`.** A `focus: true` flag would mirror `open_terminal`, but `focus_project` already does exactly that as a separate, explicit step, and one more way to steal focus is the thing being removed. Alternative considered: keep the request and make the renderer ignore it unless idle — rejected, it guesses at user intent and keeps the view coupling.

**Remove `shown` and `reason` from the result.** They only described the view request. Leaving `shown: false` forever would mislead an agent into thinking something failed. The result keeps the project description and terminal handle.

**Window choice is unchanged.** Without a named window the project still goes into the window the agent's client shows, which needs a read-only `layout` query to that client. Reading the view does not change it, so it stays within ADR-0070's boundary.

**A failed first terminal leaves the project and reports `terminal_reason`.** This is today's behaviour; the spec now states it because the result no longer always carries a terminal handle.

**Tests cover the adapter and the real window.** The adapter test asserts no view request reaches any client, which is what keeps every other client's view unchanged. The Pixel e2e test, run through `npm run test:e2e`, asserts that the user's project and terminal stay in front while the new project's tab appears.

Boundary: this narrows what an MCP caller can do to a client's view (ADR-0070, ADR-0072). No authority or scope check changes.

## Risks / Trade-offs

- [Agents or prompts that relied on the project appearing in front] → The tool description says it is created in the background and names `focus_project`; Pixel and bot prompts do not depend on `shown`.
- [MCP clients reading `shown`] → It is a small result-shape break; recorded as **BREAKING** in the proposal.

## Migration Plan

Ships with the server; no stored state changes. Rollback is reverting the adapter change.

## Open Questions

None.
