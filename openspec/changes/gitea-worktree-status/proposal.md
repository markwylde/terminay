## Why

A developer working across several worktrees cannot see, from the Git sidebar,
whether a worktree's branch has a pull request or whether that pull request's CI
is passing, failing, or still running. They leave Terminay for the forge's web
UI, or run `tea` by hand, once per branch, repeatedly. Terminay's own
repository lives on a self-hosted Gitea, so this is felt every day.

Today no extension can put anything on a worktree row: the extension platform
has no worktree-facing contribution, and sidebar rendering is host-owned by
contract. Forge knowledge (URLs, APIs, authentication) belongs in an extension;
the row UI belongs to Terminay.

## What Changes

- Terminay defines a generic, host-owned set of **worktree properties** — a pull
  request (number, title, URL, state, mergeability) and a checks summary
  (passed, failed, pending, skipped, total, plus bounded per-check items with
  links). The Worktrees panel renders them with its own components: a pull
  request chip that opens the pull request, and a checks chip that opens a
  host-rendered list of checks, each linking to its run.
- A new extension contribution, `worktreeInsights`, and permission,
  `worktree-observation`, let an extension receive a host-issued repository
  context (repository root, remotes, worktrees with branch, upstream, and head)
  and publish validated worktree properties for worktrees in that context only.
- A host-mediated **provider sign-in** surface: an extension reports that a
  forge host needs a credential; Terminay shows an onboarding prompt with
  **Yes**, **No, maybe later**, and **Don't ask me about Gitea again**, collects
  a token through the declarative secret field, and stores it in the server
  vault bound to the extension and that forge origin.
- A new bundled extension, `terminay-gitea` (`com.terminay.gitea`), which:
  - detects a Gitea origin from the project's `origin` remote by probing
    `https://<host>/api/v1/version`;
  - reuses a matching `tea` login token read from the `tea` config file (held
    in memory only, never re-read per poll and never shelled out to `tea`),
    otherwise requests sign-in;
  - uses `fetch` against the Gitea REST API: one pull-request listing per
    repository and one combined commit status per worktree branch, once a
    minute while the project is open, and immediately when the host re-issues
    the context after a local ref change.

## Capabilities

### New Capabilities

- `worktree-properties`: the host-owned, provider-neutral worktree property
  model (pull request, checks), its presentation and interactions in the
  Worktrees panel, the provider sign-in prompt and its three choices, and the
  project-scoped delivery of properties to clients.

### Modified Capabilities

- `extension-platform`: adds the `worktreeInsights` contribution and the
  `worktree-observation` permission to the bounded API scope and contribution
  arrays; host-issued repository context; validated publication scoped to issued
  worktrees; per-origin vault bindings for sign-in.
- `built-in-extensions`: adds the bundled Gitea extension and its detection,
  credential, and refresh behaviour.
- `git-worktrees-and-quick-push`: worktree rows show extension-published
  worktree properties.

## Impact

- `packages/extension-api`: manifest types and validation for
  `contributes.worktreeInsights` and `worktree-observation`;
  `context.worktrees.registerInsightSource(...)`; property and sign-in DTO
  types. Minor API version bump.
- `packages/server-core/src/extensions`: host-side insight registry, repository
  context issuance (from `GitService`), property validation and bounding,
  sign-in state, vault bindings per origin.
- `packages/server-core/src/gitService`: emits repository-context changes
  (worktree set, branch, upstream, head) to the insight registry.
- Application protocol: project-scoped worktree-property snapshot and change
  events; sign-in prompt state and responses.
- `src/components/git-panel/WorktreesPanel.tsx`: property chips and checks
  popover; `src/` onboarding modal.
- New package `extensions/gitea/`, listed in `extensions/builtins.json` and the
  built-in artifact inventory.
- Network: outbound HTTPS from the server to Gitea hosts the user's remotes
  already point at. No hosted-service involvement.
