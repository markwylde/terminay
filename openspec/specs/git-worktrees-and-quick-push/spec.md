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

The removal confirmation SHALL explicitly warn that the worktree folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted. For a prunable worktree the confirmation SHALL instead state that its working tree is already gone and nothing on disk is deleted. When removal starts from deleting the worktree's folder, this warning SHALL be part of that folder's single delete dialog and SHALL NOT be asked again. Once the user confirms, the server SHALL use Git's forced worktree removal so those visible changes and a Git lock do not block the action. Confirmed deletions for one repository SHALL run one at a time.

#### Scenario: Confirmation warning

- **WHEN** a user is asked to confirm worktree removal
- **THEN** the confirmation states that the folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted

#### Scenario: Prunable worktree confirmation

- **WHEN** a user is asked to confirm removal of a prunable worktree
- **THEN** the confirmation states that nothing on disk is deleted

#### Scenario: Removal from a folder asks once

- **WHEN** a user chooses Delete in the delete dialog of a linked folder
- **THEN** the worktree is removed without a second confirmation

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

A worktree listing requested because the user explicitly refreshed the Explorer or because the project root changed SHALL be measured against Git for every worktree and SHALL NOT be answered from the cached listing, whatever the watches report. When that measurement differs from the cached listing the watches reported as current, the Git service SHALL report a cache mismatch naming each differing worktree's diagnostic id and which measured values differed, and SHALL serve the measurement. A project root changes only when a folder workspace that already loaded one root is given a different non-empty root. Listings raised by mounting a folder workspace, by status-change events, by event-stream resynchronisation, and by directory changes SHALL be answered from the cached listing while the watches report no change.

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

#### Scenario: A folder workspace mounts

- **WHEN** a renderer connects, or a folder workspace mounts or remounts (for example after a sidebar resize), and the repository's watches report no change
- **THEN** its listing is answered from the cached listing without running Git

#### Scenario: A new project becomes ready

- **WHEN** a mounted folder workspace's project finishes being created and loads its root for the first time
- **THEN** its listing is answered as a mount, from the cache when the watches report no change

#### Scenario: The project root changes

- **WHEN** a mounted folder workspace that loaded one root is given a different non-empty root, whether directly or after its root was empty for a while
- **THEN** its listing is measured for every worktree

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

### Requirement: Status refreshes are scoped to the worktree that changed

A Git status-change event names the worktree it came from, and the refresh it
schedules SHALL query only that worktree. A change in one worktree MUST NOT
re-run the per-worktree command set for every other worktree in the
repository. A refresh that cannot attribute itself to a single worktree — a
first load, a project root change, or a subscription resubscribe — MAY query
them all.

The command set for one worktree SHALL be issued once per refresh of that
worktree, not once per panel consumer.

#### Scenario: One worktree changes

- **WHEN** a status-change event arrives for one worktree of a repository that
  has several
- **THEN** only that worktree's status, ahead-count, line delta, and last-changed
  time are queried
- **AND** no Git command is issued against the other worktrees

#### Scenario: Unattributed refresh

- **WHEN** a refresh is raised by a first load, a project root change, or a
  resubscribe rather than by a specific worktree's change
- **THEN** every worktree is queried, as before

### Requirement: Bounded Git refresh cadence

Git status refreshes SHALL be bounded by a minimum interval between refreshes,
not only by a trailing debounce. A trailing debounce alone re-fires for every
event spaced wider than its delay, so a steady trickle of filesystem activity
sustains refreshes at the debounce frequency however expensive each one is.

The interval SHALL be no shorter than the time a refresh itself typically
takes, so refreshes cannot queue behind one another. Events arriving during an
interval SHALL collapse into exactly one refresh at its end, so no change is
dropped.

#### Scenario: Steady trickle of events

- **WHEN** status-change events arrive continuously, spaced wider than the
  debounce delay
- **THEN** refreshes are issued no more often than the minimum interval

#### Scenario: Events during an interval

- **WHEN** one or more events arrive while a refresh interval is still open
- **THEN** exactly one refresh runs when the interval ends
- **AND** the changes those events carried are reflected by it

