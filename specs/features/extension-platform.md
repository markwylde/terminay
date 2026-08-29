# Server extension platform

## Summary

Terminay extensions are npm-distributed, server-installed packages that add
project-environment or coding-agent providers. They execute only on the
selected Terminay Server. Desktop and browser clients render bounded declarative contributions
from the server's matching UI bundle and never load extension code.

The public API supports the capabilities needed by the official SSH, Puzed,
Codex, Claude Code, Cursor Agent, Grok, and omp extensions and leaves themes, editor
plugins, autocomplete, arbitrary commands, renderer components, and generic
Server Core operation registration out of scope.

## Installation scope and catalogue

Extensions are installed server-wide under the selected Terminay Server data
root. Embedded and standalone servers expose the same manager and runtime.
Opening Extensions on a remote server manages that server, not Desktop's
embedded server.

Terminay ships an official catalogue containing the built-in SSH, Puzed,
Codex, Claude Code, Cursor Agent, Grok, and omp npm packages and their expected
metadata. Verified package artifacts for that exact release are embedded in
Electron and standalone server distributions, installed without network access,
and enabled by default. See [built-in extensions](./built-in-extensions.md).
An administrator may also install from public npmjs or upload an npm-pack
compatible `.tgz` package to the selected Terminay Server, including a package
that has not yet been published.
Official packages use the same public manifest, extension host, broker, and
compatibility checks as custom packages. The **Official** badge is catalogue
metadata, not a privileged runtime tier.

**Install from npm…** accepts a public npmjs package name and optional
version/range/tag, resolves it once, displays the exact result, and requires an
authorized confirmation bound to that preview. Active records store only the
exact version and registry integrity. Terminay never silently follows `latest`
or auto-updates.

**Install package file…** accepts one bounded gzip tarball produced by
`npm pack`. The client uploads its bytes to the selected Terminay Server; it
never sends a local path for the server to open. The server hashes and inspects
the archive before preview, binds confirmation to the exact uploaded digest,
and feeds it through the same scripts-disabled validation, immutable-slot,
probe, activation, update, and rollback path as a registry package. The v1
compressed upload limit is 12 MiB. Preview state and uploaded bytes expire
together after ten minutes and are removed after confirmation, failure, or
server restart.

An uploaded root package may resolve from its server-owned staging archive.
All transitive packages must still resolve from public npmjs with integrity;
aliases, Git, HTTP tarballs, arbitrary file/directory dependencies, arbitrary
registries, and shell-like specifications remain rejected. Archive traversal,
absolute paths, links, non-regular entries, duplicate package manifests, excess
entry/unpacked-size bounds, malformed gzip/tar data, lifecycle/native build
requirements, and a materialized manifest that differs from preview fail
closed before extension code is imported.

Uploaded packages are labelled **Uploaded package · Unverified**. A catalogue
name or extension id alone never grants the Official badge; that badge on an
uploaded archive requires a future release-pinned digest match. The preview
shows filename, exact name/version, archive integrity, permissions, dependency
facts, and the trusted-code warning. Desktop and browser clients retain no
archive after the upload command completes.

## Package and manifest contract

One npm package contributes one immutable extension identity in v1. Its
`package.json` contains a closed, runtime-validated `terminay` object with:

- `manifestVersion`;
- globally collision-resistant immutable extension id;
- display name and bounded description;
- Terminay Extension API range and Terminay/Node engine compatibility;
- one relative ESM entrypoint exported inside the package;
- declared permissions;
- Terminay extension dependencies and compatible contribution ranges; and
- namespaced project-environment and coding-agent provider contributions.

`contributes.projectEnvironments` and `contributes.agentProviders` are
independently optional arrays; at least one supported contribution is required.
An agent package does not register a fake project environment merely to satisfy
the manifest.

An activated project-environment contribution registers its declared
capabilities with the selected server's environment router. The server derives
this registration from the activated manifest/extension pair; Desktop,
standalone composition, and generic Server Core never name an extension or
provider id. A contribution can opt into `profileSave: { createEnvironment:
true }`. Saving a profile otherwise persists only the profile. The opt-in
creates one environment bound to the just-saved profile and calls the public
`createEnvironment` callback; it is not inferred from a provider id, form, or
capability. This keeps provisioners that require additional create-form input,
such as Puzed, from receiving an unintended environment.

