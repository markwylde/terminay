## Why

When Pixel, a bot or an agent creates a project through Terminay MCP, the user's window jumps to the new project. Whatever the user was looking at or typing into is taken away from them by something they did not do. What the user's client shows, and where keyboard focus sits, is the user's to change.

Today `create_project` always asks the agent's client to show the new project after it starts, and reports `shown` in its result.

## What Changes

- `create_project` creates the project, starts it and opens its first terminal without changing what any client shows: the active project, Home selection, folder, tab and keyboard focus all stay where they were. The new project appears as a background tab.
- **BREAKING** (MCP result shape): the `shown` and `reason` fields are removed from the `create_project` result.
- The `create_project` tool description tells agents it does not show the project, and that `focus_project` does when the user asks for it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-app-control`: the "Creating a project" requirement no longer shows the new project on the agent's client, and its result carries no `shown` flag.

## Impact

- `apps/terminay-server/src/mcp/appControlAdapter.ts` — drop the `showProject` request after creation.
- `apps/terminay-server/src/mcp/stdio.ts` — `create_project` description.
- `apps/terminay-server/test/mcp-app-control.test.mjs` — assert no view request is made and no `shown` field is returned.
- No renderer, Electron or protocol changes: projection updates already keep the client's active project.
