## ADDED Requirements

### Requirement: Home Pull Requests section

The Home **Pull Requests** section SHALL present a header naming the section
with a count of shown pull requests, repositories, and accounts, and a toolbar
with a text filter, scope chips **Needs my review**, **Mine**, **Involved**, and
**All**, each with its count of open pull requests, a **State** control of
**Open**, **Merged**, and **All**, and a **Group** control of **Repo** and
**None**. Needs my review SHALL be selected when the section first opens on a
device, and the device SHALL remember the last scope, state, and grouping.
Rows SHALL be ordered by most recently updated first. Grouped by repository,
each group SHALL be headed by its forge's name and mark, its `owner/repo`, and
its row count. Each row SHALL show a state mark (open, draft, merged, or
closed), the title on one line truncated with an ellipsis, the number, the
author, the checks summary when known, the time since it was updated, its labels
in their colours, and a worktree chip when its head branch is checked out in a
worktree of an open project. With grouping off, each row SHALL also name its
repository. When a source's `all` reach is `owners`, the All chip SHALL say
that it covers the account's own and its organisations' repositories for that
forge.

#### Scenario: Opening the section

- **WHEN** a user opens Home › Pull Requests on a device for the first time
- **THEN** Needs my review is selected, rows are grouped by repository, and
  each group is headed by its forge and `owner/repo`

#### Scenario: Branch checked out locally

- **WHEN** a pull request's head branch is the branch of a worktree in an open
  project named Forum
- **THEN** its row shows a worktree chip reading Forum

### Requirement: Home Issues section

The Home **Issues** section SHALL present the same header, filter, state
control of **Open**, **Closed**, and **All**, and grouping as Pull Requests,
with scope chips **Assigned to me**, **Created by me**, **Mentioned**, and
**All**. Assigned to me SHALL be selected when the section first opens on a
device. Rows SHALL be single lines grouped by repository under the same forge
and `owner/repo` headers as Pull Requests. Each row SHALL show a state mark,
the title truncated with an ellipsis, the number, the labels, the comment count,
and the time since it was updated.

#### Scenario: Issues grouped by repository

- **WHEN** a user opens Home › Issues and has assigned issues in two
  repositories
- **THEN** the issues appear under two headers, each naming the forge and
  `owner/repo`

### Requirement: Matching items to open projects and worktrees

Terminay SHALL match a forge repository to an open project when one of the
project's remotes is claimed for the same origin, owner, and name, comparing
owner and name without regard to case. Terminay SHALL match a pull request to
a worktree of such a project only when the pull request's head repository is
the repository itself and the worktree's branch either has the head branch's
name or tracks `<remote>/<head branch>` on a remote claimed for that
repository. A pull request from a fork SHALL match no worktree. When several
worktrees match, the worktree chip SHALL name the first by project order and
say how many more there are, and Open worktree SHALL let the user choose. When
a repository is open as more than one project, an action that creates a
worktree SHALL let the user choose the project, defaulting to the one most
recently selected. The match SHALL run on the server, and its results SHALL
reach a client only for projects that client is authorized for.

#### Scenario: Worktree tracking the head branch under another name

- **WHEN** a worktree's branch `review-88` tracks `origin/change/13-events` and
  pull request #88's head branch is `change/13-events` in the same repository
- **THEN** #88 shows that worktree's chip

#### Scenario: Fork with a matching branch name

- **WHEN** a pull request from a fork has head branch `main` and a project's
  worktree is on `main`
- **THEN** the pull request shows no worktree chip

#### Scenario: Same repository open twice

- **WHEN** `owner/app` is open as projects App and App Review and a user checks
  out a pull request
- **THEN** the user chooses which project the worktree is created in

### Requirement: Item detail pane

Selecting a row SHALL show the item's detail in a pane beside the list, fetched
from its source on selection. The pane SHALL show the state, repository,
number, title, labels, author, and body as plain text with links. For a pull
request it SHALL also show the head and base branches, the checks with failed
and pending checks first, and the worktree its head is checked out in, if any.
For an issue it SHALL show the most recent comments. Activating a link in the
body, a check, or the open-on-forge action SHALL open it through the guarded
external-link path. Forge-supplied text SHALL NOT be rendered as HTML.

#### Scenario: Selecting a pull request

- **WHEN** a user selects a pull request row with two failed checks
- **THEN** the detail pane shows its branches and lists the two failed checks
  first

#### Scenario: Script in an issue body

- **WHEN** an issue body contains `<script>` markup
- **THEN** the pane shows it as text and nothing executes

### Requirement: Pull request actions

The pull request detail SHALL offer:

- **Open worktree**, when its head branch is checked out in a matched worktree,
  which selects that project and its worktree folder;
- **Check out in new worktree**, when the repository is open as a project, no
  worktree matches, and the head repository is the repository itself, which
  creates a worktree tracking the remote head branch through the server-owned
  worktree creation operation and selects it;
- **Review with agent**, under the same conditions as either of the two above,
  which opens a terminal in the matched worktree, creating the worktree first
  when none matches, running the chosen launcher with an editable review prompt
  that names the pull request number, title, and URL;
- open on the forge.

