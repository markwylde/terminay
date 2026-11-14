## Why

On a standalone server, every agent loses the Terminay MCP server a release or
two after it was installed. Claude Code reports `ENOENT ... posix_spawn
'/opt/terminay/versions/canary-dae5871e63b6/bin/node'`, Codex fails the same
way, and no terminal can call `list_terminals` or `get_workflow`. Opening
Settings → AI → Terminay MCP shows every installed client as "Changed — review
config" with its Install button disabled, so the only way out is to hand-edit
`~/.claude.json` and `~/.codex/config.toml`.

Two defects combine:

1. The standalone server registers the release it happens to be running:
   `process.execPath` and its own `mcpEntry.js` resolve to
   `<prefix>/versions/<release>/…`. The installer keeps only the current and
   previous releases, so the registered paths are deleted by the second
   upgrade, and every upgrade makes the entry "changed".
2. A changed entry is a dead end. Install and Uninstall both refuse a
   `terminay` entry that differs from what the server would write, and the
   modal disables the button, so the user cannot replace it from Terminay.

Desktop is not affected by (1): the Electron executable and its packaged entry
keep their paths across an in-place update.

## What Changes

- A standalone server running from `<prefix>/versions/<release>/` registers its
  Node binary and MCP entry through the install's `<prefix>/current` pointer,
  so the registered command keeps working across every upgrade and rollback and
  stays "installed". A server not running from such a tree (Desktop, a
  development checkout, an image without a release tree) registers exactly
  what it registers today.
- A target whose `terminay` entry is changed offers **Replace**. Replacing
  writes the server's entry over Terminay's own `terminay` entry only, after an
  explicit user action, and preserves the rest of the provider configuration.
  A changed entry is still never overwritten silently.
- MCP install targets gain an optional `replace` operation in the extension
  API. The built-in agents extension implements it for all six clients.
- ADR-0119 records that a standalone server names its install's stable pointer,
  never a versioned release directory, in anything that outlives the process.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: the registration management surface offers Replace for a
  changed entry; a standalone server's registration names its install's stable
  pointer.
- `extension-platform`: an MCP install target may implement `replace`.

## Impact

- `apps/terminay-server/src/cli.ts` and a new stable-path helper.
- `packages/extension-api`, `packages/server-core` extension host, child and
  router: the `replace` operation.
- `extensions/builtin-agents/src/mcp/*`: replace for each client.
- `apps/terminay-server/src/cli.ts`, `electron/serverTerminalAuthority.ts`: the
  `mcp-install.replace` command. `src/services/serverApplicationFeatureClients.ts`
  and `src/components/McpInstallModal.tsx`: the Replace button.
- Existing broken entries: one click on Replace repairs each client, after
  which upgrades never change the entry again.
