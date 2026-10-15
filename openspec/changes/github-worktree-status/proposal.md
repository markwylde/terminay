## Why

A developer whose project lives on GitHub sees nothing in the Worktrees panel's
PR and CI columns. Those columns work only for Gitea projects. To find out
whether a branch has a pull request or whether its checks are green, they leave
Terminay for github.com, or run `gh pr checks` by hand, once per branch.

The host side is already provider-neutral (ADR-0029): worktree properties, the
table layout, the checks ring, and the sign-in prompt render the same for any
forge. Only the forge-specific half is missing, and it belongs in an extension.

## What Changes

- A new bundled extension, `terminay-github` (`com.terminay.github`), with the
  same features as `terminay-gitea`: each worktree's pull request (number,
  title, link, open or draft, mergeability) and CI checks (counts and linked
  items) in the Worktrees panel, plus the sign-in prompt when it has no token.
- Detection: `github.com` remotes are GitHub without a request. For any other
  host it probes `https://<host>/api/v3/meta` unauthenticated, and a GitHub
  Enterprise Server answer marks the host as GitHub.
- Credentials, in order: the `GH_TOKEN`/`GITHUB_TOKEN` environment variables
  (`GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` for Enterprise hosts), a
  token in the `gh` CLI's `hosts.yml`, then `gh auth token --hostname <host>`
  run **once** when `hosts.yml` lists the host but holds no token (the token
  is in the system keychain), then a token stored through sign-in.
- Refresh: one GraphQL request per repository per refresh, which returns every
  worktree's open pull request, mergeability, and check rollup together. The
  cadence matches Gitea: 10 s for an active project, 45 s for others, and at
  once on focus or after a local change. The repository owner approved this
  as a new poll under ADR-0028.
- Checks cover both GitHub check runs (Actions and apps) and commit statuses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `built-in-extensions`: adds the bundled GitHub extension and its detection,
  credential, refresh, and mapping requirements.

## Impact

- New package `extensions/github/` (`terminay-github`), listed in
  `extensions/builtins.json`, the server-core official catalogue
  (`packages/server-core/src/extensions/catalog.ts`), the built-in staging and
  verification scripts, `turbo.json`, the root `test:agent-extension-packages`
  script, and the `Dockerfile` / `Dockerfile.e2e-base` workspace manifests.
- Network: outbound HTTPS from the server to `api.github.com` or to the GitHub
  Enterprise hosts the user's remotes already point at.
- Process: at most one `gh auth token` spawn per host per token lifetime. It
  never runs on a refresh.
- No host, protocol, API, or UI changes. The extension API surface used is
  the one `terminay-gitea` uses (`worktreeInsights`, `worktree-observation`,
  `network`).
