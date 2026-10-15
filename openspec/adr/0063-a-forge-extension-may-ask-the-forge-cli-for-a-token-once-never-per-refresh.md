# ADR-0063: A forge extension may ask the forge's CLI for a token once, and never per refresh

Status: accepted
Date: 2026-10-16

## Context

Forge extensions (ADR-0029) need a token for each forge origin. The Gitea
extension reads `tea`'s config file and never runs `tea`. That works because
`tea` keeps tokens in plain YAML.

The GitHub CLI does not, by default. Since gh 2.24 it stores the token in the
system keychain, and `hosts.yml` then lists the host and user with no
`oauth_token`. Reading the file alone misses most `gh` users. They would have
to create and paste a second token for an identity their machine already holds.
The portable way to get that token is `gh auth token --hostname <host>`, which
is a process spawn.

ADR-0021 makes spawning per sampling interval a design error, and forge status
is refreshed on an approved poll (ADR-0028). A forge extension that ran its CLI
on each refresh, for example `gh api graphql`, would spawn every 10 seconds per
active project.

## Decision

1. **A forge extension reads a forge CLI's credential file before anything
   else, and runs the CLI only when the file shows a login whose token it does
   not hold.** A user with no CLI login causes no spawn.
2. **That run happens at most once per origin per token lifetime.** The token
   is kept in memory, and the CLI runs again only after the forge rejects the
   token (401) or the CLI's credential file changes on disk (observed by a
   watch). A failed run (missing binary, non-zero exit, timeout) is remembered
   until the file changes.
3. **The refresh path never spawns.** Forge state is fetched over HTTPS with
   `fetch`. A CLI is never the transport for forge API calls.
4. **The run is bounded.** It uses `execFile` with no shell, fixed arguments, a
   timeout of a few seconds, and stderr discarded. The token stays in the
   extension child and never reaches DTOs, logs, or errors.

## Consequences

- `terminay-github` gets keychain-held `gh` tokens with at most one spawn per
  host per session in the common case.
- A spawn-per-idle-second measurement (ADR-0021) of a forge extension stays at
  zero after its first refresh.
- A future GitLab extension may use `glab auth token`-style commands under the
  same rule. `terminay-gitea` needs none, because `tea` keeps its token in the
  file.
