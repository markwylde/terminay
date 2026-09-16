## Context

The connection registry keeps a connection's feature context mounted while it
remakes the transport: `onAttemptStart` with `recovering` sets the phase to
`reconnecting` and leaves the context in place, so the workspace stays
mounted on a client that is closed. Two things then fail on that client
before the replacement arrives:

- The Git workspace refresh schedule fires `git.worktrees.list`, which
  rejects with a `disconnected` or `unavailable` `ClientError`. The project's
  `reportFeatureFailure` turns that into "Git is temporarily unavailable.
  Reconnect to … and retry git.worktrees.list." in the banner.
- The terminal's presentation renewal timer calls `changePresentation('renew')`
  on the dead attachment. The rejection is not an ownership error, so
  `failServerTransport` shows "terminal presentation renewal failed: …" with
  **Retry connection**.

Both already self-heal: the next successful Git refresh clears the banner,
and the rebind onto the replacement client clears the panel error. The
problem is only what is shown in between, under the reconnecting overlay.

No security or architectural boundary is crossed. This is renderer
presentation reading state the renderer already holds (ADR-0011, ADR-0018).

## Goals / Non-Goals

**Goals:**

- One visible statement of the outage while reconnecting: the overlay.
- Failures the server actually answered with stay visible.
- Nothing about recovery, rebind, or retry timing changes.

**Non-Goals:**

- Suppressing errors when the connection is `unreachable` or `incompatible`.
  Those are terminal states with their own actionable surface, and a feature
  failure alongside them is real information.
- Changing the overlay copy or the shell's connecting surface.
- Stopping the Git refresh schedule or the presentation renewal timer from
  running against a dying client. The scheduler already backs off on failure
  and the renewal is what keeps the controller lease live; both must keep
  trying so recovery is not delayed.

## Decisions

- **Read the owning connection's phase from `useServerConnection`, keyed by
  the surface's `serverId`, rather than adding the phase to the terminal
  client context.** The client context's identity is what triggers a
  terminal rebind, so anything that changes on every phase flip cannot live
  there. The connections context already publishes the phase per server, and
  a surface outside a `ConnectionsProvider` gets the empty context and no
  suppression, which is the inert default the context documents.
- **Suppress only `reconnecting`, not `connecting`.** A project or terminal
  is not mounted before the first connection succeeds, so `connecting` never
  reaches these surfaces in practice, and naming only the phase that does
  keeps the rule readable.
- **Classify by `ClientError` code, not by message.** `disconnected`,
  `unavailable`, and `deadline` are the codes `describeFeatureFailure` already
  maps to "temporarily unavailable. Reconnect to …", so the new predicate
  shares that boundary instead of inventing another.
- **Guard at report time and again on the phase flip.** A closing client can
  reject an in-flight query before the registry's `changed()` reaches React,
  so the banner can be set a frame early. The report-time guard covers the
  common case; an effect on the reconnecting flag retires a transport notice
  that was already visible. Both use the same `transport` flag recorded on
  the visible failure, so a feature refusal is never retired by mistake.
- **Keep the terminal panel's error state and only hide its rendering.** The
  attachment machinery in `failServerTransport` is untouched: the error is
  still recorded, the diagnostics still fire, and the rebind still clears it.
  Hiding at render keeps the recovery path identical and the change local.
- **Keep `reportFeatureFailure`'s identity stable by reading the phase
  through a ref.** The Settings error effect re-reports whenever that
  callback changes; keying it on the phase would replay a settings failure on
  every reconnect.

## Risks / Trade-offs

- [A transport failure that arrives while the registry still reports `ready`
  and never flips to `reconnecting` stays visible.] → Intended. Without a
  reconnect in progress there is nothing else telling the person, and the
  next successful refresh still clears it.
- [The terminal error is hidden rather than cleared, so if a reconnect
  succeeded without rebinding the panel the stale error would reappear.] →
  The rebind effect keys on the replacement client, which every successful
  attempt creates, so the panel is always rebound before the phase returns to
  `ready`.

## Migration Plan

None. Renderer-only; it takes effect on next load.

## Open Questions

None.
