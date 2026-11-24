## Context

The built-in agents extension (`extensions/builtin-agents`) does two separate jobs:

- **Session source** (`src/source.ts`). A `HARNESSES` table maps each harness id to one `@markwylde/all-your-agents` provider. The manifest (`package.json` → `contributes.agentSessionSources[0].harnesses`) declares the same ids so the host can show per-harness switches. Per ADR-0025, detection lives entirely in the library.
- **MCP install targets** (`src/mcp/`). Each supported client has a writer module: `claudeCode.ts`, `codex.ts`, `cursor.ts`, `gemini.ts`, `grok.ts` and `openCode.ts`. `index.ts` registers them in `MCP_INSTALL_PROVIDERS`, `targets.ts` maps them to target-local ids, and the manifest lists them under `contributes.mcpInstallTargets`. The writers share no parsing with detection, as the "Versioned provider registration adapters" requirement demands.

Facts checked while exploring:

- `@markwylde/all-your-agents` 1.6.1 was pinned when this change began. It exports `antigravityCli()`, provider id `antigravity-cli`, which reads `~/.gemini/antigravity-cli` and needs `node:sqlite`. Electron 45 (`ELECTRON_RUN_AS_NODE`) reports Node 24.22.0 and loads `node:sqlite`. The standalone server runs Node 24.15. Both satisfy the provider's Node ≥ 22.13 requirement.
- agy 1.5.16's `agy mcp add terminay <cmd> <args…>` writes `~/.gemini/config/mcp_config.json` as `{"mcpServers":{"terminay":{"command","args","env","disabled":false}}}`. The agy changelog calls this the migrated user-level path. The old `~/.gemini/antigravity-cli/mcp_config.json` location is not read.
- agy installs with `curl -fsSL https://antigravity.google/cli/install.sh | bash` into `~/.local/bin/agy`.

## Goals / Non-Goals

**Goals:**

- Show Antigravity sessions in the Agents pane, with their own harness switch.
- Let users install and remove the Terminay MCP registration for agy from **Install Terminay MCP**.
- Drop Gemini CLI from the install targets and from the compatibility test.

**Non-Goals:**

- Antigravity terminal launchers, chat providers, bot agents and terminal command defaults.
- Removing or migrating `terminay` entries users already put in `~/.gemini/settings.json`. They are left untouched.
- Supporting agy's per-workspace or plugin MCP configuration.

## Decisions

### 1. Harness id `antigravity`, display name "Antigravity"

The harness id is `antigravity`. It is Terminay's id, kept short like `codex` and `grok`. It maps to the library's `antigravity-cli` provider. The display name follows Google's product name, "Antigravity", not the library's "AntiGravity" spelling. Using `antigravity-cli` as the harness id was rejected because harness ids name agents, not CLI packages.

No session-source environment variable is added. The provider takes its home from an explicit `home` option and documents no override variable, so Terminay passes nothing.

### 2. The MCP writer targets `~/.gemini/config/mcp_config.json` directly

A new `src/mcp/antigravity.ts` reads and atomically rewrites `mcpServers.terminay` in `~/.gemini/config/mcp_config.json`, keeping every other key. It reuses the JSON-object `mcpServers` pattern of `cursor.ts` and `gemini.ts`, including their unparsable-file refusal and their changed-entry review.

The entry carries exactly `command`, `args` and, when the host supplies it, `env`, the same shape the other JSON writers produce. It never writes `disabled`. A probe against agy 1.5.16 in a throwaway home showed an entry without `disabled` listed as `enabled` by `agy mcp list`. Matching compares only `command`, `args` and `env`. An existing entry that also carries `disabled` (because the user ran `agy mcp disable terminay` or added it with `agy mcp add`) therefore differs from what Terminay writes. It is shown as changed for review and is never overwritten silently, and Replace writes the entry without `disabled`, which enables it. Uninstall removes the entry whatever its `disabled` value.

The alternative was shelling out to `agy mcp add` and `agy mcp remove`. It was rejected because:

- it needs agy on the server's PATH, which every other target avoids
- it would bypass Terminay's matching, changed-entry review and atomic write
- the compatibility test already proves agy accepts the file directly

Boundary: this stays inside the extension's `mcp-registration` permission (ADR-0031 and ADR-0068). The entry holds no token or socket path. The capability variables reach the adapter only through the environment agy's MCP child inherits from the Terminay terminal.

### 3. Capability environment reaches the adapter by inheritance

Claude Code, Cursor, Grok and OpenCode pass the terminal environment to stdio MCP children, so `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN` arrive without configuration. Codex needs an `env_vars` whitelist. agy's schema has no whitelist key, and needs none. In an isolated home, agy 1.5.16 started a probe stdio server registered as `terminay` before it asked for sign-in, and the probe saw a marker variable set in agy's environment. The Docker compatibility test repeats that probe on every run (Decision 5), so a future agy that strips the environment fails CI instead of silently breaking the tools. The probe records only whether the marker arrived, never its value.

