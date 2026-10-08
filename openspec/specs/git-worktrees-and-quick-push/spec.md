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

Create, rename, and delete initiated from another listed worktree SHALL switch
the project to that worktree first and SHALL wait until the new root is
authoritative. They SHALL NOT relativize the selected path against the former
project root into a traversal request. Once the mutation settles, whether it
succeeded or failed, the project root SHALL return to the root the user was on.
Opening an entry from another worktree is navigation and SHALL leave the project
on that worktree.

#### Scenario: Creating in another worktree

- **WHEN** a user creates, renames, or deletes a file or folder from another
  listed worktree's Git tree
- **THEN** the project switches to that worktree and the mutation runs only
  after the project root change is authoritative

#### Scenario: The project root is handed back

- **WHEN** a cross-worktree create, rename, or delete settles
- **THEN** the project root returns to the root the user was on before the
  mutation, whether the mutation succeeded or failed

#### Scenario: Opening stays in the worktree

- **WHEN** a user opens an entry from another listed worktree's Git tree
- **THEN** the project stays on that worktree

#### Scenario: No path traversal

- **WHEN** a cross-worktree mutation is prepared
- **THEN** the selected path is not relativized against the former project root
  into a traversal request

### Requirement: Worktrees panel actions

The Worktrees panel SHALL show known worktrees and their state in two-line rows: the worktree's name at full width with its actions button, then its change size and, when any worktree has worktree properties, its pull request and checks in slots aligned from row to row. Selecting a row SHALL expand or collapse its changed files, with the row's disclosure chevron showing which. Activating a row's checks indicator SHALL separately show or hide its branch, pull request, and checks. Each row SHALL have an actions button that opens the same worktree actions as its context menu. Users SHALL be able to commit and push with an AI agent, open a terminal at a worktree, switch the project root, copy or reveal its path, rename its presentation, remove a worktree, and pull a worktree from origin when Git permits it. Worktree rows SHALL stay visually quiet on hover while the actions button still highlights. Changed-file and folder rows SHALL keep the Explorer hover highlight.

#### Scenario: Worktree actions available

- **WHEN** a user opens a worktree row's actions button or context menu
- **THEN** commit-and-push, open-terminal, switch-project-root, copy-path, reveal, presentation-rename, remove, and pull are available where Git permits them

#### Scenario: Hover presentation

- **WHEN** the pointer hovers a worktree row
- **THEN** the row stays visually quiet while the actions button highlights

#### Scenario: Expanding a row

- **WHEN** a user selects a collapsed worktree row
- **THEN** the row expands to show its changed files, and its checks stay as they were

#### Scenario: Showing checks

- **WHEN** a user activates a worktree's checks indicator
- **THEN** its branch, pull request, and checks are shown, independently of its changed files

#### Scenario: Repository without worktree properties

- **WHEN** no worktree in the repository has worktree properties
- **THEN** rows show only the name and change size

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

### Requirement: Server-routed Git ownership

Git, worktree, provider CLI, and Quick Push execution SHALL be performed by the selected Terminay Server under server-owned workspace state. Local and remote clients SHALL submit the same scoped commands. Review and confirmation SHALL remain a client interaction, while the server SHALL revalidate repository state and authorization immediately before every mutation.

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

The server Git protocol adapter SHALL expose stable, project-scoped operations for listing and removing worktrees, including clean-only removal as an operation distinct from forced removal, plus host-gated open-terminal, switch-project, presentation-rename, reveal, and copy actions. Requests SHALL carry only canonical repository and worktree IDs; host callbacks SHALL receive those opaque IDs and SHALL fail closed when a capability is unavailable. A server that does not implement clean-only removal SHALL fail the request rather than perform a forced removal. Quick Push proposals SHALL resolve an omitted target branch from the server's canonical default-branch listing, and the adapter SHALL bind the resulting proposal to the authorized project before approval.

#### Scenario: Host capability unavailable

- **WHEN** a host-gated action is requested and the host does not advertise that capability
- **THEN** the operation fails closed

#### Scenario: Omitted target branch

- **WHEN** a Quick Push proposal omits a target branch
- **THEN** the server resolves it from its canonical default-branch listing

#### Scenario: Opaque identifiers only

- **WHEN** a worktree action is submitted
- **THEN** it carries only canonical repository and worktree IDs and host callbacks receive those opaque IDs

#### Scenario: Clean-only removal is not forced removal

- **WHEN** a client submits a clean-only removal
- **THEN** it is routed to the clean-only operation and never to forced removal
- **AND** a server without that operation rejects the request and removes nothing

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