Package name and extension id are separate so repository/package ownership can
change without breaking persisted environment identities. Provider/action/form
ids are namespaced by the immutable extension id. Unknown manifest fields,
duplicate identities, core-operation collisions, absolute or escaping entry
paths, symlinks, non-regular entrypoints, incompatible versions, unsupported
platform metadata, and unbounded collections fail validation before import.

The independent version axes are npm package SemVer, manifest-format integer,
and Terminay Extension API SemVer. API major versions are breaking; minors are
additive. The server activates an extension only when its exact supported API
satisfies the declared range. It never guesses or coerces compatibility.

`@terminay/extension-api` is a dependency-light author SDK containing types,
runtime schemas, fixtures, and conformance tooling. Extensions use it as a
development/type dependency; the host injects privileged broker objects. An
extension cannot import `@terminay/server-core`, the workspace repository,
authentication contexts, client transports, Electron, or host bridges.

## Public extension API

The API permits an extension to:

- define redacted profile/environment types and project-environment provider
  capabilities;
- contribute declarative profile, create, browse, status, progress,
  confirmation, and lifecycle surfaces;
- receive its own namespaced configuration/data/cache directories;
- request resolution of its own profile-bound secret fields through a scoped
  broker;
- make bounded provider-dependency calls, such as Puzed asking SSH to validate
  or open an environment; and
- implement provider runtime callbacks through bounded typed IPC with
  cancellation, deadlines, and concurrency limits;
- contribute a coding-agent provider and register its provider-specific
  observation runtime;
- use a terminal-scoped, environment-routed observation broker for bounded
  process, TTY, open-file, realpath/stat/read, and append/replace evidence; and
- publish validated provider-neutral root, turn, tool, wait, model, completion,
  exit, and subagent lifecycle events to the host-owned canonical projection.

The API does not expose raw application-protocol handlers, operation policies,
workspace snapshots, arbitrary vault ids, other extension instances,
authenticated client envelopes, UI-bundle internals, terminal data outside the
broker-issued terminal scope, canonical store mutation, renderer hooks, or
native host APIs.

An agent provider declares the `agent-observation` permission and each required
environment observation capability. The permission authorizes agent-context
delivery and canonical publication; it does not grant client authority or
direct canonical-store mutation. Extensions are ordinary trusted Node.js
programs and may use public Node APIs and declared npm dependencies with the
selected server account's authority. “Public Extension API only” prohibits
imports from private Terminay packages and internal host bridges, not Node.js.

For This server, an agent extension may combine its host-issued terminal
context with Node process and filesystem APIs. For SSH and other non-local
environments, local Node APIs cannot establish remote terminal or journal
identity; the extension uses the environment-routed observation broker when
the environment advertises that capability. The host accepts canonical events
only for the terminal context it issued, but the extension process is not an
OS sandbox and the installation warning accurately describes its broader
filesystem and network authority.

Extension dependencies are distinct from npm library dependencies. Puzed
declares a compatible SSH extension dependency and calls its public provider
contract; it does not import SSH internals, duplicate its transport, or silently
install another extension without administrator confirmation.

## Declarative UI contributions

Extension code never enters the renderer. Fixed `extensions.*` and
`project-environments.*` application-protocol operations return bounded schemas
and safe status data. The server-bundled generic UI supports:

- sections and accessible disclosures;
- text, number, URL, secret, checkbox, switch, and textarea fields;
- searchable asynchronous selectors with deadlines/cancellation;
- radio-like preset cards;
- conditional visibility and disabled reasons;
- inline validation plus an error summary;
- progress stages and resumable operation status;
- ordinary and destructive confirmations; and
- guarded credential-free HTTPS links.

Icons come from a Terminay-owned allowlist. Strings render as text; raw HTML,
CSS, SVG, scripts, React components, iframes, generic routes, and arbitrary
external navigation are not supported.

The schema controls content and progressive disclosure, not visual styling.
Terminay alone maps every contribution onto its shared Settings primitives:
category headers, section labels, groups, rows, controls, compact disclosures,
validation, and action footers. Extensions cannot request grids, arbitrary card
containers, spacing, colours, or sizing. The same schema must look native to
Terminay across SSH, Puzed, third-party providers, Desktop, and browser hosts.

## Extension host and lifecycle

An enabled extension is not successfully installed merely because its package
passes a probe. After the immutable slot is committed, the Terminay Server
activates that exact slot and keeps its provider process running. On server
startup every enabled, compatible active slot is restored before provider
catalogues are served. Activation failure is represented explicitly and never
falls back to This server.

