# Terminay GitHub extension

`terminay-github` is the official GitHub extension for Terminay. It shows each
worktree's pull request and CI status in the Git sidebar, for github.com and
GitHub Enterprise Server. It is an ordinary ESM Node.js extension: it imports
only `@terminay/extension-api` and public Node APIs, and it contributes one
worktree insight source, `com.terminay.github/github`.

The extension supplies facts. Terminay renders them. It publishes a
provider-neutral pull request (number, title, URL, open or draft, mergeability)
and a checks summary (passed, failed, pending, skipped, plus per-check links)
for each worktree in a repository context the host issues. It never draws UI.

## Detection

For each repository context it takes the `origin` remote, or the first remote
when there is no `origin`. It turns that remote into an HTTPS origin: HTTPS,
`ssh://user@host:port/owner/repo.git`, and `user@host:owner/repo.git` are all
understood, and the SSH user and port are dropped.

- `https://github.com` is GitHub, with no request made to find out.
- Any other host is asked `<origin>/api/v3/meta` without credentials. An
  `x-github-enterprise-version` header (GitHub Enterprise sends it even on the
  401 of a private-mode instance) or an `installed_version` in the body makes it
  GitHub Enterprise Server. Anything else publishes nothing and asks for
  nothing.

## Credentials

The extension looks for a token in this order, which is the order `gh` itself
uses:

1. The server's environment: `GH_TOKEN`, then `GITHUB_TOKEN` for github.com, or
   `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN` for Enterprise hosts.
2. An `oauth_token` for the host in `gh`'s `hosts.yml`
   (`$GH_CONFIG_DIR/hosts.yml`, otherwise `$XDG_CONFIG_HOME/gh/hosts.yml`, or
   `%AppData%\GitHub CLI\hosts.yml` on Windows and `~/.config/gh/hosts.yml`
   everywhere else). The file is read once and held in memory, and read again
   only when it changes on disk.
3. When `hosts.yml` lists the host but holds no token, `gh` keeps it in the
   system keychain. The extension then runs `gh auth token --hostname <host>`
   **once**, without a shell and with a 5-second timeout, and keeps the result
   in memory. It runs it again only after GitHub rejects that token or
   `hosts.yml` changes. A refresh never runs `gh` (ADR-0063). If you have no
   `gh` login, it never runs at all.
4. A token stored for that origin through Terminay's sign-in prompt, kept in
   the server vault.
5. None of these: it asks Terminay to show the sign-in prompt, with a link to
   create a fine-grained personal access token on github.com, or to
   `<origin>/settings/tokens` on Enterprise. The token needs read access to
   pull requests, commit statuses, and checks (or the classic `repo` scope for
   private repositories).

When GitHub answers `401`, the extension stops using that token. A stored token
is reported rejected, so Terminay forgets it and can prompt again.

## Refresh cadence

Remote forge state cannot be watched, so it is polled, and only as much as
needed:

- It refreshes at once when a context is issued, or re-issued after a local
  change such as a push or a branch switch.
- It refreshes at once when its project becomes active.
- Otherwise it refreshes every 10 seconds for an active project and every
  45 seconds for any other. After consecutive failures the interval widens to
  1, 2, 5, then 10 minutes, and one success resets it.
- Each refresh is **one** GraphQL request per repository, for up to 50
  distinct branches. It returns each branch's open pull requests,
  mergeability, and check rollup (GitHub Actions check runs and commit
  statuses together). A query this size costs 1 point of GitHub's 5,000 an
  hour, so an active project uses about 360 an hour and an inactive one 80.
- When GitHub reports the rate limit spent (`x-ratelimit-remaining: 0`,
  `retry-after`, or a `RATE_LIMITED` error), nothing is sent to that host until
  the reset time it reported.
- A cancelled context or a disabled extension schedules nothing.

Properties are published only when they change.

## Permissions

- `network`: HTTPS requests to `api.github.com` and to the GitHub Enterprise
  servers your remotes already point at.
- `worktree-observation`: receive repository contexts and publish worktree
  properties and sign-in requests for them.

## Tests

```sh
npm test --workspace terminay-github
```

The tests use a fake `fetch`, a fake clock, and a fake `gh`. They cover remote
parsing, the Enterprise probe, `hosts.yml` parsing and the credential order,
the `gh` spawn count across refreshes and rejections, query building, state
mapping, the one-request-per-refresh rule, the active and inactive floors,
failure back-off, rate-limit waits, cancellation, and the 401 fallback and
sign-in flows.
