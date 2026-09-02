# git-worktrees-and-quick-push Specification

## Purpose

Terminay makes Git a project-side workflow rather than a separate terminal chore, presenting a worktree-first Git sidebar with repository state, changed files, and a Worktrees panel. Quick Push adds an optional, reviewed AI-assisted commit, push, and pull-request flow executed by the selected Terminay Server.

## Requirements

### Requirement: Explorer pane arrangement for Files and Git

Files and Git SHALL be independently collapsible panes in the Explorer sidebar group. Their vertical order within that group SHALL be user-configurable and SHALL persist for each project independently.

#### Scenario: Reordering Files and Git

- **WHEN** a user reorders the Files and Git panes within the Explorer group
- **THEN** the new order persists for that project only

#### Scenario: Collapsing a pane

- **WHEN** a user collapses Files or Git
- **THEN** the other pane remains independently expandable

### Requirement: Repository and change presentation

Git SHALL report the current repository and branch and the working-tree changes, with list and tree presentations. Selecting a change SHALL open the relevant file or diff using the file-viewer contract. When the change belongs to another listed worktree, Terminay SHALL first switch the project to that worktree so the file read remains inside the project security boundary.

#### Scenario: Selecting a change in the current worktree

- **WHEN** a user selects a changed file belonging to the current worktree
- **THEN** the relevant file or diff opens through the file-viewer contract

#### Scenario: Selecting a change in another worktree

- **WHEN** a user selects a changed file belonging to another listed worktree
- **THEN** the project switches to that worktree first
- **AND** the file is opened only after the project root change is authoritative

#### Scenario: List and tree presentations

- **WHEN** a user switches between list and tree presentation
- **THEN** the same working-tree changes are shown in the selected presentation

### Requirement: Git tree filesystem interactions

Changed-file rows and their synthetic folder rows SHALL follow the Explorer's filesystem interaction contract. Double-clicking a file SHALL open its file panel, using Diff mode when Git can provide it, while double-clicking a folder SHALL open its Folder panel. A folder's single-click disclosure control SHALL continue to collapse or expand the Git tree. Context menus SHALL expose the same applicable create, rename, delete, copy-path, shell, and OS-reveal actions as Explorer entries, with folder-only actions omitted for files, and every action SHALL remain scoped to the worktree or project that owns the selected path.

#### Scenario: Double-clicking a changed file

- **WHEN** a user double-clicks a changed file row
- **THEN** its file panel opens in Diff mode when Git can provide a diff

#### Scenario: Double-clicking a Git tree folder

- **WHEN** a user double-clicks a synthetic folder row
- **THEN** one Folder panel opens and the folder is not left in an unintended disclosure state

#### Scenario: Disclosure control

- **WHEN** a user single-clicks a folder's disclosure control
- **THEN** the Git tree collapses or expands at that folder

#### Scenario: Context menu parity

- **WHEN** a user opens the context menu on a Git tree file or folder
- **THEN** the same applicable Explorer actions are offered, with folder-only actions omitted for files

### Requirement: Cross-worktree mutations switch the project root first

Create, rename, and delete initiated from another listed worktree SHALL switch the project to that worktree first and SHALL wait until the new root is authoritative. They SHALL NOT relativize the selected path against the former project root into a traversal request.

#### Scenario: Creating in another worktree

- **WHEN** a user creates, renames, or deletes a file or folder from another listed worktree's Git tree
- **THEN** the project switches to that worktree and the mutation runs only after the project root change is authoritative

#### Scenario: No path traversal

- **WHEN** a cross-worktree mutation is prepared
- **THEN** the selected path is not relativized against the former project root into a traversal request

### Requirement: Worktrees panel actions

The Worktrees panel SHALL show known worktrees and their state. Users SHALL be able to open a terminal at a worktree, switch the project root, copy or reveal its path, rename its presentation, remove a worktree, and pull a worktree from origin when Git permits it. Worktree rows SHALL stay visually quiet on hover while the Quick Push control still highlights. Changed-file and folder rows SHALL keep the Explorer hover highlight.

#### Scenario: Worktree actions available

- **WHEN** a user acts on a worktree row
- **THEN** open-terminal, switch-project-root, copy-path, reveal, presentation-rename, remove, and pull are available where Git permits them

#### Scenario: Hover presentation

- **WHEN** the pointer hovers a worktree row
- **THEN** the row stays visually quiet while the Quick Push control highlights

#### Scenario: Switching the project root refreshes Git