The same rule applies when the selected server reconciles release-built-ins
after startup: materializing a new enabled active slot includes bounded host
activation before reconciliation completes. The host manager publishes the new
provider ownership and contribution set only after activation succeeds. While
activation is in progress, management surfaces a pending activation state; if
it fails, it surfaces the bounded failure and offers Restart. It must not
present the extension as installed while no running host owns its declared
providers.

Terminay Server runs each enabled extension in its own child process under the
server's bundled Node runtime. The process uses a private inherited framed
channel, a minimal environment, an immutable package-slot working directory,
bounded messages, timeouts, cancellation, admission/concurrency limits, and
rate-limited restart/backoff. Credentials are absent from argv, ordinary
environment variables, logs, and inherited stdio.
When Desktop supplies Electron's executable as that bundled runtime, the child
is launched with `ELECTRON_RUN_AS_NODE=1`; extension activation must never enter
Electron application startup or create a Desktop window.
The installer passes the manifest's validated relative entrypoint unchanged to
the host; the host resolves and canonicalizes it within the immutable package
slot immediately before import.
Desktop packages the renderer-free extension child as an explicit immutable
`dist-electron/extensionHostEntry.js` executable entrypoint and passes that
regular file to the embedded server; bundled `import.meta.url` inference is not
an execution authority.
If materialization or activation fails, the selected server returns a bounded,
actionable failure message to the management UI while leaving the previous
installed version and active pointer unchanged.

Per-extension processes isolate crashes and reduce accidental cross-extension
secret sharing. They do not constitute an operating-system security sandbox;
custom extensions remain trusted code with the server account's authority.

Server startup validates registry records, built-in inventories, and manifests without executing
disabled or incompatible packages. Providers activate lazily on management,
profile, or project use. States distinguish bundled/installed, enabled/disabled,
compatible/incompatible, stopped/starting/running/failed, quarantined, and
pending update. One crash marks only that extension and its environments
unavailable. It cannot prevent This server readiness or crash another provider.

Shutdown stops new admissions, cancels bounded work, calls deactivate, then
terminates an unresponsive child. Disabling or replacing code never stops or
deletes external VMs implicitly.

## Transactional npm installation

Every server distribution includes the pinned npm installer compatible with
the repository's Node/npm versions; extension support never depends on a system
Node, npm, compiler, shell profile, or user configuration. npm runs through a
sterile Terminay-owned configuration fixed to the public npmjs registry and a
private directory under the server data root. It does not inherit the user's
`.npmrc`, tokens, workspace, lifecycle policy, or project cwd.
When the server is embedded in Desktop, the bundled npm CLI runs through the
Electron executable with `ELECTRON_RUN_AS_NODE=1`; installing an extension must
never launch another Desktop application instance or window.

Installation:

1. resolves exact package/version/integrity and fetches metadata for preview;
2. requires an authorized confirmation bound to that preview digest;
3. creates an isolated staging slot and exact lockfile;
4. rejects non-npmjs, git/file/link/remote dependencies or missing integrity;
5. materializes production dependencies with lifecycle scripts disabled,
   development dependencies omitted, and binary links disabled;
6. rejects v1 trees containing native `.node` modules, `binding.gyp`, or
   required install lifecycle scripts;
7. validates file/count/size/symlink/entrypoint/manifest/API/engine limits and
   records package-lock and inventory hashes;
8. atomically promotes an immutable content-addressed version slot;
9. probes it in a fresh extension host; and
10. changes the active pointer only after successful definition/registration.

Failure leaves the prior active version untouched. Staging is recoverably
cleaned or quarantined after interruption. Receipts record safe package,
version, registry integrity, lock/inventory hashes, npm version, permissions,
compatibility, and advisory audit/provenance status.

Registry signatures and provenance are verified and displayed when available,
but they prove package integrity/source association rather than benign code.
Vulnerability and provenance results are advisory facts, not claims of
Terminay or npm approval.

## Updates, rollback, disable, and removal

An update installs side-by-side into a new exact slot. It never mutates the
active `node_modules` or runs `npm update`. Permission expansion requires fresh
confirmation. When active environments/sessions use the provider, activation
waits for an explicit drain/restart rather than hot-swapping code beneath live
PTY or filesystem state.

