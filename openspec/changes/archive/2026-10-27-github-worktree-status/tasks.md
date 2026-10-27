## 1. Package scaffold and inventory

- [x] 1.1 Scaffold `extensions/github` (`terminay-github`, `com.terminay.github`, insight source `com.terminay.github/github`, permissions `network` and `worktree-observation`) from `extensions/gitea`'s `package.json`, `tsconfig.json`, and LICENSE. Verify with `npm run typecheck --workspace terminay-github`.
- [x] 1.2 Register it in `extensions/builtins.json`, `packages/server-core/src/extensions/catalog.ts`, `scripts/stage-built-in-extensions.mjs`, `scripts/verify-built-in-extension-artifacts.mjs`, `turbo.json`, the root `test:agent-extension-packages` script, `Dockerfile`, and `Dockerfile.e2e-base`. Verify with the built-in staging/inventory tests and `packages/server-core/test/extension-installer.test.mjs`.

## 2. Detection

- [x] 2.1 Copy remote parsing and the HTTPS helpers from `terminay-gitea`. Map `https://github.com` to API base `https://api.github.com`, and any other origin to `<origin>/api`. Verify with unit tests for HTTPS, `ssh://`, and scp-style github.com and Enterprise remotes.
- [x] 2.2 Add the Enterprise probe on `<origin>/api/v3/meta`. It accepts an `x-github-enterprise-version` header (including on 401) or an `installed_version` body, caches verdicts for the process lifetime, and retries unreachable hosts after 10 minutes. github.com is never probed. Verify with unit tests using a fake fetch.

## 3. Credentials

- [x] 3.1 Environment tokens: `GH_TOKEN`/`GITHUB_TOKEN` for github.com, `GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` for other hosts. Verify with unit tests.
- [x] 3.2 `hosts.yml` path resolution (`GH_CONFIG_DIR`, `XDG_CONFIG_HOME`, Windows `AppData`, `~/.config/gh`) and a targeted parser for host → `oauth_token` / listed-without-token. Read once, watch, re-read on change. Verify with unit tests on fixture files, including the multi-user `users:` form and a keychain-backed entry.
- [x] 3.3 `gh auth token --hostname <host>` via an injected `execFile` (no shell, 5 s timeout). It runs only for a host listed without a token, at most once until a 401 or a `hosts.yml` change, and a failure is remembered. Verify with unit tests asserting the spawn count across many refreshes, after a rejection, and after a file change.
- [x] 3.4 Fall back to the vault, then sign-in (`provider: 'GitHub'`, github.com fine-grained token page or `<origin>/settings/tokens`). A 401 rejects the token that was used and tries the next source. Verify with unit tests for each fallback step.

## 4. Refresh

- [x] 4.1 GraphQL query builder: one aliased `ref` per distinct tracked branch, branch names as variables, chunks of 50, `rateLimit` selected. Verify with unit tests on the generated query and variables, including a branch name with quotes.
- [x] 4.2 Session and scheduler copied from Gitea, citing ADR-0028 and this change at the timer: 10 s active, 45 s inactive, immediate on issue, change, or focus, failure back-off, nothing after cancel. Verify with `extensions/github/test/refresh.test.mjs` using a fake clock and fetch, asserting exactly one request for five branched worktrees plus one detached.
- [x] 4.3 Rate-limit stop: `x-ratelimit-remaining: 0` with a reset, 403/429 with `retry-after`, or GraphQL `RATE_LIMITED` blocks the origin until the reported time. Verify with unit tests asserting no request before the reset.

## 5. Mapping

- [x] 5.1 Match pull requests by `headRefName` and same-repository `headRepository`. Map `isDraft` to the draft state and `mergeable` to the boolean, and take checks from the PR head, else the ref target. Verify with unit tests on recorded GitHub GraphQL JSON, including a fork's pull request.
- [x] 5.2 Map check-run and status-context states to passed, failed, pending, or skipped. Take counts from `…CountsByState`, cap items at 100 with failed and pending first, and keep only safe HTTPS links. Verify with unit tests covering every state in the spec.

## 6. Documentation and verification

- [x] 6.1 Write `extensions/github/README.md` (detection, credential order, the one `gh` spawn, cadence, rate limits, permissions, tests). Verify by review.
- [x] 6.2 `npm run lint`, `npm run typecheck --workspace terminay-github`, and `npm test --workspace terminay-github` pass (the root has no `typecheck` script). Verify with the command output.
- [x] 6.3 `openspec validate --all` passes. Verify with the command output.
- [x] 6.4 Run the real server stack with the built extension against a github.com repository with an open pull request and Actions checks, using the local `gh` login. Verify that the worktree lists its pull request and linked checks, and that the process table shows no `gh` spawn after the first refresh. Verified by driving the built runtime with real `fetch`, the real keychain-backed `gh` login, and the host `validateWorktreeProperties` against `markwylde/datasharp-company-linkage-test`: PR #6 with 6/6 linked checks, `main` with 3 passed and 2 skipped, a missing branch publishing nothing, 3 GraphQL requests over 3 refreshes, and 1 `gh` spawn. Activation inside the packaged desktop is covered by the packaged startup smoke, which now expects a healthy `terminay-github` card.
- [ ] 6.5 Open a pull request on `origin` (Gitea) and read back every commit status as `success` or `skipped`. Verify with `tea`/API output.
