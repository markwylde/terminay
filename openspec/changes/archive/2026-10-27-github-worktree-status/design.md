## Context

Change `gitea-worktree-status` built the provider-neutral half of forge status:
the worktree property model, the host-issued repository context, project-scoped
delivery, the Worktrees table with PR and CI columns, and the provider sign-in
prompt (ADR-0029). It shipped one provider, `terminay-gitea`. The sign-in
dialog and the Settings re-enable switch already take the provider name from
the extension, so a second provider needs no host, protocol, or UI work.

GitHub differs from Gitea in four ways that shape this design:

- **API shape.** Gitea's REST API has one combined status per ref. GitHub
  splits CI into *check runs* (Actions and GitHub Apps) and *commit statuses*
  (older integrations). The REST equivalent of one Gitea refresh is
  `1 + 2N` requests, plus one per pull request for `mergeable`, which the list
  endpoint leaves out.
- **Rate limit.** An authenticated REST client gets 5,000 requests an hour. At
  the 10 s active cadence a single repository with five worktrees would use
  about 4,000 of them. GraphQL is costed in points, and a query of this size
  costs 1 point.
- **Credentials.** `gh` stores its token in the system keychain by default
  (since gh 2.24), and `hosts.yml` then lists the host and user without an
  `oauth_token`. A file read alone, like the tea config, therefore misses most
  `gh` users.
- **Hosts.** `github.com` serves its API from `api.github.com`. GitHub
  Enterprise Server serves it from `<origin>/api/v3` and `<origin>/api/graphql`.

In-force ADRs that constrain this design: ADR-0029 (typed host-owned worktree
facts; any other forge poll needs its own approval), ADR-0028 (no polling
without owner approval), ADR-0021 (count spawns; never spawn per sampling
interval), ADR-0011 (trusted extensions, credential-free links), ADR-0003
(vault), ADR-0017 (forge requests run on the server that owns the project),
ADR-0026 (extension packaging; no native modules needed).

## Goals / Non-Goals

**Goals:**

- Feature parity with `terminay-gitea` for GitHub and GitHub Enterprise Server:
  pull request, mergeability, draft state, CI checks with links, sign-in.
- One HTTPS request per repository per refresh, so the approved cadence fits
  well inside GitHub's rate limit.
- Pick up an existing `gh` login, including one kept in the keychain, without
  spawning on a refresh.

**Non-Goals:**

- Creating, merging, or reviewing pull requests; re-running workflows.
- GitHub webhooks (need inbound reachability) or a GitHub App / OAuth device
  flow (needs a registered app per Enterprise host).
- GitHub Enterprise Cloud with data residency (`*.ghe.com`). Its API host
  is `api.<subdomain>.ghe.com`. It can be added later as a known-host rule.
- A shared forge library for the two extensions (see decision 6).

## Decisions

### 1. Detection: known host, then an Enterprise probe

`github.com` is GitHub without a request. For any other host, ask
`<origin>/api/v3/meta` unauthenticated. GHES puts an
`x-github-enterprise-version` header on every API response, including the 401
it sends in private mode, and a public instance's `meta` body carries
`installed_version`. Either one is a verdict. The probe cache works like the
Gitea one: an answer is kept for the process lifetime, and an unreachable host
is asked again after 10 minutes.

Alternative: treat a host as GitHub only when its name contains "github".
Rejected because Enterprise hostnames are arbitrary.

Both forge extensions now probe each host neither recognises: one request each,
cached. That is accepted.

### 2. One GraphQL query per repository per refresh

The query is built per refresh from the context's tracked branches. It uses
one aliased `ref` per distinct branch:

