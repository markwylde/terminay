# Terminay Gitea extension

`terminay-gitea` is the official Gitea extension for Terminay. It shows each
worktree's pull request and CI status in the Git sidebar. It is an ordinary ESM
Node.js extension: it imports only `@terminay/extension-api` and public Node
APIs, and it contributes one worktree insight source, `com.terminay.gitea/gitea`.

The extension supplies facts. Terminay renders them. It publishes a
provider-neutral pull request (number, title, URL, open or draft, mergeability)
and a checks summary (passed, failed, pending, skipped, plus per-check links)
for each worktree in a repository context the host issues. It never draws UI.

## Detection

For each repository context it takes the `origin` remote, or the first remote
when there is no `origin`. It turns that remote into an HTTPS origin: HTTPS,
`ssh://user@host:port/owner/repo.git`, and `user@host:owner/repo.git` are all
understood, and the SSH user and port are dropped. It then asks
`<origin>/api/v1/version` without credentials. A server that answers with a
version is treated as Gitea (Forgejo answers the same way and works too). For
any other repository the extension publishes nothing and asks for nothing.

## Credentials

The extension never runs `tea`. It looks for a token in this order:

1. A `tea` login whose URL matches the origin. The token is read from `tea`'s
   own config file (`$XDG_CONFIG_HOME/tea/config.yml`, otherwise
   `~/Library/Application Support/tea/config.yml` on macOS and
   `~/.config/tea/config.yml` elsewhere). The file is read once and held in
   memory. It is read again only when it changes on disk.
2. A token the user stored for that origin through Terminay's sign-in prompt.
   Terminay keeps it in the server vault.
3. Neither: the extension asks Terminay to show the sign-in prompt, with a
   link to `<origin>/user/settings/applications`, where a token with
   `read:repository` scope can be created.

When Gitea answers `401`, the extension stops using that token. A stored token
is reported rejected, so Terminay forgets it and can prompt again.

## Refresh cadence

Remote forge state cannot be watched, so it is polled, and only as much as
needed:

- It refreshes at once when a context is issued, or re-issued after a local
  change such as a push or a branch switch.
- Otherwise it refreshes once every 60 seconds per repository. After
  consecutive failures the interval widens to 1, 2, 5, then 10 minutes, and one
  success resets it.
- Each refresh makes one `GET /repos/{owner}/{repo}/pulls?state=open` request,
  plus one `GET /repos/{owner}/{repo}/commits/{ref}/status` for each worktree
  whose branch has an upstream. `ref` is the pull request's head commit when
  one matches, and the upstream branch otherwise. At most four requests per
  server run at once.
- A cancelled context or a disabled extension schedules nothing. The
  extension spawns no processes; every request uses `fetch`.

Properties are published only when they change.

## Permissions

- `network`: HTTPS requests to the Gitea servers your remotes already point at.
- `worktree-observation`: receive repository contexts and publish worktree
  properties and sign-in requests for them.

## Tests

```sh
npm test --workspace terminay-gitea
```

The tests use a fake `fetch` and a fake clock. They cover remote parsing,
`tea` config parsing, probing, pull request matching and status mapping, the
request count per refresh, the 60-second floor, failure back-off,
cancellation, and the 401 fallback and sign-in flows.
