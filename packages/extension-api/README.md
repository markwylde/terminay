# `@terminay/extension-api`

This dependency-free package is the public contract for server-side Terminay
coding-agent and language server extensions. It contains the closed v1 manifest
validator, the agent session source, MCP install target and chat provider
contracts, the language server contribution and launch contract, and fixed
application-protocol DTOs. It does not grant privileged server access.

Version 3.0 removed the terminal-scoped agent provider contract (`agentProviders`,
`registerProvider`, `observe`, `jsonlSession`, the observation broker, the
lifecycle publisher, and the driver toolkit). Terminay accepts only extensions
declaring `api: "^3"`.

An extension exports `defineExtension({ activate, deactivate })`. Its
`package.json` contains a `terminay` manifest matching
`TerminayExtensionManifest`. Run `terminay-extension-conformance package.json`
before publishing to validate that manifest and its exported entrypoint.

Extensions are trusted code running with the selected Terminay Server account's
authority. The extension host provides lifecycle and crash isolation, not an OS
security sandbox.

Start with the [developer documentation](https://terminay.com/developers/),
including the [extension quickstart](https://terminay.com/developers/extensions/quickstart),
[manifest reference](https://terminay.com/developers/reference/manifest),
[permissions](https://terminay.com/developers/reference/permissions), and
[packaging](https://terminay.com/developers/extensions/packaging) guides. The
agent authoring surface — default-exported `activate(context)`,
manifest-bound registration, session sources, MCP install targets, and
`@terminay/extension-api/testing` — is the worked example in
[`examples/session-source`](examples/session-source). The reusable workflow
template covers packing, conformance, SBOM/license evidence, npm trusted
publishing, and post-publication integrity checks for repositories maintained
separately from Terminay.

## Agent session sources

A session source reports every live coding-agent session of its harnesses on
the server's machine, however it was started. Declare it under
`contributes.agentSessionSources` with a namespaced `id`, a `displayName`, its
`harnesses` (`{ id, displayName }`, at most
`EXTENSION_LIMITS.agentSourceHarnesses`), optional `platforms`, and the
`environmentVariables` it needs (the host passes each one to the extension
child when it is set on the server). It requires the `agent-observation`
permission. During activation call
`context.agents.registerSessionSource(id, runtime)`; an undeclared id, a
duplicate, or a registration after deactivation is refused.

`runtime.start({ enabledHarnesses, publisher, signal,
onEnabledHarnessesChanged })` begins watching and resolves once the source is
running. Publication rules:

- **Ordering.** Calls take effect in the order made. `reset(sessions)`
  replaces everything the source reported before; `upsert(session)` replaces
  one session by id; `remove(sessionId)` forgets one live session. Send a reset
  after starting and after every enabled-harness change.
- **Bounds.** A snapshot is a closed object: `id`, `harness`, `pid`, absolute
  `cwd`, and optional `title`, `model`, `status` (`running`, `waiting`,
  `blocked`, `idle`), `waitingFor`, `tool`, `lastTurn` (`completed`, `failed`,
  `interrupted`), `lastTurnEndedAt` (epoch ms), `error`, and `subagents`
  (`{ id, parentId?, type, title?, status }`). Every string and list is bounded
  by `EXTENSION_LIMITS` (`agentTitleLength`, `agentErrorLength`,
  `agentSubagents`, `agentSessionsPerReset`, and so on). A reset never names
  one session twice.
- **Harness switches.** Users switch each declared harness on or off in
  Settings. `enabledHarnesses` is the current set, and
  `onEnabledHarnessesChanged` delivers each change without restarting the
  extension. A snapshot naming an undeclared or switched-off harness is
  rejected; stop reporting a harness when it is switched off and report its
  live sessions when it is switched back on.
- **Privacy.** Transcripts, prompts beyond the title, tool arguments, and raw
  records are never accepted.
- **Diagnostics.** `publisher.diagnostic({ code, message })` records a typed,
  kebab-case problem with a bounded message and no paths or conversation
  content.
- **Cancellation.** `signal` aborts when the source is disposed, the extension
  is disabled, or agent status is switched off. Release every watch; later
  publisher calls are ignored.

Terminay owns everything else: which project a session belongs to (its cwd
under the project root or any worktree of the project's repository), which
terminal it binds to (by process ancestry, never by an extension's claim),
acknowledgement, ordering, and presentation.

Validation failures surface as `ExtensionSchemaError` with `SchemaIssue`
entries whose `code` names the rule: `invalid_string`, `invalid_array`,
`invalid_enum`, `invalid_path`, `invalid_integer`, `unknown_field`,
`duplicate`, `harness_not_enabled`, and `unknown_session`.

## MCP install targets

An MCP install target owns one client's Terminay MCP registration. Declare it
under `contributes.mcpInstallTargets` (`{ id, displayName }`), require the
`mcp-registration` permission, and register it with
`context.mcp.registerInstallTarget(id, runtime)`. `status`, `install`, and
`uninstall` each receive `{ server, signal }`: the host-supplied Terminay MCP
server command (`command`, `args`, `env`) and a signal that aborts on the
call's deadline. `status` returns `{ state, configPath, message? }` with
`state` one of `not-installed`, `installed`, `changed`, `unavailable`, or
`error`; `install` and `uninstall` return `{ ok, installed, message?, error? }`.
When the server cannot run the MCP adapter the host reports every target
unavailable and makes no call.

## Chat providers

A chat provider runs the turns of an agent chat that Terminay owns (API 3.2).
Declare it under `contributes.agentChatProviders` (`{ id, displayName,
description?, platforms? }`), require the `agent-chat` permission, and register
it with `context.agents.registerChatProvider(id, runtime)`.

- `availability(signal)` returns `{ available: true }` or `{ available: false,
  reason, detail? }`, with `reason` one of `not_installed`, `not_signed_in` or
  `unsupported_platform`. Put the command that fixes it in `detail`.
- `openSession(request, events, signal)` starts one session. The request holds
  an opaque `sessionId`, an empty private `workingDirectory`, an optional
  `instruction`, and `mcpServer`: the one MCP server the agent may use (`name`,
  `command`, `args`, `env`), or `null` when the chat has no MCP reach.
- The session's `prompt(text, signal)` runs one turn and resolves when the
  agent finishes or `cancel()` stops it. `close()` ends the session and its
  process.
- Report through `events`: `text(delta)`, `tool({ callId, server?, name,
  state })` with only names (never arguments or results), `failure({ reason,
  detail? })`, and `exit({ code, signal })` when the process ends.

A provider must confine its agent to `mcpServer`: built-in tools off where the
agent allows it, no other MCP server or user MCP configuration, every request
for another tool declined, no session history on disk, and nothing written to
the agent's own configuration, settings, hooks or credentials. It starts the
user's installed agent and never downloads one. Terminay keeps the
conversation, mints the MCP capability, and shows approvals; a provider cannot
read or change any of them.

## Terminal launchers

A terminal launcher puts a button on every folder's New terminal row that
starts an installed program, such as a coding agent, in a new terminal
(API 3.3). Declare it under `contributes.terminalLaunchers`, require the
`agent-launch` permission, and register it with
`context.terminals.registerLauncher(id, runtime)`.

```json
{
  "permissions": ["agent-launch"],
  "contributes": {
    "terminalLaunchers": [
      {
        "id": "com.example.agents/launch-example",
        "displayName": "Example Agent",
        "icon": "terminal",
        "platforms": ["darwin", "linux"]
      }
    ]
  }
}
```

- `icon` is an id from the Terminay icon allowlist (`EXTENSION_ICONS`);
  extensions never supply artwork.
- `harness` (`{ source, harness }`) optionally names a harness of a session
  source the same package declares. While the user has that harness switched
  off, the launcher is not offered and is not asked anything.
- `resolve(signal)` returns `{ available: true, executable }` with the
  absolute path of the program, or `{ available: false, reason, detail? }`
  with `reason` one of `not_installed` or `unsupported_platform`.

A launcher only says where its program is. Terminay creates the terminal in
the folder the user chose, with the default shell profile and working
directory, and types the quoted path into the shell with no arguments,
environment, or input of the launcher's, apart from the flags of a matching
terminal command default. When the program exits the user is back at the
shell. A launcher cannot read or write the terminal.

## Terminal command defaults

A terminal command default adds flags in front of the user's arguments when a
command runs in a Terminay terminal (API 3.4). Each one is an exception to
Terminay's rule that it observes agents and never changes how they run, and
needs the repository owner's approval in an ADR. Declare it under
`contributes.terminalCommandDefaults`, require the `terminal-command-defaults`
permission, and register it with
`context.terminals.registerCommandDefault(id, runtime)`.

```json
{
  "permissions": ["terminal-command-defaults"],
  "contributes": {
    "terminalCommandDefaults": [
      {
        "id": "com.example.agents/example-defaults",
        "command": "example"
      }
    ]
  }
}
```

- `command` is fixed by the manifest: one plain word that is not a builtin or
  reserved word of zsh, bash, fish, or PowerShell.
- `harness` (`{ source, harness }`) optionally names a harness of a session
  source the same package declares. While it is switched off the default does
  not apply and is not asked anything.
- `resolve(signal)` returns `{ applies: true, args }`, where every argument is
  a flag starting with `-`, or `{ applies: false, reason, detail? }` with
  `reason` one of `not_installed`, `unsupported`, or `unavailable`.

Terminay turns each default into a shell function in new terminals with shell
integration, so typing `example run` runs `example <args> run`, and appends
the flags when a launcher starts that command. An extension supplies data
only; Terminay writes every line of shell code and quoting. A user's own alias
or function of the same name wins, and two extensions claiming one command
cancel each other out.

## Testing agent extensions

`createAgentExtensionHarness(extension, { manifest })` activates an extension
in memory and applies the host's rules. `start()`, `setEnabledHarnesses()`,
and `stop()` drive a session source; `sessions()`, `publications()`,
`diagnostics()`, and `violations()` report what it published, and
`assertConformant()` fails on any contract breach. `mcpStatus()`,
`mcpInstall()`, and `mcpUninstall()` drive install targets with
`fixtureMcpServerCommand` or a command you pass. `chatAvailability()` and
`openChatSession(providerId, request?)` drive a chat provider with
`fixtureChatSessionRequest` overridden by what you pass; the returned session
records its validated `events()`, any `violations()`, and the reply `text()`.
`registeredLauncherIds()` and `resolveLauncher(launcherId)` drive a terminal
launcher, validating its resolution.
`registeredCommandDefaultIds()` and `resolveCommandDefault(id)` drive a
terminal command default the same way.
[`fixtures/session-source`](fixtures/session-source) is an independent,
packable third-party source.

## Language servers

A language server extension contributes `contributes.languageServers` entries —
an id, display name, the language ids and file extensions it serves, and the
runtime notes Settings shows — and calls
`context.registerLanguageServerProvider({ id, runtime })` during activation. Its
`runtime.launch(request, signal)` receives one project root and returns the
command, arguments, environment overlay, initialisation options, and a short
description of what it resolved. Everything else belongs to the host: spawning
the server with the project root as its working directory, stdio framing, LSP
initialise, lifecycle, deadlines, crash accounting, and translation into core's
bounded DTOs. No LSP JSON-RPC crosses the application protocol, and a language
server extension contributes no UI and registers no protocol operations.

`@terminay/extension-api/testing` carries the matching test tools:
`createLanguageServerExtensionHarness` activates an extension and applies the
host's registration rules, and `openLanguageServerSession` starts the launch it
returned and speaks LSP to it over stdio — initialise, `didOpen`, diagnostics,
completion, hover, and definition — so a package can prove its launch against a
real server. [`fixtures/language-server`](fixtures/language-server) is a
worked, packable example built on a stub server.

Secret access stays scoped. `secrets.withValue(binding, use)` resolves an
extension's exact profile/field binding in the parent, makes bytes available
only inside the child-side callback, and zeroizes the child copy afterward. The
generic atomic `vault` broker offers `put`, local-callback `withSecret`, and
`remove` over durable opaque `{ bindingRef }` values scoped to the extension
installation. Neither surface has a read/list/export API and neither returns raw
secret bytes. Secret bytes must never be returned or included in extension
state, UI DTOs, logs, or errors. See the
[scoped brokers reference](https://terminay.com/developers/reference/scoped-brokers)
for cancellation, zeroization, pending removal, and crash-cleanup obligations.
