# ADR review

ADR review is complete for this change.

## In-force ADRs reviewed

- ADR-0035: session holder. Terminals outlive the server and are re-adopted under the same session id.
- ADR-0051: Terminay observes agents and does not instrument them. The fix stays in Terminay and Git, with nothing done by the agent.
- ADR-0052: Git Trace2 reporting. Superseded here, because its per-session random token and per-run socket do not survive a restart.
- ADR-0054: local sockets with a fixed address go in the data directory, or in an owner-only runtime directory named for it. Followed for the Git socket.

## New ADRs

- [ADR-0069](../../adr/0069-git-command-reports-reach-the-server-across-restarts.md): Git command reports reach the server across restarts. The socket has a fixed address placed by ADR-0054. Each session's token is derived from its id with a key private to the data directory. Only one run listens at a time, and a stale socket is replaced. ADR-0052's other decisions are carried forward unchanged. Supersedes ADR-0052.