Worktree removal SHALL be server-owned and identity-bound. The client SHALL submit only the project, repository, and opaque worktree IDs, optionally the full HEAD it reviewed. The server SHALL obtain the canonical path from a fresh bounded worktree listing, recheck status immediately before invoking Git, and then verify that the exact identity disappeared. A linked worktree SHALL be prunable when Git marks it prunable, or when it is locked and its `.git` no longer exists. Removing a prunable worktree SHALL remove only that worktree's registration, without running status inside its path, without changing anything at its path, and without removing any other registration. Main and bare worktrees SHALL be rejected. A Git lock on a linked worktree SHALL NOT prevent confirmed removal. A changed reviewed HEAD SHALL be reported as stale rather than removed.

#### Scenario: Removal by identity

- **WHEN** a client requests removal with project, repository, and opaque worktree IDs
- **THEN** the server resolves the canonical path from a fresh bounded listing, rechecks status, invokes Git, and verifies the exact identity disappeared

#### Scenario: Prunable stale registration

- **WHEN** the registered worktree path is already absent and Git marks the entry prunable
- **THEN** the stale registration is cleaned up without running status inside the missing path
- **AND** no worktree-list or status error is reported

#### Scenario: Locked worktree whose folder was removed

- **WHEN** a locked linked worktree's folder, or a folder containing it, has been removed
- **THEN** the listing reports it prunable
- **AND** confirmed removal removes its registration and keeps its branch

#### Scenario: Path no longer holds the worktree

- **WHEN** a linked worktree's `.git` file was removed, its folder emptied, or its path replaced by a file
- **THEN** confirmed removal removes its registration
- **AND** whatever remains at the path is left untouched

#### Scenario: Other stale registrations

- **WHEN** a prunable worktree is removed while another registration is also stale
- **THEN** the other registration remains listed

#### Scenario: Protected worktree kinds

- **WHEN** removal targets a main or bare worktree
- **THEN** the request is rejected

#### Scenario: Locked linked worktree

- **WHEN** the user confirms removal of a linked worktree that Git reports as locked
- **THEN** the server removes it
- **AND** the worktree identity is no longer listed

#### Scenario: Stale reviewed HEAD

- **WHEN** the reviewed HEAD no longer matches
- **THEN** the removal is reported as stale rather than performed

### Requirement: Destructive removal confirmation and serialization

The removal confirmation SHALL explicitly warn that the worktree folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted. For a prunable worktree the confirmation SHALL instead state that its working tree is already gone and nothing on disk is deleted. Once the user confirms, the server SHALL use Git's forced worktree removal so those visible changes and a Git lock do not block the action. Confirmed deletions for one repository SHALL run one at a time.

#### Scenario: Confirmation warning

- **WHEN** a user is asked to confirm worktree removal
- **THEN** the confirmation states that the folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted

#### Scenario: Prunable worktree confirmation

- **WHEN** a user is asked to confirm removal of a prunable worktree
- **THEN** the confirmation states that nothing on disk is deleted

#### Scenario: Dirty worktree removal

- **WHEN** the user confirms removal of a dirty or unmerged worktree
- **THEN** forced removal deletes it, including its uncommitted and untracked files

#### Scenario: Locked dirty worktree removal

- **WHEN** the user confirms removal of a locked worktree that also has uncommitted or untracked files
- **THEN** forced removal deletes it, including those files

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

### Requirement: Git execution safety and server boundary

Git commands SHALL run through the server's native Git service, authorized by Terminay Server and never in the client. Quick Push SHALL send only the bounded context needed to the selected provider, SHALL require explicit user confirmation before mutation, and SHALL report the exact failed Git step. Credentials SHALL remain within the server's bounded Git or CLI runner or its scoped server vault references, and SHALL NOT be copied into renderer state or generic Terminay settings.

#### Scenario: Git runs on the server

- **WHEN** a Git command is issued for a project
- **THEN** it runs through the native Git service of the server that owns the project, authorized by Terminay Server and never in the client

#### Scenario: Failed step reporting

- **WHEN** a Git step of a Quick Push plan fails
- **THEN** the exact failed step is reported

#### Scenario: Credential containment

- **WHEN** Git or provider credentials are used
- **THEN** they stay in the server's bounded runner or scoped server vault references and never enter renderer state or generic Terminay settings

### Requirement: Server-owned worktree pull

Pulling a worktree SHALL be server-owned and identity-bound, and SHALL
fast-forward only. The server SHALL resolve the branch to pull from the
worktree's configured upstream. When the branch has no configured upstream, the
server SHALL fast-forward from the branch of the same name on the repository's
remote when exactly one such remote branch exists, and SHALL report an absent
remote otherwise. A pull the server does not apply SHALL carry the Git failure
that prevented it.