The server retains at least one known-good exact slot. Rollback probes and
selects it atomically; it does not reverse external actions. Extension data is
namespaced and versioned, with a recoverable snapshot before migration. An
incompatible data rollback requires explicit restore/loss confirmation.
The active code pointer changes only after a data migration succeeds. A failed
migration restores the pre-migration namespace snapshot and leaves the old
active slot selected; restart reconciliation retains that extension and every
dependent project as explicitly failed or incompatible.

Disable preserves profiles, environment records, data, and secret references.
Uninstall is blocked while enabled, referenced by profiles/projects, required
by another extension, or in use. Code removal does not cascade-delete projects,
external resources, credentials, or provider data. An installed official
version can be disabled and retained as a rollback floor under the same
slot-retention policy as a custom extension. A release-bundled slot is an
immutable rollback floor: it can be disabled or superseded by a compatible
external slot but cannot be physically removed from that release.

## Secrets and permissions

Secret values live only in the Terminay Server vault. References are owned by
`{extensionId, profileId, fieldId/purpose}`. The extension can neither enumerate
the vault nor resolve another binding. The broker rechecks extension/profile
ownership and operation permission each time, sends only the scoped transient
copy over private IPC, and zeroizes its server-side copy afterward. UI,
snapshots, events, audit, diagnostics, errors, manifests, argv, and environment
variables contain metadata only.

Because extension code is trusted, a permitted extension can retain or
exfiltrate a secret it receives. The installation warning communicates that
truth rather than promising sandbox protection.

Transport-bound server permissions separately cover extension management,
environment/profile management and use, secret management, SSH trust override,
and provider lifecycle/destructive actions. A client-asserted id or admin scope
is never accepted. Revoking the initiating principal cancels its in-flight
administrative command before activation when possible; it does not silently
destroy shared environments.

## Extensions experience

Extensions are a first-class **Extensions** section inside **Settings**, using
the same navigation, header, spacing, controls, responsive behaviour, and
native-window chrome as every other Settings section. They are not presented
in a project-editor sheet, a bespoke full-screen modal, or a second list/detail
application nested inside Settings. Providers use ordinary Settings groups,
rows, fields, buttons, badges, and disclosure patterns. The section names
the selected Terminay Server as the authority and shows built-in SSH, Puzed,
Codex, Claude Code, Cursor Agent, Grok, and omp cards, installed and disabled states,
available explicit updates,
compatibility/failure details, permissions, dependants, and **Install from
npm…**.

**File → Extensions…** and the Command Bar action open or focus Settings at
its **Extensions** section. The project-bar environment chooser does not
duplicate that action. On Desktop this uses the established Settings auxiliary window. In a
browser it uses the established in-page Settings route and selects the same
section. Repeated invocation focuses the existing Settings presentation rather
than stacking another dialog.

Custom installation displays exact package/version, publisher/maintainers,
repository, registry integrity, provenance/audit information when available,
declared API/permissions/capabilities, dependency footprint, and this warning:

> This is third-party trusted code. It runs on the selected Terminay Server and
> can access files and networks available to that server account.

The user confirms against the named selected server. Installation and
activation progress remain resumable server operations. Actions include
enable/disable, explicit update, rollback, restart, and uninstall, with
dependants listed when an action is blocked.

Official catalogue and installed records are merged by canonical extension
identity, so one extension never appears as separate Available and Installed
cards. A successful install replaces its review panel with an explicit success
result instead of leaving the spent confirmation visible.

## Acceptance outcomes

- Extensions render as a normal Settings section in both Desktop and browser;
  no Extensions-specific modal or project-editor sheet is created.
- Every Extensions entry point focuses the same selected-server Settings
  section, and its visual/window behaviour matches the existing Settings
  experience.
- Embedded and standalone servers install and run the same extension package;
  Desktop/browser clients neither store nor execute it.
- Built-in, official, and custom packages pass the same public manifest/host
  contract; a bundled artifact has no private API access.
- A custom exact npm package installs with scripts disabled and cannot use a
  git/file/http/alias spec or native/install-dependent tree.
- Interrupted/failed update preserves the previous active version; rollback
  selects a retained exact slot.
- An extension crash is bounded and leaves This server/other providers usable.
- Incompatible or disabled provider projects remain represented and never fall
  back Local.
- Cross-extension secret resolution and provider-id collisions fail closed.
- Renderer DTOs contain no extension code, raw HTML, credentials, filesystem
  paths outside authorized presentation, or arbitrary host actions.
- A forged client identity/scope cannot install code or manage profiles; audit
  records the authenticated transport principal.