- **WHEN** a user switches the project root while an earlier Git status request is still pending
- **THEN** the Git sidebar immediately refreshes for the new root

### Requirement: Effective worktree cleanliness

A worktree SHALL be shown as clean only when it has no effective committed changes relative to the repository default branch and no displayed working-tree delta. Commit ancestry alone SHALL be insufficient: a squash-merged branch whose resulting tree is already present on the default branch SHALL be clean, while a clean working directory with unmerged committed changes SHALL NOT be clean.

#### Scenario: Squash-merged branch

- **WHEN** a worktree's branch was squash-merged and its resulting tree is already present on the default branch
- **THEN** the worktree is shown as clean

#### Scenario: Unmerged committed changes

- **WHEN** a worktree has a clean working directory but committed changes not present on the default branch
- **THEN** the worktree is not shown as clean

### Requirement: Git constraints are reported, not guessed

Operations SHALL make Git's constraints visible: detached heads, missing gitfiles, unmerged changes, absent remotes, and failed commands SHALL be reported rather than guessed around. Removing a worktree SHALL NOT target the main worktree.

#### Scenario: Constraint encountered

- **WHEN** a Git operation encounters a detached head, missing gitfile, unmerged change, absent remote, or command failure
- **THEN** the condition is reported accurately

#### Scenario: Main worktree protected

- **WHEN** a removal request would target the main worktree
- **THEN** the removal is rejected

### Requirement: Quick Push reviewed flow

Quick Push SHALL be an optional AI-assisted Git workflow, not autonomous source control. The user SHALL choose a configured Codex or Claude Code provider and start the flow from the relevant Git UI. Terminay SHALL gather bounded repository status, diff, and commit context using the user's shell environment; the provider SHALL return a structured commit plan for user review; the user SHALL choose a branch target and confirm the proposed actions; and Terminay SHALL then create the requested commits, push them, and MAY create a provider-aware pull request on GitHub or Gitea when the repository supports it.

#### Scenario: Reviewable plan before mutation

- **WHEN** a user starts Quick Push
- **THEN** a structured commit plan is presented for review before any commit, push, or pull-request creation

#### Scenario: Confirmation required

- **WHEN** the user has not chosen a branch target and confirmed the proposed actions
- **THEN** no commits, pushes, or pull requests are created

#### Scenario: Pull request creation

- **WHEN** the repository is hosted on GitHub or Gitea and supports it
- **THEN** Quick Push can create a provider-aware pull request after confirmation

#### Scenario: Quick Push unavailable without a provider

- **WHEN** no Codex or Claude Code provider has been deliberately configured
- **THEN** Quick Push is unavailable

### Requirement: Push target grouping and history safety

Push targets SHALL be grouped by branch intent, including safe handling for the repository default branch. Terminay SHALL skip already-applied commits where that is the explicitly selected default-branch workflow, and SHALL NOT silently rebase or rewrite history.

#### Scenario: Default-branch workflow

- **WHEN** the explicitly selected default-branch workflow applies and some commits are already applied
- **THEN** those commits are skipped

#### Scenario: No silent history rewriting

- **WHEN** Quick Push executes an approved plan
- **THEN** it never silently rebases or rewrites history

### Requirement: Quick Push coordinator identity binding

The server-side Quick Push coordinator SHALL give the configured provider only a bounded status and diff context and SHALL accept a bounded, ordered action plan. The review response SHALL carry the canonical project, repository, and worktree IDs, the observed branch, HEAD, and status digest, and an action digest. Approval SHALL be single-use, SHALL expire, and SHALL be rejected when any of those values no longer match.

#### Scenario: Approval reused

- **WHEN** an approval is submitted a second time
- **THEN** it is rejected

#### Scenario: Approval expired or mismatched

- **WHEN** an approval has expired, or the project, repository, worktree, branch, HEAD, status digest, or action digest no longer matches
- **THEN** the approval is rejected

### Requirement: Per-action revalidation and bounded provider execution

Before each injected server-side Git or provider executor action, the coordinator SHALL capture status again; a changed revision SHALL produce a deterministic partial failure instead of silently continuing. Provider planning and execution callbacks SHALL run in the server environment, SHALL receive a linked cancellation signal, and SHALL be bounded by server-side deadlines. Provider output returned to the proposal or action result SHALL be bounded and redacted so credentials never enter the proposal or protocol response.

#### Scenario: Repository changes mid-execution

- **WHEN** repository status changes between two actions of an approved plan
- **THEN** execution produces a deterministic partial failure rather than continuing silently