#### Scenario: Configured upstream

- **WHEN** a clean, attached worktree whose branch has a configured upstream is pulled
- **THEN** the server fast-forwards the worktree from that upstream

#### Scenario: Branch without a configured upstream

- **WHEN** a clean, attached worktree is pulled whose branch has no configured upstream but whose name matches a branch on the repository's remote
- **THEN** the server fast-forwards the worktree from that remote branch

#### Scenario: No matching remote branch

- **WHEN** a worktree is pulled whose branch has neither a configured upstream nor a matching remote branch
- **THEN** the pull is not applied
- **AND** the result reports that the remote branch is absent

#### Scenario: Failed pull carries its cause

- **WHEN** Git refuses or fails the pull
- **THEN** the result is not applied and carries the Git failure message

### Requirement: Worktree pull feedback

A worktree pull SHALL be visible while it runs and SHALL never fail silently.
The Worktrees panel SHALL mark a worktree as pulling from the moment the pull
starts until the server answers, and SHALL NOT start a second pull for a
worktree that is already pulling. A pull the server does not apply SHALL be
reported to the user with the server's failure message.

#### Scenario: Pull in progress

- **WHEN** a user pulls a worktree from origin
- **THEN** that worktree row shows it is pulling until the server answers

#### Scenario: Pull is not started twice

- **WHEN** a worktree is already pulling
- **THEN** its pull action is unavailable

#### Scenario: Pull failure is reported

- **WHEN** the server answers a pull with a result it did not apply
- **THEN** the failure is reported to the user with the server's message

#### Scenario: Pull success clears the Git failure

- **WHEN** the server applies a pull
- **THEN** no Git failure is displayed and the worktree row stops showing it is pulling

### Requirement: Changed paths carry their directory state

A Git change SHALL carry whether its path is a directory, including a symlink
that resolves to one, decided on the server from the filesystem. A changed
directory SHALL present as a folder in the Git tree: a folder icon, the folder
context menu, and the Folder panel on open, rather than a file row that offers a
diff.

#### Scenario: A worktree's linked dependencies directory

- **WHEN** a worktree's `node_modules` is a symlink to another checkout and Git
  reports it as untracked
- **THEN** the Git tree shows it as a folder with the folder context menu

#### Scenario: A changed file stays a file

- **WHEN** a changed path is an ordinary file
- **THEN** the row keeps the file presentation and its diff action

### Requirement: Git pane menu

The Git pane header SHALL present a pane menu button at its trailing edge. Activating it SHALL open a menu of actions that apply to the repository's worktrees as a whole. The menu SHALL offer "Delete all clean worktrees". The button SHALL be operable by keyboard and SHALL carry an accessible name.

#### Scenario: Opening the pane menu

- **WHEN** a user activates the pane menu button in the Git pane header
- **THEN** a menu opens anchored to the button
- **AND** it offers "Delete all clean worktrees"

#### Scenario: No eligible worktrees

- **WHEN** the pane menu opens and no worktree is eligible for bulk deletion
- **THEN** "Delete all clean worktrees" is shown disabled

#### Scenario: Activating the button does not collapse the pane

- **WHEN** a user activates the pane menu button
- **THEN** the Git pane keeps its collapsed or expanded state

### Requirement: Bulk deletion of clean worktrees

"Delete all clean worktrees" SHALL target every worktree that is shown as clean under the effective-cleanliness contract, excluding the main worktree, bare worktrees, the project's current worktree, prunable worktrees, and worktrees with a deletion or pull in progress. Before removing anything, Terminay SHALL ask for one confirmation that states how many worktrees will be deleted and names each of them. Declining SHALL remove nothing. Branches SHALL NOT be deleted.

#### Scenario: Confirmation names the targets

- **WHEN** a user chooses "Delete all clean worktrees" with three eligible worktrees
- **THEN** one confirmation states that three worktrees will be deleted and names each one
- **AND** no removal has been requested yet

#### Scenario: Declining the confirmation

- **WHEN** the user declines the confirmation
- **THEN** no worktree is removed

#### Scenario: Changed worktrees are left alone

- **WHEN** the listing contains worktrees with working-tree changes or unmerged committed changes
- **THEN** they are not named in the confirmation and are not removed

#### Scenario: Protected worktrees are left alone

- **WHEN** the main worktree or the project's current worktree is shown as clean
- **THEN** it is not named in the confirmation and is not removed

#### Scenario: Branches survive

- **WHEN** a clean worktree is removed by the bulk action
- **THEN** its branch still exists in the repository

### Requirement: Bulk deletion progress and outcome

