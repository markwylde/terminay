## ADDED Requirements

### Requirement: Provider-neutral forge item model

Terminay SHALL define the pull request and issue facts a forge source can
supply. The model SHALL be provider-neutral and SHALL consist of:

- an item reference: kind (`pullRequest` or `issue`), the forge account's HTTPS
  origin, the repository owner and name, and the item number;
- an item summary: its reference, title, canonical URL, state (`open`,
  `draft`, `merged`, or `closed` for a pull request; `open` or `closed` for an
  issue), author login, at most 20 labels each with a name and a six-digit hex
  colour, comment count, and created and updated times; and for a pull
  request, its head and base branch names, the head repository's owner and
  name, the head commit, and an optional checks summary in the worktree
  property checks shape;
- an item detail: the summary, a body of at most 65,536 characters, and at most
  the 10 most recent comments, each with an author, a time, and a body of at
  most 8,192 characters.

An item's canonical URL SHALL be a credential-free HTTPS URL on the item's
origin. A check's target URL SHALL be a credential-free HTTPS URL on any
origin, because continuous integration often runs elsewhere. Links in a body or
comment are text and SHALL be opened only through the guarded external-link
path.

Terminay SHALL reject a summary or detail whose strings exceed their bounds,
whose canonical URL is not on the item's origin, whose check target URLs are
not credential-free HTTPS URLs, whose state is not valid for its kind, or
whose checks counts do not sum to their total. A rejected item SHALL be
dropped from its page, and the rest of the page SHALL be kept.

#### Scenario: Valid summary

- **WHEN** a source returns an open pull request with a credential-free HTTPS
  URL on its account's origin and two labels with hex colours
- **THEN** Terminay accepts it

#### Scenario: Canonical URL on another origin

- **WHEN** a source returns an item whose canonical URL is on a different
  origin from the item's account
- **THEN** that item is dropped and the rest of the page is kept

#### Scenario: Check hosted elsewhere

- **WHEN** a Gitea pull request has a check whose target URL is
  `https://ci.example.org/build/7`
- **THEN** Terminay accepts the item and the check links to that URL

#### Scenario: Merged issue

- **WHEN** a source returns an issue whose state is `merged`
- **THEN** that item is dropped

### Requirement: Forge source contribution and registration

A package SHALL declare each forge source under `contributes.forgeSources`.
Each declaration SHALL carry a namespaced source id, a display name, an
optional description, the item kinds it serves (`pullRequest`, `issue`, or
both), and what its `all` scope reaches: `readable` (every repository the
account can read) or `owners` (the account's own and its organisations'
repositories). At activation the extension SHALL register each declared source
through `context.forges.registerSource(id, runtime)`, which SHALL return a
disposable registration. Registration SHALL be refused for an undeclared id, a
duplicate id, a registration after deactivation, or an extension that does not
declare the `forge-source` permission.

The runtime SHALL implement:

- `accounts(signal)`: the accounts the source can act as, at most one per
  origin, each with an HTTPS origin, a login, where its credential came from
  (`environment`, `cli-config`, `cli`, or `sign-in`), a state (`ready` or
  `rejected`), and the owners it can act for (its login and at most 49
  organisations);
- `claim(remote, signal)`: given a remote name and URL, either the repository
  it maps to on one of the source's origins, as an origin, owner, and name, or
  nothing;
- `query(query, signal)`: one page of item summaries for one account's query;
- `detail(reference, signal)`: one item's detail.

#### Scenario: Registering a declared source

- **WHEN** an extension with the `forge-source` permission registers a forge
  source id its manifest declared
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Missing permission

- **WHEN** an extension without the `forge-source` permission registers a forge
  source
- **THEN** the registration is refused

#### Scenario: Undeclared kind

- **WHEN** a source declared only for `pullRequest` is queried
- **THEN** Terminay never sends it an `issue` query

### Requirement: Forge source answers are checked against the question

Terminay SHALL check every answer against what it asked. An account list
holding two accounts for one origin, or a non-HTTPS origin, SHALL be rejected
as a whole. A claim SHALL be accepted only when its origin's host is the
remote URL's host. A query result item SHALL be dropped when its origin is not
the queried account's origin, its kind is not the queried kind, or, when the
query named repositories or owners, its repository or owner is not among them.
A detail SHALL be rejected when its reference is not the requested reference.
A claim call SHALL be bounded and cancelled like a query.

#### Scenario: Detail for a different item

- **WHEN** Terminay asks for issue #12 of `owner/app` and the source returns
  issue #13
- **THEN** the detail is rejected and the user is told it could not be loaded

#### Scenario: Item outside the narrowed repositories

- **WHEN** a query names only `owner/app` and the source returns an item from
  `owner/secret`