#### Scenario: Cancellation during planning or execution

- **WHEN** a Quick Push request is cancelled
- **THEN** provider planning and execution callbacks receive the linked cancellation signal

#### Scenario: Provider output redaction

- **WHEN** provider output is returned in a proposal or action result
- **THEN** it is bounded and redacted and contains no credentials

### Requirement: Quick Push runs through the server Git client

There SHALL be no Electron Quick Push service or renderer host client. Proposal and approval SHALL always use the selected server's canonical Git application client.

#### Scenario: Proposal and approval routing

- **WHEN** a client proposes or approves a Quick Push plan
- **THEN** the request goes through the selected server's canonical Git application client rather than an Electron or renderer host service

### Requirement: Git execution safety and environment boundary

Git commands SHALL run through the exact project's declared environment Git capability, authorized by Terminay Server and never in the client. **This server** SHALL use its native Git service; remote providers SHALL supply their own bounded runner and path adapter or Git SHALL be unavailable. A remote-looking path SHALL NOT be passed to local Git. Quick Push SHALL send only the bounded context needed to the selected provider, SHALL require explicit user confirmation before mutation, and SHALL report the exact failed Git or remote step. Credentials SHALL remain within the exact environment's bounded Git, SSH, or CLI runner or its scoped server vault references, and SHALL NOT be copied into renderer state or generic Terminay settings.

#### Scenario: Remote project environment without a Git runner

- **WHEN** a project's environment provider supplies no bounded Git runner and path adapter
- **THEN** Git is reported as unavailable rather than run locally

#### Scenario: Remote-looking path

- **WHEN** a path belonging to a remote environment is encountered
- **THEN** it is never passed to local Git

#### Scenario: Failed step reporting

- **WHEN** a Git or remote step of a Quick Push plan fails
- **THEN** the exact failed step is reported

#### Scenario: Credential containment

- **WHEN** Git or provider credentials are used
- **THEN** they stay in the environment's bounded runner or scoped server vault references and never enter renderer state or generic Terminay settings

### Requirement: Server-routed Git ownership

Git, worktree, provider CLI, and Quick Push execution SHALL be routed by the selected Terminay Server to the project environment under server-owned workspace state. Local and remote clients SHALL submit the same scoped commands. Review and confirmation SHALL remain a client interaction, while the server SHALL revalidate repository state and authorization immediately before every mutation.

#### Scenario: Local and remote clients submit identical commands

- **WHEN** a local client and a remote client perform the same Git action
- **THEN** both submit the same scoped commands to the selected server

#### Scenario: Revalidation before mutation

- **WHEN** the server is about to perform a Git mutation
- **THEN** it revalidates repository state and authorization immediately beforehand

### Requirement: Identity-bound read-only Git queries

Read-only repository queries SHALL be bound to the canonical project, repository, and worktree identities held by the selected server. Status, branch, worktree, and diff responses SHALL be bounded and SHALL report detached heads, missing Git metadata, absent repositories or remotes, unmerged entries, and command failures as structured state. A client SHALL NOT substitute an arbitrary path or command working directory.

#### Scenario: Client supplies an arbitrary path

- **WHEN** a client submits an arbitrary path or command working directory in a Git query
- **THEN** the server uses its canonical identities instead and does not honour the supplied path

#### Scenario: Structured Git state

- **WHEN** a repository has a detached head, missing Git metadata, no repository or remote, or unmerged entries
- **THEN** the query response reports that as structured state

### Requirement: Git protocol adapter operations

The server Git protocol adapter SHALL expose stable, project-scoped operations for listing and removing worktrees plus host-gated open-terminal, switch-project, presentation-rename, reveal, and copy actions. Requests SHALL carry only canonical repository and worktree IDs; host callbacks SHALL receive those opaque IDs and SHALL fail closed when a capability is unavailable. Quick Push proposals SHALL resolve an omitted target branch from the server's canonical default-branch listing, and the adapter SHALL bind the resulting proposal to the authorized project before approval.

#### Scenario: Host capability unavailable

- **WHEN** a host-gated action is requested and the host does not advertise that capability
- **THEN** the operation fails closed

#### Scenario: Omitted target branch

- **WHEN** a Quick Push proposal omits a target branch
- **THEN** the server resolves it from its canonical default-branch listing

#### Scenario: Opaque identifiers only

- **WHEN** a worktree action is submitted
- **THEN** it carries only canonical repository and worktree IDs and host callbacks receive those opaque IDs

### Requirement: Git progress and status-change events