```graphql
query($owner: String!, $name: String!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    b0: ref(qualifiedName: "refs/heads/feat/x") {
      target { ... on Commit { ...Rollup } }
      associatedPullRequests(states: OPEN, first: 5) {
        nodes {
          number title url isDraft mergeable headRefName
          headRepository { nameWithOwner }
          headRefOid
          commits(last: 1) { nodes { commit { ...Rollup } } }
        }
      }
    }
    # b1, b2, … one per distinct tracked branch
  }
}
fragment Rollup on Commit {
  statusCheckRollup {
    contexts(first: 100) {
      totalCount checkRunCountsByState { state count }
      statusContextCountsByState { state count }
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      }
    }
  }
}
```

Branch names go in as GraphQL string variables (`$b0: String!`), not
interpolated, so a branch name cannot change the query. A branch the remote
does not have returns a null `ref` and publishes nothing for that worktree.
Distinct branches are capped at 50 per query; a context with more worktrees
than that is unusual and is split into several requests.

Matching keeps a pull request only when `headRefName` is the tracked branch and
`headRepository.nameWithOwner` equals the repository (case-insensitively).
Checks come from that pull request's head commit, else from the ref's target.
The `…CountsByState` totals feed the counts, so a commit with more than 100
checks still counts every one. Items are the first 100 returned, and the
mapping orders failed and pending first, as Gitea's does.

Alternatives: REST with ETags (a `304` does not count against the limit).
Rejected because it is still `1 + 2N + PRs` round trips per refresh, and a
change on any check invalidates the ETag anyway. Querying
`pullRequests(states: OPEN, first: 50)` plus refs: rejected because a busy
repository can have more than 50 open pull requests, while `ref → associated
pull requests` is exact.

### 3. Approved poll (ADR-0028), on the Gitea cadence

**Approved poll (ADR-0028):** the GitHub extension's per-repository refresh,
every **10 s** for a project a client has active and every **45 s** for any
other open project, plus an immediate refresh when a project becomes active
or its context is re-issued after a local change (push, branch switch, new
worktree), while that repository's context is live. No event source works:
forge state is remote, and GitHub webhooks need a server that GitHub can
reach, which a desktop server is not. Approved by the repository owner, Mark
Wylde, on **2026-10-16**, in the planning conversation for this change. He
answered "Yes" to "Keep Gitea's cadence: 10s active project, 45s others?". The
timer site in `extensions/github/src/refresh.ts` cites ADR-0028 and this
change.

Around it, everything follows Gitea: no schedule for cancelled contexts or a
disabled extension, nothing while sign-in is outstanding, failure back-off of
60 s → 2 m → 5 m → 10 m with a reset on success, at most four concurrent
requests per origin.

**Rate-limit respect.** A response with `x-ratelimit-remaining: 0`, a 403 or
429 that carries `retry-after`, or a GraphQL `RATE_LIMITED` error sets a
per-origin "not before" time. That is the reported reset, or `retry-after`
seconds later. No context on that origin requests anything before it. This is a
bounded retry after a failure (ADR-0028 decision 3), not a second poll. Budget:
one active project costs 360 points an hour and an inactive one 80, out of
5,000 per user per hour.

### 4. Credentials: environment, `hosts.yml`, one `gh auth token`, vault

The order follows `gh`'s own precedence, so Terminay sees the same identity as
`gh` in a terminal:

1. `GH_TOKEN`, then `GITHUB_TOKEN` for `github.com`; `GH_ENTERPRISE_TOKEN`, then
   `GITHUB_ENTERPRISE_TOKEN` for other hosts. These are read from the server
   process environment.
2. `hosts.yml` at `$GH_CONFIG_DIR/hosts.yml`, else
   `$XDG_CONFIG_HOME/gh/hosts.yml`, else `%AppData%\GitHub CLI\hosts.yml` on
   Windows and `~/.config/gh/hosts.yml` elsewhere (macOS included, as `gh`
   does). It is a top-level mapping of host to `{oauth_token, user, users:
   {…}}`. A targeted parser, like `parseTeaLogins`, reads it. The file is read
   once, watched, and re-read on change.
