# Terminay omp Agent extension

`terminay-agent-omp` is the official [oh-my-pi](https://github.com/badlogic/oh-my-pi)
CLI provider for Terminay's Agents sidebar. It is an ordinary ESM Node.js
extension: it imports only `@terminay/extension-api` and public Node APIs. It
does not import Terminay Server Core, Electron, renderer code, or a private
host bridge.

## What it supports

- Interactive `omp` and `oh-my-pi` processes, including OMP's recognised Bun
  launcher shape on macOS and Linux.
- OMP v0.1 journal projection: session title, user turns, model changes, tool
  start/finish, terminal assistant completion, and session exit.
- Root and separately proven child journals. A child identity is its stable
  journal filename, not its prompt or an array position.
- Rebinding after OMP atomically replaces a journal, and conservative
  process-writer fallback while the breadcrumb is not yet materialised.
- Standard OMP data, profile, `PI_CODING_AGENT_DIR`, and Linux XDG layouts.
  The provider requests only the five declared OMP root variables from the
  exact terminal process; it never substitutes the extension host's ambient
  environment.

## Session identity

Terminay must never attach an `omp` terminal to a nearby or recently modified
journal. OMP writes a terminal-session breadcrumb that maps the exact PTY's
terminal id to one root session file. This extension validates the breadcrumb,
then validates the root journal's fixed layout and logical `session` header
before binding it.

Root selection preserves OMP's precedence: `OMP_PROFILE`, then `PI_PROFILE`,
then `PI_CODING_AGENT_DIR`, then the standard root, followed by Linux XDG
layouts. For custom and XDG roots, the extension asks Terminay to canonicalize
paths below the corresponding **declared terminal environment value**. That
keeps remote projects correct and prevents a journal path from becoming an
arbitrary filesystem capability.

The first 256 bytes of an OMP journal are a mutable title slot. They are not a
session header and cannot establish identity. OMP can replace the journal
atomically, so the extension relies on the public follow/rebind contract rather
than retaining a provider file descriptor.

Before OMP creates its breadcrumb and journal, the extension emits no agent
row. Its compatibility fallback accepts only a root journal actively opened by
a descendant of that exact terminal; it never uses cwd, timestamps, or a
"newest journal" heuristic.

## Sidebar data and privacy

The extension publishes only these safe facts:

- the title in OMP's title slot;
- user prompt text (bounded to 4,000 characters);
- model id/display name/effort when OMP persistently records them;
- tool name and native tool-call id;
- tool success/error, assistant completion, and safe exit outcomes.

It deliberately excludes assistant content, tool arguments, tool results,
paths, cwd, terminal breadcrumb content, profile values, environment variables,
and raw JSONL records. It does not infer `waiting` or `blocked`: OMP's journal
does not contain stable permission-request lifecycle evidence.

Extensions are trusted Node programs, not operating-system sandboxes. Install
only packages you trust. The public Terminay API still scopes terminal and
environment observation so a provider cannot publish lifecycle events for a
different issued terminal.

## Manifest

The package declares one provider:

```json
{
  "id": "com.terminay.agent.omp/cli",
  "displayName": "omp",
  "requiredEnvironmentCapabilities": [
    "process-observation",
    "filesystem-observation",
    "agent-journal"
  ]
}
```

It is enabled by default when bundled with Terminay. Users can disable it in
Extensions settings; this does not modify `~/.omp` or any OMP configuration.

## Development

From the Terminay repository root:

```sh
npm run compile --workspace terminay-agent-omp
npm test --workspace terminay-agent-omp
npm run test:compat --workspace terminay-agent-omp
npm run test:packed --workspace terminay-agent-omp
```

The final command creates a disposable `.tmp-pack/` archive and verifies that
the package does not leak private Terminay source paths. Run the real local CLI
presence smoke test only when OMP is installed and you explicitly want it:

```sh
TERMINAY_RUN_OMP_REAL_CLI=1 npm run test:real-cli --workspace terminay-agent-omp
```

It runs `omp --help`; it does not send a prompt, create a session, or change
your OMP files. Full end-to-end sidebar verification belongs to Terminay's
Docker-isolated Electron suite once the generic extension host is wired.

## Compatibility and limitations

The mapping targets OMP journal schema v0.1 and selects only durable record
shapes. Unknown records are ignored. Malformed title slots, breadcrumbs,
headers, records, and unsupported environment capabilities fail closed without
creating an unrelated sidebar row. The provider supports macOS and Linux;
Windows does not currently expose the PTY and journal evidence required for
safe binding.

## Installation and troubleshooting

OMP ships built in, installed offline and enabled by default. Disable or
re-enable it in **Extensions** settings without changing profiles or journals.
Start or resume `omp` normally; a compatible npm release may override the
bundled floor. It requires Extension API 1.1, Node.js 22+, and mapping 0.1. If
no row appears, verify foreground executable, terminal-scoped profile variables,
and observation capabilities. Remote sessions require the same scoped
breadcrumb/journal adapter and otherwise fail closed.
