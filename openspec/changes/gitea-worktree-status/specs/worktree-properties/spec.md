## ADDED Requirements

### Requirement: Provider-neutral worktree property model

Terminay SHALL define the worktree properties an extension can publish. The
model SHALL be provider-neutral and SHALL consist of:

- a pull request: number, title, HTTPS URL, state (`open`, `draft`, `merged`,
  or `closed`), and optional mergeability;
- a checks summary: counts of passed, failed, pending, and skipped checks and
  their total, an optional HTTPS URL, and at most 100 check items, each with a
  name, a state (`passed`, `failed`, `pending`, or `skipped`), and an optional
  HTTPS URL.

Either part MAY be absent. Terminay SHALL reject a publication whose counts do
not sum to the total, whose strings exceed their bounds, or whose URLs are not
credential-free HTTPS URLs, and SHALL keep the last valid properties for that
worktree.

#### Scenario: Valid publication

- **WHEN** an extension publishes a pull request and a checks summary whose
  counts sum to its total and whose URLs are credential-free HTTPS
- **THEN** Terminay accepts them as that worktree's properties

#### Scenario: Invalid URL

- **WHEN** a publication contains a URL with embedded credentials or a non-HTTPS
  scheme
- **THEN** the publication is rejected and the worktree keeps its last valid
  properties

#### Scenario: Inconsistent counts

- **WHEN** a checks summary's passed, failed, pending, and skipped counts do not
  sum to its total
- **THEN** the publication is rejected

### Requirement: Worktree properties are rendered by Terminay

Terminay alone SHALL render worktree properties, using its own components and
theme. A worktree with a pull request SHALL show a chip with the pull request
number and a state indication. A worktree with a checks summary SHALL show a
chip with the failed, passed, and pending counts and an overall tone: failed
when any check failed, pending when none failed and any is pending, passed
otherwise. Worktrees without properties SHALL render exactly as they do without
any extension installed.

#### Scenario: Pull request with failing checks

- **WHEN** a worktree has an open pull request #285 and a checks summary with 2
  failed, 12 passed, and 2 pending
- **THEN** its row shows a `#285` chip and a checks chip in the failed tone
  showing 2 failed, 12 passed, and 2 pending

#### Scenario: No properties

- **WHEN** no extension has published properties for a worktree
- **THEN** its row shows no pull request or checks chip

### Requirement: Worktree property interactions

Activating the pull request chip SHALL open the pull request URL through the
guarded external-link path. Activating the checks chip SHALL open a
host-rendered list of the check items with their states, where activating an
item with a URL opens it through the guarded external-link path. Both chips
SHALL be keyboard reachable and SHALL expose an accessible name that includes
the pull request number or the check counts.

#### Scenario: Opening a pull request

- **WHEN** a user activates a worktree's pull request chip
- **THEN** the pull request URL opens through the guarded external-link path

#### Scenario: Inspecting checks

- **WHEN** a user activates a worktree's checks chip
- **THEN** a list of that worktree's checks opens, and activating a check with a
  URL opens that check's run

### Requirement: Worktree properties are project-scoped

Worktree properties SHALL be delivered only to clients authorized for the
project whose repository context the worktree belongs to, and SHALL be dropped
when the worktree leaves that context, the publishing extension is disabled, or
its host fails.

#### Scenario: Client of another project

- **WHEN** a client authorized only for project A is connected
- **THEN** it receives no worktree properties for project B

#### Scenario: Extension disabled

- **WHEN** the extension that published a worktree's properties is disabled
- **THEN** those properties are removed from every client

### Requirement: Provider sign-in prompt

When an extension reports that a forge host needs a credential for a project
the user has open, Terminay SHALL show a sign-in prompt naming the provider and
host with three choices: **Yes**, **No, maybe later**, and **Don't ask me about
<provider> again**. **Yes** SHALL collect the credential through the declarative
secret field, with a guarded link to the host's token page when the extension
supplies one, and SHALL store it in the server vault bound to that extension and
host origin. **No, maybe later** SHALL suppress the prompt for that host until
the Terminay Server next starts. **Don't ask me about <provider> again** SHALL
suppress the prompt for every host of that extension until the user re-enables
it in that extension's Settings. At most one prompt SHALL be shown per host at a
time, however many projects share that host.

#### Scenario: Accepting sign-in

- **WHEN** the user chooses **Yes** and submits a token
- **THEN** the token is stored in the vault bound to the extension and host
  origin, and the extension is notified that a credential is available

#### Scenario: Maybe later

- **WHEN** the user chooses **No, maybe later**
- **THEN** the prompt is not shown again for that host until the server restarts

#### Scenario: Never ask again

- **WHEN** the user chooses **Don't ask me about Gitea again**
- **THEN** no Gitea sign-in prompt is shown for any host until the user
  re-enables it in the Gitea extension's Settings

#### Scenario: Two projects on one host

- **WHEN** two open projects both need a credential for the same host
- **THEN** a single prompt is shown for that host