Confirmed bulk deletions SHALL run one at a time through the same per-repository serialization as single removals, and each targeted row SHALL show that it is being deleted until its removal settles. A refusal or failure for one worktree SHALL NOT stop the remaining removals. When the batch settles, Terminay SHALL report how many worktrees were deleted and SHALL name each worktree that was not deleted together with the reason.

#### Scenario: Rows show progress

- **WHEN** a confirmed bulk deletion is running
- **THEN** each targeted worktree row shows a deleting state until its own removal settles

#### Scenario: One refusal does not stop the batch

- **WHEN** the server refuses one targeted worktree because it is no longer clean
- **THEN** the remaining targeted worktrees are still removed
- **AND** the outcome names the refused worktree and states that it has changes

#### Scenario: Everything removed

- **WHEN** every targeted worktree is removed
- **THEN** the outcome reports the number deleted and the rows are gone from the panel

### Requirement: Server-owned clean-only worktree removal

The server SHALL offer a clean-only worktree removal that is identity-bound in the same way as forced removal and SHALL require the full HEAD the client reviewed. The server SHALL obtain the canonical path from a fresh bounded worktree listing and, immediately before invoking Git, SHALL recompute effective cleanliness: no working-tree entries, including untracked files, and no effective committed changes relative to the repository default branch. A worktree that is not clean SHALL be refused with a structured not-clean result and SHALL be left untouched. A changed HEAD SHALL be reported as stale. Main, bare, and prunable worktrees SHALL be rejected. The server SHALL invoke Git's unforced worktree removal, so Git's own refusal of a modified worktree remains in effect, and SHALL verify that the exact identity disappeared.

#### Scenario: Clean worktree removed

- **WHEN** a client requests clean-only removal of a linked worktree that is still clean at the reviewed HEAD
- **THEN** the server removes it without forcing and verifies the identity is no longer listed

#### Scenario: Worktree gained an untracked file after the listing

- **WHEN** a file is created in the worktree after the client's listing and before the server's recheck
- **THEN** the removal is refused as not clean
- **AND** the worktree folder and the new file still exist

#### Scenario: Worktree gained an unmerged commit after the listing

- **WHEN** the worktree's HEAD no longer matches the reviewed HEAD
- **THEN** the removal is reported as stale rather than performed

#### Scenario: Reviewed HEAD omitted

- **WHEN** a clean-only removal request carries no reviewed HEAD
- **THEN** the request is rejected

#### Scenario: Locked worktree

- **WHEN** clean-only removal targets a clean worktree that Git reports as locked
- **THEN** the server lifts the lock and removes it without forcing

#### Scenario: Read-only authorization

- **WHEN** a client without write scope requests clean-only removal
- **THEN** the request is rejected

### Requirement: Worktree rows show worktree properties

Each Worktrees panel row SHALL show the worktree properties published for that
worktree, as defined by the `worktree-properties` capability, in its pull
request and checks columns alongside its change summary. Showing them SHALL NOT change the row's
existing actions, hover behaviour, or change summary.

#### Scenario: Row with properties

- **WHEN** a worktree has a pull request and checks published for it
- **THEN** its row shows the pull request number and a checks indicator
  alongside its change summary

#### Scenario: Existing actions unaffected

- **WHEN** a worktree row shows properties
- **THEN** commit-and-push, open-terminal, switch-project-root, copy-path,
  reveal, presentation-rename, remove, and pull remain available where Git
  permits them

### Requirement: Worktree reveal runs on the server host

The server SHALL reveal a worktree in the operating system's file manager on its
own host, resolving the worktree's path from opaque repository and worktree IDs.
Each worktree listing SHALL state whether reveal is available to the requesting
client, and it SHALL be available only to clients the server accepted as its own
host's windows. Clients SHALL offer a worktree reveal action only when the
listing says it is available.

#### Scenario: Desktop window on the embedded server

- **WHEN** a Desktop window connected to its embedded server opens a worktree's
  actions
- **THEN** **Reveal in OS** is offered
- **AND** choosing it shows the worktree in the host's file manager

#### Scenario: Browser or remote client

- **WHEN** a browser, remote, or paired client lists worktrees
- **THEN** the listing reports reveal as unavailable and the client omits
  **Reveal in OS**
- **AND** a reveal request from that client is refused without touching the
  host's file manager

#### Scenario: Reveal fails

- **WHEN** the server cannot reveal a worktree
- **THEN** the client reports the failure to the user

### Requirement: Missing worktrees and visible action failures

The Worktrees panel SHALL label a prunable worktree `missing` rather than `clean`. A failed worktree action SHALL stay visible after the Git refresh that follows it succeeds; a successful refresh SHALL clear only a failure that a refresh raised.

