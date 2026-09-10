# `@terminay/extension-api`

This dependency-free package is the public contract for server-side Terminay
coding-agent and language server extensions. It contains the closed v1 manifest
validator, agent provider authoring types, the language server contribution and
launch contract, the terminal-scoped observation contract, and fixed
application-protocol DTOs. It does not grant privileged server access.

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
agent-provider authoring surface — default-exported `activate(context)`,
manifest-bound registration, terminal-scoped observation, named lifecycle
publisher, and `@terminay/extension-api/testing` — is the worked example in
[`examples/agent-provider`](examples/agent-provider). Node APIs reach only the
Terminay Server account; terminal evidence must use `terminal.observation`.
The reusable workflow template covers packing, conformance, SBOM/license
evidence, npm trusted publishing, and post-publication integrity checks for
repositories maintained separately from Terminay.

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

Every project runs on the server that owns it, so a terminal context always
offers the full observation broker: process, TTY, open-file, realpath, stat,
read, directory listing and watching, and journal follow. There is no capability
subset to declare and no capability-missing outcome to handle.

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