3. When `hosts.yml` lists the host without an `oauth_token`, the token is in
   the keychain. Run `gh auth token --hostname <host>` with `execFile` (no
   shell), a 5 s timeout, and a minimal environment, and take trimmed stdout.
   Keep the result in memory. Run it again only after that token gets a 401 or
   `hosts.yml` changes. A missing `gh` binary or a non-zero exit is remembered,
   so the command is not retried until `hosts.yml` changes.
4. The vault binding for `(com.terminay.github, origin)` through the existing
   sign-in prompt. The token page is
   `https://github.com/settings/personal-access-tokens/new` on github.com and
   `<origin>/settings/tokens` on Enterprise. The required access is read-only
   pull requests, commit statuses, and checks, or classic `repo` for private
   repositories.

Boundary: process and secrets. This is the first forge extension that spawns.
ADR-0021 forbids spawning per sampling interval. Here a spawn happens only for
a user who has a `gh` login, at most once per host per token lifetime, and
never from the refresh path. A refresh reads the in-memory token. ADR-0063
records that rule for every forge extension. The token never leaves the
extension child and never appears in DTOs, logs, or errors. `gh`'s stderr is
discarded.

Alternatives: read only `hosts.yml`, which misses keychain users (most of
them). Read the macOS keychain directly, which needs a native module or the
`security` CLI and is platform-specific, while `gh auth token` works on every
platform. Run `gh api graphql` on each refresh, which spawns per sampling
interval, contrary to ADR-0021.

### 5. Mapping

- `isDraft` → `draft`, otherwise `open`. GitHub has real drafts, so the WIP
  title heuristic Gitea needs is not applied.
- `mergeable`: `MERGEABLE` → true, `CONFLICTING` → false, `UNKNOWN` → absent.
  GitHub computes this lazily, and the next refresh fills it in.
- Check runs: `status != COMPLETED` → pending. Conclusion `SUCCESS` → passed;
  `FAILURE`, `TIMED_OUT`, `CANCELLED`, `STARTUP_FAILURE`, `ACTION_REQUIRED` →
  failed; `NEUTRAL`, `SKIPPED`, `STALE` → skipped.
- Commit statuses: `SUCCESS` → passed; `FAILURE`, `ERROR` → failed; `PENDING`,
  `EXPECTED` → pending.
- Item URL: `detailsUrl` or `targetUrl`, kept only when it is a credential-free
  HTTPS URL.

### 6. Copy the shared plumbing rather than extract a library

Remote parsing, the HTTPS helpers, the limiter, and the session and scheduler
shape in `refresh.ts` are about 350 lines. They are copied from
`terminay-gitea` into `terminay-github`. Each built-in is a self-contained
package whose only dependency is the `@terminay/extension-api` peer, and the
built-in packaging and inventory checks assume that. A third forge (GitLab)
would justify extracting a shared package. Two copies do not yet justify a new
package and its packaging work.

## Risks / Trade-offs

- [Several active projects on one GitHub account share 5,000 points an hour] →
  1 point per refresh keeps about 13 active projects in budget. The
  rate-limit stop above makes overrun pause rather than error-loop.
- [Up to 10 s / 45 s staleness after CI finishes] → same as Gitea, and a push
  re-issues the context at once.
- [`gh auth token` blocked or slow] → 5 s timeout. The failure is remembered and
  the extension falls through to sign-in.
- [The `hosts.yml` format changes] → defensive parsing, which falls through to
  sign-in.
- [GraphQL schema evolution] → fields used are long-stable public schema. A
  GraphQL `errors` entry that is not auth or rate limit counts as a failure and
  backs off.
- [Self-signed Enterprise TLS] → `fetch` fails and the host is "not GitHub". No
  TLS bypass, as with Gitea.

## Migration Plan

Additive. A new bundled extension, enabled by default, that does nothing for
non-GitHub repositories. Rollback: disable it in Settings → Extensions.

## Open Questions

- None blocking. A follow-up could add `*.ghe.com` as a known host.