#### Scenario: Missing worktree row

- **WHEN** a listed worktree is prunable
- **THEN** its row is labelled `missing`

#### Scenario: Failed delete

- **WHEN** a worktree delete fails and the following Git refresh succeeds
- **THEN** the delete's failure remains visible

### Requirement: Git observation reports its lifecycle to the server host

The Git service SHALL report its observation lifecycle to the server host that composes it: each watch opened, closed, and failed; observed changes summarised by entry class and invalidated scope; each measurement's claim, the worktrees it re-measured and carried forward, its duration and outcome; listings answered from cache; status-change events published and suppressed; and cache mismatches. A watch failure SHALL report the error that caused it. Reports SHALL identify repositories and worktrees by process-local diagnostic ids and SHALL carry no path, ref or branch name, canonical id, or Git output. The Git service SHALL NOT write a log itself; the embedded Local server's host records the reports in Desktop diagnostics, and a standalone server writes them to its service log. A report that the host fails to accept SHALL NOT alter observation, measurement, or any Git result.

#### Scenario: Watch failure is reported with its error

- **WHEN** a watch on a bound repository fails
- **THEN** the host receives a report carrying the watch kind and the error's code and message
- **AND** the repository is measured on demand as it is for any failed watch

#### Scenario: Host observer throws

- **WHEN** the host's observer throws while handling a report
- **THEN** the measurement or watch transition that raised it completes as it would have otherwise

#### Scenario: Standalone server

- **WHEN** a standalone Terminay Server observes a repository
- **THEN** its observation reports appear in that server's service log
- **AND** they are not sent to a connected Desktop

### Requirement: Explicit refresh and root change are measured

A worktree listing requested because the user explicitly refreshed the Explorer or because the project root changed SHALL be measured against Git for every worktree and SHALL NOT be answered from the cached listing, whatever the watches report. When that measurement differs from the cached listing the watches reported as current, the Git service SHALL report a cache mismatch naming each differing worktree's diagnostic id and which measured values differed, and SHALL serve the measurement. Listings raised by status-change events, event-stream resynchronisation, and directory changes continue to be answered from the cached listing while the watches report no change.

#### Scenario: Refresh after an unobserved change

- **WHEN** the default branch moved without the watches invalidating a sibling worktree, and the user refreshes the Explorer
- **THEN** every worktree is measured and the sibling's row shows its current delta
- **AND** a cache mismatch is reported for that worktree

#### Scenario: Refresh when nothing changed

- **WHEN** the user refreshes the Explorer and the measurement equals the cached listing
- **THEN** the listing is served and no cache mismatch is reported

#### Scenario: Event-driven listing

- **WHEN** a status-change event raises a listing and the watches report no change since the last measurement
- **THEN** the listing is answered from the cached listing without running Git

### Requirement: Listing scoped to a departed worktree

A worktree listing MAY name the worktree whose change raised it. The server SHALL use that name only to choose which worktrees to re-measure. When the named worktree is not part of the project's repository, the listing SHALL report the repository's current worktrees rather than fail.

#### Scenario: Refresh raised by a removed worktree

- **WHEN** a worktree is removed and a listing names it
- **THEN** the listing reports the remaining worktrees
- **AND** no Git failure is reported

#### Scenario: Worktree removed outside Terminay

- **WHEN** a worktree is removed by a Git command in a terminal and a listing names it
- **THEN** the listing reports the remaining worktrees

### Requirement: A lock does not exempt a clean worktree from removal

Bulk deletion SHALL nominate a clean worktree whether or not Git reports it as locked, and the confirmation SHALL mark each locked worktree it names. Clean-only removal of a locked worktree SHALL apply the same cleanliness and reviewed-HEAD checks as for an unlocked one before the lock is touched, SHALL then lift the lock and invoke Git's unforced worktree removal, and SHALL NOT force the removal. When Git refuses the removal, the worktree SHALL remain and SHALL be locked again with the reason its lock carried.

#### Scenario: Locked clean worktree is swept

- **WHEN** the user confirms a bulk deletion that names a clean worktree locked by an agent session
- **THEN** the worktree is removed and its row disappears
- **AND** its branch still exists

#### Scenario: Confirmation marks the lock

- **WHEN** the bulk deletion confirmation names a locked worktree
- **THEN** that worktree is marked as locked in the list

#### Scenario: Locked worktree that is no longer clean

- **WHEN** clean-only removal targets a locked worktree that gained a file after the listing
- **THEN** the removal is refused as not clean
- **AND** the worktree, the file, and the lock with its reason remain
