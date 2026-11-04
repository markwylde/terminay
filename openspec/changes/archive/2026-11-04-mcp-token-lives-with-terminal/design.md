## Context

`ControlCapabilityStore` stamps each capability with `expiresAt = issuedAt +
ttlMs`; Desktop sets `ttlMs` to 24 hours (default 15 minutes). `resolve`
revokes a capability past its expiry, `snapshot` omits it, and `restore` refuses
it. The raw token exists only in the terminal's launch environment, so once the
server forgets a capability nothing can reissue it to that shell.

Terminal exit already revokes through `onTerminalExit`, wired to the PTY exit
event in `electron/main.ts`.

## Goals / Non-Goals

**Goals:**

- A running terminal's token works for as long as the terminal runs.
- Capabilities cannot accumulate for terminals that no longer exist.

**Non-Goals:**

- Delivering a replacement token to a terminal that changed project; that
  remains revocation-or-replacement as specified.
- Recovering terminals whose tokens already expired before this change.

## Decisions

- **Lifetime is the terminal's, not a clock's.** The time limit protected
  nothing the boundary needs: the token is already confined to its terminal's
  scope and to the local socket, and every child of the shell holds it for the
  shell's life. Expiring it only broke long-lived terminals. Revocation on exit,
  move, shutdown, and MCP disablement stays the security boundary (ADR-0011).
- **Prune by liveness.** `prune(runningSessions)` revokes every capability
  whose terminal session is not in the server's running set, through the normal
  revocation path, so listeners (MCP approvals, persistence) follow. Desktop
  runs it after restoring saved capabilities and every 24 hours on an unref'd
  timer. This catches an exit event lost to a crash or race without a timer on
  any live token.
- **Persisted entries lose `expiresAt`.** The parser accepts entries with or
  without it and ignores it, so a file from an earlier build restores the
  capabilities it still holds.

## Risks / Trade-offs

- A capability now lives for weeks if its terminal does. It stays bound to that
  terminal's session and scope, and to a socket only the local user can reach,
  so its reach is unchanged.