- **THEN** that item is dropped

#### Scenario: Claim for another host

- **WHEN** a source claims `https://evil.example` for the remote
  `git@git.example.net:owner/app.git`
- **THEN** the claim is ignored

### Requirement: Forge queries

A forge query SHALL carry a kind, a scope, a state, the account's origin, an
optional list of at most 50 repositories, an optional owner list of at most 50
owners, an optional text filter of at most 256 characters, an optional opaque
cursor of at most 1,024 characters, and a page size of at most 50. Pull
request scopes SHALL be `reviewRequested`, `authored`, `involved`, and `all`.
Issue scopes SHALL be `assigned`, `authored`, `mentioned`, and `all`.
`involved` SHALL mean authored by, assigned to, mentioning, or requesting
review from the account. `all` SHALL mean every item the source's declared
`all` reach covers, narrowed by the repository and owner lists when given.
Pull request states SHALL be `open` (which includes drafts), `merged`,
`closed`, and `all`. Issue states SHALL be `open`, `closed`, and `all`.

A repository or owner list that is absent SHALL mean no restriction. Terminay
SHALL never send an empty list: when narrowing leaves no repository or owner
to ask about, Terminay SHALL send no query to that source and SHALL treat its
result as empty. When several restrictions apply (a project binding, the
Repositories setting, and a filter the client chose), Terminay SHALL send
their intersection.

A page SHALL carry its items ordered by most recently updated first, an
optional next cursor, and a total count when the forge reports one. A page MAY
hold fewer items than the page size, or none, and still carry a next cursor.
Terminay SHALL bound how long a query or detail call may run and SHALL treat a
call that times out, fails, or returns an invalid page as that source's
failure for that query, shown to the user, without affecting other sources'
results.

#### Scenario: Paging

- **WHEN** a page carries a next cursor and the user scrolls to the end of the
  list
- **THEN** Terminay asks the same source for the next page with that cursor

#### Scenario: Nothing left to ask about

- **WHEN** the Repositories setting is Repos of open projects and no project
  claimed by that source is open
- **THEN** that source is sent no query and contributes no items

#### Scenario: One source fails

- **WHEN** the GitHub source times out and the Gitea source answers
- **THEN** the Gitea items are shown and the list says that GitHub could not be
  reached

### Requirement: Host forge service

Terminay Server SHALL own a forge service. For each query a client makes, the
service SHALL ask every enabled source that serves the kind, once per account,
and SHALL merge the valid items into one list ordered by most recently updated
first, removing an item that two accounts both return. The service SHALL
return at most the requested page size and SHALL return an item only when no
source that still has further pages could return a more recently updated one;
items held back SHALL be returned first on the next page. The client's
continuation SHALL be an opaque token issued by the service that records each
account's cursor and held-back items; a source's cursor SHALL NOT reach a
client. A merged page MAY be shorter than the page size.

The service SHALL keep each account's last valid page per query in memory for
at most 60 seconds and SHALL answer a repeat of the same query within that
time from memory unless the client asks for a fresh result. It SHALL drop a
source's cached pages when that source invalidates them, when its extension is
disabled or its host fails, or when its accounts or settings change. A result
that arrives for a call started before such a drop SHALL be discarded. Nothing
a source returns SHALL be written to disk.

#### Scenario: Two clients ask the same question

- **WHEN** two clients open Home › Pull Requests with the same scope within 60
  seconds
- **THEN** each source is asked once per account

#### Scenario: Explicit refresh

- **WHEN** a user activates Refresh on a list
- **THEN** every source is asked again, whatever the cache holds

#### Scenario: Merging two sources

- **WHEN** GitHub's first page ends with an item updated at 10:00 and has more
  pages, and Gitea returns an item updated at 09:00
- **THEN** the Gitea item is not returned until GitHub's next page shows that
  nothing more recent than 09:00 remains

#### Scenario: Extension disabled while a query runs

- **WHEN** the Gitea extension is disabled while a Gitea query is in flight
- **THEN** that query's result is discarded, its items disappear from every
  list, and nothing is kept for it

### Requirement: Forge protocol availability

A server SHALL advertise the forge operations in its protocol capabilities. A
client SHALL treat a server that does not advertise them as having no forge
source, and SHALL show no forge section, tab, or setting for it.

#### Scenario: Older server

- **WHEN** a client connects to a server that does not advertise forge
  operations
- **THEN** Home shows no Pull Requests or Issues section and no request is made

### Requirement: On-demand freshness

Forge lists SHALL be refreshed only on demand: when a list or a Home section
badge is shown, when its query changes, when the user activates Refresh, when
the window or tab showing it regains focus, when a project's repository context
is re-issued for a repository in the query, and when a source reports that its
results changed. Terminay SHALL NOT refresh a forge list or badge on a timer. A
list SHALL show when its results were last fetched. A client SHALL ignore a
response to a query it has since replaced.

