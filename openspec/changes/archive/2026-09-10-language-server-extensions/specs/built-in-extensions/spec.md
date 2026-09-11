## ADDED Requirements

### Requirement: TypeScript language extension serves the project's TypeScript

`terminay-language-typescript` SHALL contribute a language server that serves
`.ts`, `.tsx`, `.js`, and `.jsx` files. It SHALL launch
`typescript-language-server` against the TypeScript installed in the project when
the project has one, and against the TypeScript bundled with the extension
otherwise, and SHALL report which of the two it used. Its behaviour SHALL be
proven against the real `typescript-language-server` in the package's
conformance tests rather than against a stub.

#### Scenario: Project with its own TypeScript

- **WHEN** a language session starts for a project that has TypeScript installed
- **THEN** `typescript-language-server` runs against the project's TypeScript and
  the session reports that it used the project's TypeScript

#### Scenario: Project without TypeScript

- **WHEN** a language session starts for a project with no TypeScript installed
- **THEN** the extension's bundled TypeScript is used and the session reports that
  it used the bundled TypeScript

#### Scenario: Conformance against the real language server

- **WHEN** the package's conformance tests run
- **THEN** they exercise the real `typescript-language-server` and assert
  diagnostics, completion, hover, and definition for `.ts`, `.tsx`, `.js`, and
  `.jsx` files

## MODIFIED Requirements

### Requirement: Public API boundary for built-in extensions

Terminay's official extensions SHALL live as independently publishable npm packages under the repository's top-level `extensions/` directory. Codex, Claude Code, Grok, OpenCode, omp, and TypeScript language SHALL use only the public `@terminay/extension-api`, and SHALL NOT import Server Core, Electron, renderer code, or private workspace modules. A repository boundary check SHALL fail when a built-in extension imports a private Terminay package or reaches a private source path. Public Node.js APIs and declared npm dependencies SHALL be valid extension implementation dependencies.

#### Scenario: Private import introduced

- **WHEN** a built-in extension imports a private Terminay package or reaches a private source path
- **THEN** the repository boundary check fails

#### Scenario: Permitted dependencies

- **WHEN** a built-in extension uses public Node.js APIs and its declared npm dependencies
- **THEN** the boundary check passes

### Requirement: Package identity and repository participation

Each directory below `extensions/` SHALL be one npm package with its own `package.json`, manifest, source, tests, README, licence, build output policy, and public-package conformance checks. `extensions/agent-codex` SHALL publish `terminay-agent-codex`; `extensions/agent-claude-code` SHALL publish `terminay-agent-claude-code`; `extensions/agent-grok` SHALL publish `terminay-agent-grok`; `extensions/agent-omp` SHALL publish `terminay-agent-omp`; and `extensions/language-typescript` SHALL publish `terminay-language-typescript` under the extension id `com.terminay.language.typescript`. The directories SHALL participate in the repository's npm workspace graph while remaining packable and testable as ordinary public npm projects. Their runtime dependency on `@terminay/extension-api` SHALL follow the public peer and development dependency convention. Published packages SHALL contain no workspace-relative imports or undeclared files and SHALL pass conformance against their packed tarball.

#### Scenario: Packing a built-in package

- **WHEN** a built-in extension package is packed
- **THEN** the tarball contains no workspace-relative imports or undeclared files and passes conformance

#### Scenario: Workspace participation

- **WHEN** the repository workspace graph is resolved
- **THEN** each `extensions/` package participates while remaining independently packable and testable

#### Scenario: TypeScript language package identity

- **WHEN** the TypeScript language extension is resolved
- **THEN** `extensions/language-typescript` publishes `terminay-language-typescript` under the extension id `com.terminay.language.typescript`

### Requirement: Release artifact inventory

The release build SHALL pack each built-in extension and its production dependency closure into a deterministic artifact inventory. `terminay-language-typescript` SHALL be one of the packed built-ins, and its bundled TypeScript and language server SHALL be part of its production dependency closure. The inventory SHALL record extension id, npm package name, and exact version; manifest and Extension API compatibility; package and unpacked-file digests; production dependency lock and inventory digests; permissions and contributions; and the release identity that contains the artifact.

#### Scenario: Building a release

- **WHEN** the release build packs the built-in extensions
- **THEN** the inventory records extension id, package name, exact version, manifest and API compatibility, package and unpacked-file digests, dependency lock and inventory digests, permissions and contributions, and the containing release identity

#### Scenario: TypeScript language extension in the inventory

- **WHEN** the release build packs the built-in extensions
- **THEN** `terminay-language-typescript` appears in the inventory with its bundled TypeScript and language server inside its recorded production dependency closure

### Requirement: Identical artifacts across distributions

The same inventory format and package bytes SHALL be used by the Electron and standalone Terminay Server archives, `terminay-language-typescript` included. Release assembly SHALL fail when a built-in is missing, stale, non-conformant, contains an unapproved native or lifecycle requirement, differs between server distributions, or imports a private API. No build SHALL silently fetch a built-in extension from npm.

#### Scenario: Distribution drift

- **WHEN** the built-in package bytes or inventory differ between the Electron and standalone archives
- **THEN** release assembly fails

#### Scenario: Non-conformant or stale built-in

- **WHEN** a built-in is missing, stale, non-conformant, carries an unapproved native or lifecycle requirement, or imports a private API
- **THEN** release assembly fails

#### Scenario: No implicit npm fetch

- **WHEN** a release is built
- **THEN** no built-in extension is silently fetched from npm

### Requirement: First-run materialization

On first start, the server SHALL materialize the release's verified artifacts into server-owned slots and SHALL record their origin as `built-in`. Materialization SHALL be idempotent and crash-safe. A clean Electron or standalone-server installation SHALL expose all six built-ins, `terminay-language-typescript` among them, without npm or network access.

#### Scenario: Clean installation

- **WHEN** a clean Electron or standalone server starts for the first time
- **THEN** all six built-ins, including the TypeScript language extension, are materialized from verified release artifacts without npm or network access

#### Scenario: Interrupted materialization

- **WHEN** materialization is interrupted and the server restarts
- **THEN** materialization completes idempotently without corrupt slots