#### Scenario: Single isolated event

- **WHEN** one status-change event arrives after a quiet period
- **THEN** a refresh runs without waiting for the full interval

### Requirement: Git status follows observed changes

The server SHALL learn about Git state changes by watching, not by running Git
on a timer. For every bound project it SHALL watch the repository's Git
directory (`HEAD`, `index`, `refs`, `packed-refs`, and the worktree registry),
the gitdir of every linked worktree, and the working tree of every registered
worktree. Writes that cannot change status on their own (object storage,
reflogs, hooks, and lock files) SHALL NOT schedule a refresh. On a host whose
filesystem watch is not recursive in the kernel (Linux), directories that Git
ignores in a working tree, and every `.git` directory inside one, SHALL NOT be
watched as part of that working tree, so changes inside them SHALL NOT schedule
a refresh.

A watch event SHALL schedule a refresh scoped to the worktree it belongs to,
through the shared ramping schedule: the first event after a quiet period runs
promptly, and sustained change widens the interval up to its ceiling. A change
to the Git directory that affects every worktree (for example `packed-refs`,
a remote-tracking ref, or the worktree registry) SHALL schedule an unscoped
refresh.

While a project's watches are live and no event has arrived since the last
measurement, the server SHALL answer a worktree listing from that measurement
without running Git.

Projects that share a repository SHALL share its watches, and the watch set
SHALL follow the worktree registry as worktrees are added and removed. When a
watched working tree's root directory goes away, or is gone by the time its
watch is armed, the server SHALL close that working tree's watch only, SHALL
schedule an unscoped refresh, and SHALL keep every other watch of the
repository live. A working tree whose root goes away is a removal, not a watch
failure. A registered worktree with no working tree has no working-tree watch.
Each measurement re-derives the watch set, so the first measurement after such
a root reappears watches it again.

#### Scenario: Idle repository

- **WHEN** a project is open and nothing in its repository or working trees
  changes
- **THEN** no Git command runs for that project

#### Scenario: A file is edited

- **WHEN** a file in a worktree's working tree is saved
- **THEN** a refresh scoped to that worktree runs within the ramp's first step
- **AND** the Git sidebar reflects the edit

#### Scenario: A file is created in a new directory

- **WHEN** a new directory that Git does not ignore is created in a working
  tree, and a file is then saved inside it
- **THEN** a refresh scoped to that worktree runs
- **AND** later saves inside that directory are observed as well

#### Scenario: A commit or branch switch happens outside Terminay

- **WHEN** `HEAD`, `index`, or a ref changes because of a Git command run in a
  terminal or another tool
- **THEN** the affected worktree is refreshed without any client asking

#### Scenario: Listing after a status-change event

- **WHEN** a client lists worktrees after the server has measured them and no
  watch event has arrived since
- **THEN** the listing is served from that measurement without running Git

#### Scenario: Sustained churn

- **WHEN** watch events keep arriving, for example during a dependency install
- **THEN** refreshes for that project run no more often than the ramp allows
- **AND** events inside an interval collapse into one refresh at its end

#### Scenario: Build output in an ignored directory

- **WHEN** a build on a Linux server deletes and recreates a directory that Git
  ignores, such as `dist/` or `node_modules/`
- **THEN** no refresh is scheduled for that churn

#### Scenario: A worktree is added

- **WHEN** a new worktree is registered for a watched repository
- **THEN** its gitdir and working tree are watched from then on

#### Scenario: A worktree is removed with Git

- **WHEN** `git worktree remove` deletes a linked worktree from a terminal
- **THEN** the server publishes a status change without any client asking
- **AND** the next ordinary listing no longer includes that worktree
- **AND** the repository's remaining watches stay live, so a later edit in
  another worktree is still observed

#### Scenario: A worktree folder is deleted and then pruned

- **WHEN** a linked worktree's folder is deleted with `rm -rf`, and later
  `git worktree prune` runs
- **THEN** after the deletion the next ordinary listing shows the worktree as
  prunable