#### Scenario: List left open

- **WHEN** a user leaves Home › Issues open and does nothing for ten minutes
- **THEN** no forge request is made in that time, and the list says when it was
  last fetched

#### Scenario: Returning to the window

- **WHEN** the window showing Home › Pull Requests regains focus after its
  results were fetched more than 60 seconds ago
- **THEN** the list is refreshed

#### Scenario: Source invalidates

- **WHEN** a source reports that results for an origin changed
- **THEN** visible lists that include that origin are refreshed

#### Scenario: Scope changed before results arrive

- **WHEN** a user selects Mine and then All before Mine's results arrive
- **THEN** the list shows only All's results

### Requirement: Forge authority

Forge queries, details, claims, and accounts SHALL require read scope. A client
whose authorization is bound to one project SHALL only be able to query, and
fetch the detail of, items in repositories claimed for that project's remotes,
and SHALL NOT see Home's Pull Requests or Issues sections or any account
listing. Terminay SHALL check a detail request's repository against the same
authority before consulting its cache or a source. A client whose authorization
is not bound to a project SHALL be able to query every scope. Forge settings
and account changes SHALL require admin scope. Credentials SHALL NOT appear in
any response, event, log, or error.

#### Scenario: Project-bound client

- **WHEN** a client authorized only for project A asks for pull requests with
  scope `all` and no repository list
- **THEN** the query is narrowed to the repositories claimed for project A

#### Scenario: Project-bound client asks for another repository

- **WHEN** a client authorized only for project A asks for issues in a
  repository that project A's remotes do not map to
- **THEN** the request is refused

#### Scenario: Cached detail of another repository

- **WHEN** an unbound client has loaded the detail of an item in `owner/secret`
  and a client bound to project A, which does not map to `owner/secret`, asks
  for the same item within 60 seconds
- **THEN** the request is refused and nothing from the cache is returned

### Requirement: Forge accounts

Terminay SHALL list each forge source's accounts in that extension's Settings,
naming the origin, the login, and where the credential came from. A source
SHALL report one account per origin, using the credential its worktree insight
source would use for that origin; another credential it finds for the same
origin SHALL NOT add a second account. An account whose credential the forge
rejected SHALL be shown as such with a **Sign in…** action that collects a
token through the existing sign-in prompt. **Add account…** SHALL collect an
HTTPS origin and a token, SHALL ask the source to claim the origin before
storing anything, and SHALL store the token in the server vault bound to the
extension and origin. An account a source discovers from a CLI configuration
SHALL NOT be removable in Terminay; an account added through sign-in SHALL be
removable, which deletes its vault binding.

#### Scenario: tea login discovered

- **WHEN** `tea`'s configuration has a login for `https://git.example.net`
- **THEN** Settings › Extensions › Gitea lists `git.example.net` with its login
  and says it came from the tea configuration

#### Scenario: Two credentials for one origin

- **WHEN** `tea`'s configuration has two logins for `https://git.example.net`
- **THEN** one account is listed for that origin

#### Scenario: Adding an origin the source does not claim

- **WHEN** a user adds `https://example.com` to the Gitea extension and the
  origin is not a Gitea server
- **THEN** nothing is stored and the user is told the origin is not a Gitea
  server

### Requirement: Forge settings

Each extension with a forge source SHALL have, in its Settings, a
**Repositories** choice of **Everything I can access** (the default), **Repos
of open projects**, or **Chosen owners** with a switch per owner its accounts
can act for, and switches for **Pull requests on Home**, **Issues on Home**,
and **Project Git tab**, each on by default. When the source's `all` reach is
`owners`, the Settings SHALL say that the All scope covers the account's own
and its organisations' repositories. The settings SHALL be server-scoped and
stored by Terminay, not by the extension. Terminay SHALL apply them by
narrowing the queries it sends: **Repos of open projects** sends the
repositories claimed for open projects; **Chosen owners** sends the chosen
owners, and with none chosen sends nothing. A switched-off feature SHALL send
no queries to that source for that feature.

#### Scenario: Repos of open projects

- **WHEN** GitHub's Repositories choice is Repos of open projects and only a
  project for `owner/app` is open
- **THEN** GitHub queries for Home carry only `owner/app`

#### Scenario: No owner chosen

- **WHEN** Gitea's Repositories choice is Chosen owners and no owner is
  switched on
- **THEN** Home sends no queries to the Gitea source

#### Scenario: Issues switched off

- **WHEN** a user switches off Issues on Home for Gitea
- **THEN** Home › Issues sends no queries to the Gitea source