Authorized clients SHALL receive bounded, ordered Git progress and status-change metadata. `git.progress` SHALL indicate the start, completion, or failure of a read-only operation without command output. `git.status.changed` SHALL carry only the canonical project, repository, and worktree IDs, branch and head, state, changed-file count, and a bounded flag. Clients SHALL advance the shared revision for events from other projects without retaining their status, and a revision gap SHALL require a fresh status query rather than a locally invented transition.

#### Scenario: Progress event content

- **WHEN** a read-only Git operation starts, completes, or fails
- **THEN** `git.progress` reports it without command output

#### Scenario: Event for another project

- **WHEN** a `git.status.changed` event arrives for another project
- **THEN** the client advances the shared revision without retaining that project's status

#### Scenario: Revision gap

- **WHEN** a client detects a revision gap
- **THEN** it issues a fresh status query rather than inventing a transition locally

### Requirement: Server-owned worktree removal

Worktree removal SHALL be server-owned and identity-bound. The client SHALL submit only the project, repository, and opaque worktree IDs, optionally the full HEAD it reviewed. The server SHALL obtain the canonical path from a fresh bounded worktree listing, recheck status immediately before invoking Git, and then verify that the exact identity disappeared. If the registered worktree path has already disappeared and Git marks the entry prunable, removal SHALL clean up that stale registration without trying to run status inside the missing path. Main, bare, and locked worktrees SHALL be rejected, and a changed reviewed HEAD SHALL be reported as stale rather than removed.

#### Scenario: Removal by identity

- **WHEN** a client requests removal with project, repository, and opaque worktree IDs
- **THEN** the server resolves the canonical path from a fresh bounded listing, rechecks status, invokes Git, and verifies the exact identity disappeared

#### Scenario: Prunable stale registration

- **WHEN** the registered worktree path is already absent and Git marks the entry prunable
- **THEN** the stale registration is cleaned up without running status inside the missing path
- **AND** no worktree-list or status error is reported

#### Scenario: Protected worktree kinds

- **WHEN** removal targets a main, bare, or locked worktree
- **THEN** the request is rejected

#### Scenario: Stale reviewed HEAD

- **WHEN** the reviewed HEAD no longer matches
- **THEN** the removal is reported as stale rather than performed

### Requirement: Destructive removal confirmation and serialization

The removal confirmation SHALL explicitly warn that the worktree folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted. Once the user confirms, the server SHALL use Git's forced worktree removal so those visible changes do not block the action. Confirmed deletions for one repository SHALL run one at a time.

#### Scenario: Confirmation warning

- **WHEN** a user is asked to confirm worktree removal
- **THEN** the confirmation states that the folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted

#### Scenario: Dirty worktree removal

- **WHEN** the user confirms removal of a dirty or unmerged worktree
- **THEN** forced removal deletes it, including its uncommitted and untracked files

#### Scenario: Concurrent confirmed deletions

- **WHEN** two confirmed deletions for one repository are requested
- **THEN** they complete one at a time and a successful delete is not reported as Git unavailable

### Requirement: Bounded Git query results

List and status query results SHALL stay within protocol header limits. Extra changed-file rows SHALL be omitted and `bounded` SHALL be true rather than failing Git. A successful deletion SHALL NOT be reported as Git unavailable because a later listing was large or racy.

#### Scenario: Oversized change list

- **WHEN** a status or list result would exceed protocol header limits
- **THEN** extra changed-file rows are omitted and `bounded` is true

#### Scenario: Large listing after a delete

- **WHEN** a listing following a successful deletion is large or racy
- **THEN** the deletion is still reported as successful

### Requirement: Shared Git route presentation

The production shared Git route SHALL consume `TerminayGitClient` for its current server-owned project. It SHALL render bounded worktree state and SHALL expose Pull, explicitly confirmed removal, and a two-step Quick Push proposal and approval review. Native terminal opening SHALL be rendered only when the host advertises that capability.

#### Scenario: Native terminal capability absent

- **WHEN** the host does not advertise native terminal opening
- **THEN** the shared Git route does not render that action

#### Scenario: Two-step Quick Push review

- **WHEN** a user runs Quick Push from the shared Git route
- **THEN** the route presents a proposal step and a separate approval step

### Requirement: Git and Quick Push acceptance outcomes

The current project SHALL show the correct repository and worktree state without confusing it with another project or window.

#### Scenario: Multiple projects open

- **WHEN** several projects or windows are open
- **THEN** each shows its own repository and worktree state
