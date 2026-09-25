## MODIFIED Requirements

### Requirement: Bounded API scope

The public API SHALL support the capabilities needed by the official Codex,
Claude Code, Grok, OpenCode, and omp agent extensions, the official language
server extensions, and the official worktree insight extensions. Themes, editor
plugins, autocomplete sources, arbitrary commands, renderer components, and
generic Server Core operation registration SHALL be out of scope.

#### Scenario: Unsupported contribution kind

- **WHEN** a package declares a theme, editor plugin, autocomplete source,
  arbitrary command, renderer component, or generic Server Core operation
- **THEN** the contribution is not supported and validation rejects it

#### Scenario: Language server contribution

- **WHEN** a package declares a language server contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Worktree insight contribution

- **WHEN** a package declares a worktree insight contribution
- **THEN** it is a supported contribution kind and validation accepts it

### Requirement: Contribution arrays

`contributes.agentProviders`, `contributes.languageServers`, and
`contributes.worktreeInsights` SHALL be the supported contribution arrays, and
at least one supported contribution SHALL be required.

#### Scenario: Agent-only package

- **WHEN** a package contributes one or more agent providers
- **THEN** it passes contribution validation

#### Scenario: No contributions

- **WHEN** a package declares no contribution array
- **THEN** validation fails

#### Scenario: Language-server-only package

- **WHEN** a package contributes one or more language servers and no agent
  provider
- **THEN** it passes contribution validation

#### Scenario: Worktree-insight-only package

- **WHEN** a package contributes one or more worktree insight sources and nothing
  else
- **THEN** it passes contribution validation

## ADDED Requirements

### Requirement: Worktree observation permission

A worktree insight source SHALL declare the `worktree-observation` permission.
The permission SHALL authorize receiving host-issued repository contexts and
publishing worktree properties and sign-in requests for them, and MUST NOT grant
client authority, workspace navigation, or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** an extension registers a worktree insight source without declaring
  `worktree-observation`
- **THEN** the registration is refused

### Requirement: Host-issued repository context

For each open project whose root is a Git repository, Terminay SHALL issue each
registered worktree insight source a repository context containing the
repository root, its remotes with names and URLs, its worktrees with an
opaque worktree id, path, branch, upstream, and head commit, and whether a
client has the project active. Terminay SHALL re-issue the context when the
worktree set, any worktree's branch, upstream, or head, or the project's
activity changes, and SHALL cancel the context when the project closes, the
extension is disabled, or its host fails. Terminay SHALL accept worktree
properties only for worktree ids in a context it has issued and not cancelled.

#### Scenario: Project opened

- **WHEN** a project whose root is a Git repository is opened
- **THEN** each registered worktree insight source receives its repository
  context

#### Scenario: Branch pushed

- **WHEN** a push updates a worktree's upstream ref
- **THEN** the repository context is re-issued with the new upstream and head

#### Scenario: Publication for an unissued worktree

- **WHEN** an extension publishes properties for a worktree id outside any
  context issued to it
- **THEN** the publication is rejected

#### Scenario: Project closed

- **WHEN** the last client closes a project
- **THEN** its repository context's cancellation signal fires

### Requirement: Sign-in requests and per-origin credentials

A worktree insight source SHALL be able to request sign-in for an HTTPS origin,
supplying a provider name and an optional guarded token-page link, and SHALL be
able to resolve the credential stored for that origin through the scoped vault
broker. Vault bindings for sign-in SHALL be owned by the extension and the
origin; an extension MUST NOT resolve a binding owned by another extension. An
extension SHALL be able to report that a stored credential was rejected, which
removes the binding and permits a new sign-in request.

#### Scenario: Resolving an own-origin credential

- **WHEN** an extension resolves the credential it holds for an origin
- **THEN** it receives a transient copy through the scoped vault broker

#### Scenario: Rejected credential

- **WHEN** an extension reports that the stored credential for an origin was
  rejected by that origin
- **THEN** the binding is removed and a new sign-in prompt may be shown
