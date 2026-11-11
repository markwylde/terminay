## ADDED Requirements

### Requirement: Forge extensions discover every account

`terminay-gitea` and `terminay-github` SHALL each contribute a forge source
serving pull requests and issues, and SHALL declare the `forge-source`
permission. `terminay-gitea` SHALL declare its `all` reach as `readable` and
`terminay-github` as `owners`. `terminay-gitea` SHALL report one account for
each origin that has a `tea` login with a URL and token in `tea`'s
configuration or a token stored through sign-in. `terminay-github` SHALL
report one account for each host `gh`'s `hosts.yml` lists, for the environment
token's host, and for each origin with a token stored through sign-in. Where
an origin has several credentials, each SHALL use the one its worktree insight
source would use for that origin and report one account. Each extension SHALL
resolve an account's login, and the organisations it belongs to, by
authenticated requests to the forge's current-user endpoints the first time
the account's token is used, and SHALL report the account `rejected` when they
answer 401. Each SHALL obtain tokens exactly as its worktree insight source
does, SHALL run its CLI only under ADR-0063, and SHALL NOT run a CLI from a
query.

#### Scenario: Two tea logins

- **WHEN** `tea`'s configuration has logins for `https://git.a.net` and
  `https://git.b.net`
- **THEN** the Gitea forge source reports two accounts, each with its login

#### Scenario: gh keychain token

- **WHEN** `hosts.yml` lists `github.com` without an `oauth_token`
- **THEN** the GitHub forge source runs `gh auth token --hostname github.com` at
  most once, and reports the account with the source `cli`

### Requirement: Forge extensions claim their own remotes

Each forge source SHALL claim a remote only when the remote's origin is one it
detects as its forge by the same rules its worktree insight source uses, and
SHALL return the repository's owner and name from the remote path.

#### Scenario: Gitea remote over SSH

- **WHEN** Terminay asks the Gitea source to claim
  `ssh://git@git.example.net:4222/owner/repo.git` and
  `https://git.example.net/api/v1/version` returns a version
- **THEN** the source claims `owner/repo` on `https://git.example.net`

#### Scenario: GitHub remote asked of Gitea

- **WHEN** Terminay asks the Gitea source to claim `git@github.com:owner/repo.git`
- **THEN** the source claims nothing

### Requirement: Gitea forge queries

`terminay-gitea` SHALL answer each query with HTTPS requests to
`<origin>/api/v1/repos/issues/search` with `type` set to `pulls` or `issues`,
mapping `reviewRequested` to `review_requested=true`, `authored` to
`created=true`, `assigned` to `assigned=true`, and `mentioned` to
`mentioned=true`; `involved` SHALL merge the authored, assigned, mentioned, and
review-requested results without duplicates; `all` SHALL send no involvement
filter. A query naming owners SHALL send one request per owner with `owner`.
A query naming repositories SHALL request each repository's
`/repos/{owner}/{repo}/pulls` or `/issues` listing instead. When one query
needs several requests, the source SHALL merge their results by most recently
updated first, and its cursor SHALL record each request's own position so that
the next page continues each of them. State `merged` SHALL request closed pull
requests and keep those that were merged, and MAY return a page with fewer
items than asked for, with a next cursor. Checks for
a pull request summary SHALL come from the head commit's combined status,
mapped as the worktree insight source maps it. Detail SHALL come from the
item's endpoint and its comments endpoint. A 401 SHALL mark the account
rejected.

#### Scenario: Needs my review

- **WHEN** Terminay queries Gitea pull requests with scope `reviewRequested` and
  state `open`
- **THEN** the source requests `/repos/issues/search?type=pulls&state=open&review_requested=true`

#### Scenario: Merged pull requests

- **WHEN** Terminay queries Gitea pull requests with state `merged`
- **THEN** only closed pull requests that were merged are returned

#### Scenario: Involved over several pages

- **WHEN** Terminay asks for the second page of Gitea pull requests with scope
  `involved`
- **THEN** each of the four filtered requests continues from where its first
  page ended, and no pull request appears on both pages

### Requirement: GitHub forge queries

`terminay-github` SHALL answer each query with one GitHub GraphQL `search`
request per account, building the search string from fixed qualifiers and
passing it as a variable: `is:pr` or `is:issue`; `review-requested:@me`,
`author:@me`, `assignee:@me`, `mentions:@me`, or `involves:@me` for the scope;
`is:open`, `is:merged`, or `is:closed` for the state; `repo:` per named
repository; and `user:` or `org:` per owner. For scope `all` with no
repositories or owners, it SHALL search the account's own login and every
organisation it belongs to, as its declared `owners` reach says. User text SHALL be passed only as a quoted search
term. Pull request summaries SHALL include the head commit's check rollup,
mapped as the worktree insight source maps it. When GitHub reports its rate
limit exhausted, the source SHALL make no request to that origin before the
reset time.

#### Scenario: Involved pull requests

- **WHEN** Terminay queries GitHub pull requests with scope `involved` and state
  `open`
- **THEN** the source searches `is:pr is:open involves:@me`

#### Scenario: Qualifier in user text

- **WHEN** the text filter is `repo:other/secret`
- **THEN** it is searched as a quoted term and does not add a repository
  qualifier

### Requirement: Agent launchers declare initial prompts

The built-in agents extension SHALL declare `initialPrompt: "positional"` on its
Claude Code and Codex launchers, whose programs accept an initial prompt as
their first positional argument, and on no other launcher.

#### Scenario: Claude Code launcher

- **WHEN** the built-in agents manifest is validated
- **THEN** the Claude Code and Codex launchers declare `initialPrompt` and no
  other launcher does