- **AND** after the prune the server publishes a status change and the next
  ordinary listing no longer includes it

#### Scenario: A worktree root is gone before its watch is armed

- **WHEN** a linked worktree's folder is deleted after the listing that named
  it but before its working-tree watch is armed
- **THEN** only that working tree goes unwatched and an unscoped refresh is
  scheduled
- **AND** the repository's observation stays available

#### Scenario: A deleted worktree folder is restored

- **WHEN** a deleted linked worktree's folder is restored without changing the
  worktree registry, and the user then refreshes the Explorer
- **THEN** the worktree is listed with its working tree again
- **AND** a later edit in it publishes a status change without any client asking

### Requirement: Unavailable Git watches do not fall back to polling

When a watch cannot be established or stops working, for example because the
filesystem does not support it or the host's watch limit is reached, the server
SHALL mark that project's Git observation as unavailable and SHALL measure on
demand each time a client asks. It SHALL NOT schedule any timer-driven Git
refresh in its place. Losing a watch SHALL publish one unattributed
status-change event so that clients re-query once.

A client's listing request against an unavailable observation SHALL also start
one attempt to re-establish the repository's watches, unless an attempt is
already under way. Nothing else SHALL start an attempt. An attempt succeeds only
when every watch is ready. The observation is then live again: later changes
are observed and later listings are answered from the cache. When it fails, the
observation stays unavailable and the failure is reported like any other watch
failure, but without publishing another status-change event.

#### Scenario: Watch limit reached

- **WHEN** a working-tree watch fails because the host watch limit is reached
- **THEN** the project's listing is measured whenever a client asks for it
- **AND** no Git command runs for that project between client requests

#### Scenario: Watch capacity comes back

- **WHEN** a repository's observation is unavailable because the host watch
  limit was reached, capacity is freed, and a client then lists its worktrees
- **THEN** the repository's watches are re-established
- **AND** a later edit in a working tree publishes a status change without any
  client asking

#### Scenario: A worktree changed while unwatched is re-measured on re-arm

- **WHEN** a linked worktree changes while its repository's observation is
  unavailable, and capacity then comes back and a client lists only another
  worktree of that repository
- **THEN** the next listing of the repository shows the linked worktree's
  change

#### Scenario: Re-arming fails again

- **WHEN** a client lists the worktrees of an unavailable repository and the
  watches still cannot be established
- **THEN** the listing is measured and served
- **AND** no Git command runs for that project until the next client request

### Requirement: Closed projects run no Git

Closing a project SHALL release its Git binding, cancel any pending refresh,
and close every watch no other open project still needs. After the release
completes, the server SHALL run no Git command on behalf of the closed
project, and no request SHALL implicitly re-bind it.

#### Scenario: Close a project with terminals

- **WHEN** a project with open terminals in a Git repository is closed
- **THEN** its terminals are terminated
- **AND** no Git command runs for that project afterwards

#### Scenario: Close a project without terminals

- **WHEN** a project that has no terminal sessions is closed
- **THEN** its Git binding and watches are released just the same

#### Scenario: Another project shares the repository

- **WHEN** one of two open projects rooted in the same repository is closed
- **THEN** the remaining project keeps its watches and live status

### Requirement: Unpushed worktree work

A worktree listing SHALL report, for each worktree, whether it holds unpushed commits and the size of its unpushed work as lines added and lines removed. Where the worktree's branch has an upstream that exists, its unpushed commits SHALL be the commits that upstream lacks. Where the branch has no upstream, or its upstream no longer exists, its unpushed commits SHALL be the commits no remote-tracking branch holds, and a branch whose resulting tree is already present on the default branch SHALL hold none. The size of unpushed work SHALL count the unpushed commits and the uncommitted changes to tracked files. A value that cannot be measured SHALL be reported as unknown rather than as zero. The measurement SHALL be refreshed when a push or a fetch moves a remote-tracking branch.

#### Scenario: Pushed branch

- **WHEN** a worktree's branch has every commit on its upstream and no uncommitted changes
- **THEN** the listing reports no unpushed commits and an unpushed size of zero

