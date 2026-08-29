# Built-in extensions

## Summary

Terminay keeps its official extensions as independently publishable npm
packages under the repository's top-level `extensions/` directory. SSH, Puzed,
Codex, Claude Code, Cursor Agent, Grok, and omp use only the public
`@terminay/extension-api`; none imports Server Core, Electron, renderer code,
or private workspace modules.

Every Electron and standalone Terminay Server release contains verified,
self-contained package artifacts for these built-in extensions. A fresh server
materializes and enables them by default without network access. Users may
disable any built-in extension. Built-in status describes distribution, not a
more privileged runtime tier.

## Repository and package contract

Each directory below `extensions/` is one npm package with its own
`package.json`, manifest, source, tests, README, licence, build output policy,
and public-package conformance checks:

- `extensions/ssh` publishes `terminay-plugin-ssh`;
- `extensions/puzed` publishes `terminay-plugin-puzed`;
- `extensions/agent-codex` publishes `terminay-agent-codex`;
- `extensions/agent-claude-code` publishes `terminay-agent-claude-code`;
- `extensions/agent-cursor` publishes `terminay-agent-cursor`;
- `extensions/agent-grok` publishes `terminay-agent-grok`; and
- `extensions/agent-omp` publishes `terminay-agent-omp`.

The directories participate in the repository's npm workspace graph while
remaining packable and testable as ordinary public npm projects. Their runtime
dependency on `@terminay/extension-api` follows the public peer/development
dependency convention. Published packages contain no workspace-relative
imports or undeclared files and pass conformance against their packed tarball.

The package README for every agent extension documents:

- the supported CLI and provider versions;
- foreground-process recognition and exact terminal-binding evidence;
- provider-owned files and bounded fields it reads;
- canonical lifecycle, model, title, tool, wait, and subagent mappings;
- privacy exclusions and information that never crosses the extension host;
- unsupported provider behavior and fallback behavior;
- platform assumptions and environment capabilities; and
- fixture, compatibility, and real-CLI verification commands.

The five agent packages are the reference implementations for third-party agent
integration. Their tests and source use only the installed public SDK surface.
A repository boundary check fails when a built-in extension imports a private
Terminay package or reaches a private source path. Public Node.js APIs and
declared npm dependencies are valid extension implementation dependencies.

## Built-in artifact inventory

The release build packs each built-in extension and its production dependency
closure into a deterministic artifact inventory. The inventory records:

- extension id, npm package name, and exact version;
- manifest and Extension API compatibility;
- package and unpacked-file digests;
- production dependency lock and inventory digests;
- permissions and contributions; and
- the release identity that contains the artifact.

The same inventory format and package bytes are used by Electron and the
standalone Terminay Server archives. Release assembly fails when a built-in is
missing, stale, non-conformant, contains an unapproved native or lifecycle
requirement, differs between server distributions, or imports a private API.
No build silently fetches a built-in extension from npm.

## First-run installation and reconciliation

Built-ins use the normal immutable extension-slot format, public manifest
validation, extension host, IPC protocol, permissions, crash isolation, and
compatibility checks. On first start, the server materializes the release's
verified artifacts into server-owned slots and records their origin as
`built-in`. Materialization is idempotent and crash-safe.

Every built-in is enabled by default unless the server already has an explicit
user choice for that extension id. Disablement persists across application and
server upgrades. A release may provide a newer built-in slot, but startup never
silently re-enables an extension, changes an explicitly selected external
version, or hot-swaps a slot beneath a live provider.

Reconciliation is also a supported live server lifecycle. If a verified
release artifact materializes an enabled active built-in after the extension
manager is already running, the server activates that exact slot before it
reports reconciliation complete. Provider and agent-provider contributions
become visible together only after that host is running. A failed activation is
recorded as that extension's explicit failed runtime state; the UI never calls
an enabled-but-unhosted record `installed`. Reconciliation does not restart an
unchanged running provider, and it never swaps a selected override beneath an
active use.

The immutable artifact shipped with the current release cannot be physically
removed through extension management. A user can disable it, install and select
a compatible newer npm version, roll back to the release artifact, or remove
the external override. Removing an override returns to the bundled slot while
preserving the user's enabled/disabled choice.

An incompatible or failed built-in is represented like any other failed
extension and cannot prevent This server or unrelated extensions from becoming
ready. Dependent extensions show the ordinary dependency failure. Built-in
extensions appear once in Settings with a **Built in** and **Official** origin,
not as duplicate catalogue and installed entries.

## Agent extension composition

Agent extensions contribute agent providers; they do not contribute project
environments. At runtime they are composed with the exact project environment
that owns a terminal. The environment supplies only the observation
capabilities it actually implements. This server supplies native local
observation; SSH or another provider may supply equivalent remote observation.

Disabling an agent extension immediately stops its new admissions and bounded
observers. Existing canonical entries for that provider are retired and the
terminal returns to generic activity fallback. Disabling SSH or Puzed affects
their environments through the existing dependency and in-use rules; it does
not implicitly disable unrelated agent packages.

When a newly reconciled agent host becomes available, Terminay re-evaluates
the last host-observed foreground executable for every live terminal. A newly
matching provider is admitted without restarting the terminal; a non-matching
terminal remains on generic activity. Local admission exposes only the
capabilities that provider declared, even when This server offers additional
observation capabilities.

## Acceptance outcomes

- A clean Electron or standalone-server installation exposes all seven built-ins
  without npm or network access and enables them by default.
- Disabling one built-in persists across restart and release reconciliation.
- Installing/removing an npm override preserves a verified bundled rollback
  floor and the explicit enablement choice.
- Electron and standalone archives contain identical built-in package
  inventories and fail release checks on drift.
- Every built-in package packs, tests, and typechecks using only
  `@terminay/extension-api` and its declared npm dependencies.
- Agent packages can be disabled independently without removing the Agents
  pane or breaking generic terminal activity.