### 4. Gemini CLI is removed outright, with no cleanup

The target id `com.terminay.builtin-agents/gemini`, `gemini.ts` and its tests go. Terminay stops reading `~/.gemini/settings.json` entirely. A leftover entry there is harmless: it starts the same stdio adapter, which authenticates only through the terminal capability. Deleting it on upgrade would mean writing into a file Terminay no longer owns a target for, which breaks the rule that only an explicit Uninstall removes an entry.

The main spec's "Per-client user-wide registration contracts" requirement is REMOVED and re-ADDED as "User-wide registration contract for each client". OpenSpec 1.16 does not let a MODIFIED block drop the Gemini scenario, and main specs may not keep Gemini wording.

### 5. Compatibility image installs agy from its official installer

`Dockerfile.mcp-cli-compat` drops `@google/gemini-cli` and runs the agy install script as the `node` user, as it already does for Cursor. `scripts/mcp-cli-real-compat.test.mjs` replaces the `gemini` client with `{ id: 'antigravity', binary: 'agy', listArgs: ['mcp', 'list'] }`. `agy mcp list` reads configuration only and needs no credentials, which matches the requirement that the test uses none.

The existing runner passes whenever the list output contains `terminay`, even when the command fails. For agy it must also require exit status 0 and a `terminay` row whose type is `stdio` and whose status is `enabled`, so an error message that mentions the name cannot pass. A second, agy-only check registers a probe server instead of the packaged adapter, starts `agy -p` with a marker variable and stdin closed, and requires the probe to record that the marker arrived. agy then exits on its missing sign-in, bounded by `timeout`.

### 6. Background waits cross as running

The library reports an idle Antigravity session whose background work is unfinished as `waiting` with `waitingFor` `shell`, `task` or `subagent`. The adapter already turns `shell` and `monitor` waits into `running`, because no user input is requested. It extends that set to `task` and `subagent`. The canonical states reserve `waiting` for explicit user input, and agy's real input requests carry `approval`, `ask` or `elicitation`, which keep crossing as `waiting`. The set is harness-independent, because the library gives these words the same meaning for every provider.

### 7. Agents-pane proof comes from an upstream fixture driver

The agent-provider-conformance capability requires Electron coverage of the Agents pane for every reported harness, driven by the library's fixture drivers. all-your-agents 1.6.1 ships drivers for Claude Code, Codex, Grok and oh-my-pi, but not Antigravity. The user chose to add an Antigravity fixture driver upstream, in `markwylde/all-your-agents`. It is exported from `@markwylde/all-your-agents/testing` alongside the others and writes agy's SQLite conversation, summary and presence-lock records held open by a real process. Claude opens that pull request on GitHub, and the user merges and publishes it. This change then pins that exact version, updates the README matrix (ADR-0025 requires both in the same change), and adds an Antigravity Agents-pane case to `e2e/extension-agent-runtime.spec.ts`.

Writing agy's storage format from a Terminay-local helper was rejected, because ADR-0025 puts all harness format knowledge and its proof in the library.

## Risks / Trade-offs

- [agy may not pass the terminal environment to MCP children] → Task 2.4 verifies this before review. A failure stops implementation and goes to the user.
- [agy may move its MCP file again] → The Docker compatibility test uses the latest agy and fails on drift. The writer is a single versioned adapter.
- [Users with a Gemini `terminay` entry lose the target with no notice] → The proposal marks this BREAKING. The entry keeps working wherever Gemini CLI still runs, and the user can remove it by hand.
- [The `mcp-registration-survives-upgrades` change also modifies "Registration management surface"] → Whichever change archives second must rebase its MODIFIED block onto the first one's text. The only edit here is the contributed-target list.
- [Holder probes or `node:sqlite` missing on a platform] → The library yields no Antigravity sessions and the other harnesses are unaffected. The README matrix states the requirement.
- [The upstream release gates the pin bump and the E2E case] → Everything else in this change can land first in the worktree. Implementation pauses at the bump task until the user has published the release.

## Migration Plan

Nothing to migrate. Existing harness switch state has no `antigravity` key, so it defaults to on, as every new harness does.

Rollback: an older Terminay shows the Gemini CLI target again and no Antigravity target. A `terminay` entry already written to `~/.gemini/config/mcp_config.json` stays there. agy keeps loading it and starting the adapter, which still works because it authenticates only through the terminal capability. To remove it, uninstall the Antigravity CLI target before rolling back, or afterwards run `agy mcp remove terminay`.

## Open Questions

None. The facts that could have blocked this change (missing `disabled` reads as enabled, and the MCP child inherits the environment) were checked against agy 1.5.16, and the compatibility test keeps checking them. The fixture-driver route was decided by the user (Decision 7).