#### Scenario: Commits ahead of the upstream

- **WHEN** a worktree's branch is two commits ahead of its upstream, and those commits add five lines
- **THEN** the listing reports unpushed commits and five unpushed lines added

#### Scenario: Branch never pushed

- **WHEN** a worktree's branch has no upstream and holds a commit that no remote-tracking branch has and the default branch lacks
- **THEN** the listing reports unpushed commits

#### Scenario: New worktree with no commits of its own

- **WHEN** a worktree's branch has no upstream and every commit on it is on a remote-tracking branch
- **THEN** the listing reports no unpushed commits

#### Scenario: Squash-merged branch whose remote branch was deleted

- **WHEN** a worktree's branch was squash-merged, its resulting tree is present on the default branch, and its upstream no longer exists
- **THEN** the listing reports no unpushed commits

#### Scenario: A push is seen

- **WHEN** a branch with unpushed commits is pushed
- **THEN** the listing reports no unpushed commits for its worktree without the user refreshing

### Requirement: Server-owned worktree creation

The Git service SHALL offer a worktree creation operation for an open project.
It SHALL take a branch name, the forge repository it is for, and either a new
branch from the repository's default branch or a remote branch to track. It
SHALL require write scope and authority for the project. The server SHALL
choose the remote: the project's remote claimed for that repository, preferring
`origin` and then the remote of the repository's current branch's upstream
when several are claimed. The server SHALL validate the branch name with
`git check-ref-format --branch` and SHALL choose the worktree path itself: a
sibling of the repository root named `<repository directory name>-<branch with
/ replaced by ->`, with a numeric suffix when that path exists.

When the branch is already checked out in a worktree, the operation SHALL fail
with a typed reason that names that worktree's path. When the branch exists
locally and is not checked out, the operation SHALL refuse it unless the
client asked to reuse it, and then SHALL add the worktree on the existing
branch without moving it. Otherwise it SHALL fetch the base or tracked branch
from the remote and run `git worktree add` with fixed arguments and no shell,
creating the branch from the remote's default branch or tracking the remote
branch. It SHALL return the new worktree's path and branch.

Creation operations for one repository SHALL run one at a time, and each SHALL
repeat its branch and path checks when it runs. When a step fails, the server
SHALL remove a branch and a directory it created in that operation and SHALL
leave everything else as it was. Asked to plan only, it SHALL return the path
it would choose, whether the branch name is valid, and whether the branch
exists or is checked out, without fetching or creating anything. The new
worktree SHALL appear in the project's folders as any worktree created in a
terminal does.

#### Scenario: Planning a worktree

- **WHEN** a client asks to plan a worktree for branch `issue-541-home-sidebar`
- **THEN** it receives the path the server would use and nothing is created

#### Scenario: New branch for an issue

- **WHEN** a client creates a worktree for branch `issue-541-home-sidebar` from
  the default branch in a project at `/src/terminay`
- **THEN** `/src/terminay-issue-541-home-sidebar` is created on a new branch
  `issue-541-home-sidebar` from the remote default branch

#### Scenario: Tracking a pull request branch

- **WHEN** a client creates a worktree tracking remote branch `change/13-events`
- **THEN** a worktree on local branch `change/13-events` tracking the remote
  branch is created

#### Scenario: Existing local branch

- **WHEN** a client asks for branch `change/13-events`, which exists locally and
  is not checked out, without asking to reuse it
- **THEN** the operation fails saying the branch exists, and nothing is created

#### Scenario: Branch already checked out

- **WHEN** a client asks for a branch already checked out at
  `/src/terminay-change-13-events`
- **THEN** the operation fails with a reason naming that path

#### Scenario: Two requests at once

- **WHEN** two clients create a worktree for the same new branch at the same
  time
- **THEN** one succeeds and the other fails saying the branch is checked out

#### Scenario: Fetch fails

- **WHEN** the fetch from the remote fails
- **THEN** the operation fails with the reason and no branch or directory is
  left behind

#### Scenario: Invalid branch name

