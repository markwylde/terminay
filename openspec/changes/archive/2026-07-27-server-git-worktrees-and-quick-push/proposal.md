## Why

Git and provider CLI work was Electron-owned and addressed by renderer-selected
paths. Remote clients need the same project-scoped status and reviewed mutation
flow without receiving server credentials or raw command authority.

## What Changes

- **BREAKING** Move repository detection, branch and status, changed files,
  normalized diff, and refresh events into server-core, bound to a canonical
  project, repository, and worktree rather than a client-supplied path.
- Publish ordered `git.progress` and `git.status.changed` metadata with bounded
  revisions so client projections detect gaps and resync instead of inventing
  status transitions.
- Move worktree list, open terminal, switch project root, rename presentation,
  remove, and pull operations to the server, addressed by opaque worktree
  identities.
- Run Quick Push provider discovery, planning, and Git and remote commands on the
  server machine, producing a bounded structured proposal for explicit client
  review.
- Bind approval to the repository revision, target, and exact proposed actions,
  revalidate immediately before each mutation, and report deterministic partial
  failures.
- Keep Git, SSH, provider CLI, GitHub, and Gitea credentials in the server
  environment and vault, and never copy credential material into protocol
  snapshots or client settings.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `git-worktrees-and-quick-push`: the server becomes the only Git, worktree, and
  Quick Push execution authority, with a transport-independent reviewed workflow.

## Impact

server-core's Git and Git provider services, the `ServerGitAdapter` protocol
surface, the client Git contract, worktree lifecycle, the Quick Push review flow,
and the credential boundary for Git, SSH, GitHub, and Gitea.