When worktree creation reports that the branch is already checked out in a
worktree of that project, the action SHALL use that worktree. An action that is
not available SHALL be shown disabled with the reason, such as that the
repository is not open as a project or that the pull request comes from a fork.

#### Scenario: Checking out a pull request

- **WHEN** a user activates Check out in new worktree on pull request #88 whose
  head branch is `change/13-events`
- **THEN** a worktree tracking the remote `change/13-events` is created in that
  project and its folder is selected

#### Scenario: Reviewing a checked-out pull request

- **WHEN** a user confirms Review with agent with Codex on a pull request whose
  head branch is checked out in a worktree
- **THEN** a terminal opens in that worktree running Codex with the confirmed
  prompt, and no worktree is created

#### Scenario: Pull request from a fork

- **WHEN** a pull request's head repository is a fork
- **THEN** Check out in new worktree and Review with agent are disabled and say
  that pull requests from forks cannot be checked out

### Requirement: Start work on an issue

The issue detail SHALL offer **Start work** when the issue's repository is open as
a project. It SHALL show an editable branch name, defaulting to
`issue-<number>-<slug of the title>` of at most 64 characters, the worktree
path the server plans to use, a choice between each available launcher that
accepts an initial prompt and **Shell only**, and, for a launcher, an editable
prompt that names the issue number, title, and URL and quotes the start of its
body. Confirming SHALL create a worktree on a new branch from the
repository's default branch through the server-owned worktree creation
operation, then open a terminal in it running the chosen launcher with the
prompt, or a shell. When the branch already exists and is not checked out,
Start work SHALL say so and offer to use it. When the branch is already checked
out in a worktree of the project, as after a retry, Start work SHALL open the
terminal in that worktree. When the repository is not open as a project, Start
work SHALL be disabled and SHALL say that the repository must be opened as a
project. A failure SHALL be shown with its reason and SHALL leave the panel
open for a retry.

#### Scenario: Starting work with Claude Code

- **WHEN** a user starts work with Claude Code on issue #541, titled "Home
  sidebar: Pull Requests and Issues sections"
- **THEN** a worktree on branch
  `issue-541-home-sidebar-pull-requests-and-issues-sections` is
  created, and a terminal in it runs Claude Code with the prompt

#### Scenario: Shell only

- **WHEN** a user starts work with Shell only
- **THEN** the worktree is created and a shell terminal opens in it with
  nothing typed

#### Scenario: Retrying after the terminal failed

- **WHEN** Start work created the worktree but the terminal could not be
  created, and the user confirms again
- **THEN** no second worktree is created and the terminal opens in the first

### Requirement: Project Git tab

A project's Git left-column tab SHALL hold two sidebar panes, **Issues** and
**Pull Requests**, in that order by default, each present only while a claiming
source serves that kind. Each pane SHALL have a title row with its count of
open items, a collapse control, a reorder grip, and a resize separator between
expanded panes, presented as the project's right sidebar panes are. The panes'
order, collapse state, and heights SHALL be remembered on the device. The
Pull Requests pane SHALL list the repository's open pull requests, with a
**This worktree** group first holding the pull request matched to the selected
folder's worktree, then **Open**, then **Recently merged** with at most five
merged pull requests. The Issues pane SHALL list the repository's open issues.
Rows SHALL be single-line list rows in the style of the sidebar's other panes:
the state mark, the title truncated with an ellipsis, the number, a mark when
the head branch is checked out in a worktree, and the checks summary as an
icon; the row's tooltip SHALL name the head and base branches and where the
branch is checked out. Group labels SHALL be drawn as the sidebar's group
headers are.

For a client whose authorization is not bound to a project, each pane's title
row SHALL offer **Show all on Home**. Activating a row SHALL select Home and
open its Pull Requests or Issues section filtered to that repository with the
item selected, and activating Show all on Home SHALL do the same with no item
selected. For a client bound to the project, which has no Home sections, there
SHALL be no Show all on Home action, and activating a row SHALL open the item's
detail, with its actions, in place of that pane's list, with a way back to the
list.

#### Scenario: Selecting a project pull request

- **WHEN** a user activates pull request #535 in a project's Pull Requests pane
- **THEN** Home is selected, its Pull Requests section shows that repository's
  pull requests, and #535 is selected

#### Scenario: Project-bound client selects a pull request

- **WHEN** a remote client bound to the project activates pull request #535
- **THEN** the Pull Requests pane shows #535's detail and Home is not selected

#### Scenario: Current worktree first

- **WHEN** the selected folder's worktree branch has open pull request #535
- **THEN** #535 appears under This worktree above every other pull request

#### Scenario: Rearranging the panes

- **WHEN** a user collapses Issues and moves Pull Requests above it
- **THEN** Pull Requests is first, Issues shows only its title row, and both
  stay that way when the project is opened again on that device

### Requirement: Empty, signed-out, and failure states

Each list SHALL say plainly why it is empty: no items match the scope; no
account is set up for any forge, with a link to Settings › Extensions; or a
source failed, naming the source and offering Retry. A list with some sources
failing SHALL still show the items from the others.

#### Scenario: No accounts

- **WHEN** no forge source has an account
- **THEN** Home › Pull Requests says no forge account is set up and links to
  Settings › Extensions