- **WHEN** a client asks for branch `bad..name`
- **THEN** the operation fails with a visible reason and nothing is created

#### Scenario: Read-only client

- **WHEN** a client with read scope asks to create a worktree
- **THEN** the operation is refused

### Requirement: Git observation never blocks the server

Watching a repository SHALL NOT occupy the server's event loop for long enough
to delay its other work. Establishing a watch, extending it to newly created
directories, and handling its events SHALL proceed in steps whose synchronous
work has a fixed bound and that yield between them. No step SHALL walk a
directory tree or read a whole directory synchronously, on any platform. When
many directories are created in a short time, the server SHALL take them up
together rather than once per event.

#### Scenario: Server stays responsive during a build

- **WHEN** a build or dependency install creates and deletes thousands of
  directories in an observed working tree on a Linux server
- **THEN** a timer due on the server's event loop during that churn fires within
  a quarter of a second of its due time
- **AND** connected clients keep receiving terminal output throughout

#### Scenario: Many directories appear at once

- **WHEN** a tree of thousands of directories that Git does not ignore appears
  in an observed working tree in one operation
- **THEN** the server takes those directories into the watch in bounded steps
- **AND** a timer due during that work fires within a quarter of a second of its
  due time

#### Scenario: One very wide directory

- **WHEN** an observed directory holds tens of thousands of entries
- **THEN** the server reads it across several bounded steps
- **AND** a timer due during that work fires within a quarter of a second of its
  due time

### Requirement: Closing a Git watch stops its work

Closing or failing a watch SHALL stop all of its pending work. After it closes,
the watch SHALL open no further watches, deliver no further changes, and start
no Git command.

#### Scenario: Project closed while a watch is still being established

- **WHEN** the only project bound to a repository is closed while its
  working-tree watch is still discovering directories
- **THEN** no further watch is opened for that repository
- **AND** no Git command runs for it afterwards

### Requirement: Built-up Git watches follow the tree they observe

Where the server builds a recursive watch from per-directory watches (Linux),
it SHALL keep that watch matched to the working tree. A directory that is
created, renamed into place, or replaced at the same path SHALL be watched once
it is there. A directory that is removed or renamed away SHALL stop being
watched. A directory holding its own `.git` entry (a submodule or another
nested repository) SHALL NOT be watched as part of the outer working tree.

#### Scenario: A populated directory is renamed

- **WHEN** a directory holding files is renamed within an observed working tree,
  and a file inside it is then saved
- **THEN** that save schedules a refresh scoped to its worktree

#### Scenario: A directory is deleted and recreated at once

- **WHEN** a non-ignored directory is deleted and a new directory is created at
  the same path, and a file inside the new directory is then saved
- **THEN** that save schedules a refresh scoped to its worktree

#### Scenario: Repository with a submodule

- **WHEN** an observed working tree contains a submodule
- **THEN** the working-tree watch stays live
- **AND** files inside the submodule are not watched as part of the outer
  working tree

#### Scenario: Linked worktree inside an ignored directory

- **WHEN** a linked worktree lives inside a directory the main worktree ignores,
  and a file in the linked worktree is saved
- **THEN** a refresh scoped to the linked worktree runs

### Requirement: Built-up Git watches follow ignore rules as they change

Where the server builds a recursive watch from per-directory watches (Linux), it
SHALL re-evaluate which directories it excludes when `.gitignore`,
`.git/info/exclude`, the repository `config`, or the index changes. A directory
that becomes un-ignored or tracked SHALL then be watched, and one that becomes
ignored SHALL stop being watched. Edits to the contents of an external
`core.excludesFile` are not observed.

#### Scenario: A directory is un-ignored

- **WHEN** a rule that ignored a directory is removed from `.gitignore`, and a
  file inside that directory is then saved
- **THEN** that save schedules a refresh scoped to its worktree

#### Scenario: A directory becomes ignored

- **WHEN** a rule ignoring an existing directory is added to `.gitignore`, and
  that directory is then churned
- **THEN** the churn schedules no refresh

### Requirement: Built-up Git watches fail rather than degrade

A built-up recursive watch SHALL observe at most a fixed number of directories.
It SHALL fail when it would exceed that ceiling or when the host refuses a watch
for lack of capacity. It SHALL also fail when any part of it stops observing for
a reason other than its directory being removed, or when Git cannot say which
directories are ignored. The project's Git observation then becomes unavailable
as specified for unavailable Git watches. A built-up watch SHALL NOT continue
with partial coverage.

#### Scenario: Working tree larger than the watch ceiling

- **WHEN** an observed working tree holds more non-ignored directories than the
  watch ceiling
- **THEN** that working-tree watch fails with an error naming the ceiling
- **AND** the project's listing is measured whenever a client asks for it

#### Scenario: Host inotify watch limit reached

- **WHEN** the host refuses a per-directory watch because its watch limit
  (`ENOSPC`) or descriptor limit (`EMFILE`) is reached
- **THEN** that watch fails with that error's code
- **AND** one status-change event is published and the listing is measured
  whenever a client asks for it

#### Scenario: A subdirectory watch stops unexpectedly

- **WHEN** the watch on a subdirectory that still exists reports an error
- **THEN** the whole working-tree watch fails
- **AND** listings are no longer answered from the cached measurement

#### Scenario: Git cannot report ignored directories

- **WHEN** the ignore check fails or its output is truncated
- **THEN** the working-tree watch fails rather than watching or skipping
  directories by guesswork

### Requirement: Status-change events follow every listed value

The server SHALL publish `git.status.changed` for a worktree whenever a
measurement finds that any value in the worktree's listing summary differs from
the summary it last published for that worktree. The comparison SHALL leave out
only values that change on every measurement without a change in the
repository. The event keeps its metadata-only shape, and clients learn the
changed values by listing again.

#### Scenario: Push of a clean branch with no upstream

- **WHEN** a linked worktree has no uncommitted changes, its branch has no
  upstream, and the branch is pushed to a new remote branch from a terminal
- **THEN** the server publishes a status change for that worktree without any
  client asking
- **AND** the next ordinary (not fresh) listing shows no unpushed commits and no
  unpushed line delta for it

#### Scenario: Push of a branch with uncommitted changes

- **WHEN** a linked worktree with uncommitted tracked changes pushes its branch,
  which has no upstream, to a new remote branch
- **THEN** the server publishes a status change for that worktree
- **AND** the next ordinary listing shows no unpushed commits, and an unpushed
  line delta equal to the uncommitted changes alone

#### Scenario: Default branch moves after a pull

- **WHEN** the default branch advances because of a pull or fetch, and a linked
  worktree's ahead count or line delta against it changes as a result
- **THEN** the server publishes a status change for that worktree
- **AND** the next ordinary listing shows the new ahead count and line delta

#### Scenario: Unchanged re-measure

- **WHEN** a worktree is re-measured, its listing summary equals the one last
  published for it, and its branch status equals the one last published for it
- **THEN** no status change is published for it

### Requirement: Listings are cached only under ready watches

A Git watch SHALL count as ready once it observes its whole intended scope; a
watch built from per-directory watches is ready when every directory its filter
keeps is armed. The server SHALL cache a measured listing only when every watch
of the repository was ready before the measurement claimed its changes and is
still ready and live when it ends. A listing raised while any watch is still
becoming ready SHALL wait until each is ready or has failed before measuring.

#### Scenario: Two listings right after binding

- **WHEN** a project is bound and two ordinary listings follow, with no change
  to the repository in between
- **THEN** the repository's worktrees are measured once
- **AND** the second listing is answered from the cached measurement

#### Scenario: A file changes while a watch is still becoming ready

- **WHEN** a file changes in a working-tree directory that its built-up watch
  has not armed yet, while a listing is waiting for the watches to be ready
- **THEN** that listing is measured after the watches are ready and includes the
  change

#### Scenario: A watch fails after it became ready

- **WHEN** a ready working-tree watch later fails because the host watch limit
  is reached
- **THEN** the cached listing is dropped and the next listing is measured
