## Context

`remote-server-in-app-upgrade` lets a person upgrade an attached server from
the connection menu (ADR-0062). After confirming, the dialog closes, the menu
row says "Upgrading…", and the server's restart reaches the person as ordinary
connection faults:

- `src/web/main.tsx` dims the workspace under "Terminal stream stalled.
  Reconnecting…" or the registry's "Connection lost. Reconnecting…" error.
- `ConnectionsControl.describeConnection` reports "Reconnecting…".
- `ConnectedRendererWorkspace` keys `App` by `serverId:connectionGeneration`,
  so every reconnect unmounts the workspace, the dialog, and the
  `ServerUpgradeBoard` that `useServerUpgrades` creates and disposes. The board
  survives only through its per-device memory in `localStorage`.

A window shows one server (`one-window-one-server`): its primary connection.
The connection registry can still attach other servers, which appear in the
connection menu but never take over the window.

The board already tracks what a ticklist needs: whether it follows an upgrade
(started here or seen in-progress), whether the connection dropped under it,
whether a new client came back, the one return deadline, and the outcome.

## Goals / Non-Goals

**Goals:**

- One progress presentation for one upgrade of the window's server, from
  acceptance to outcome, that survives the workspace remounting on reconnect
  and a document reload.
- The restart's disconnect reads as a step running, never as a stall or error.
- Every way a followed upgrade can end has a truthful final state.
- No protocol, server, or host change.

**Non-Goals:**

- Server-published sub-phases (download, verify, switch). The server is gone
  for the part that matters; finer phases would need a protocol change.
- A card for an attached server that is not the window's own. Its menu row
  names the running step; its drop does not cover the window.
- Showing the card on the shell's full-page "Connecting…" screen before the
  first connection after a reload has identified the server.
- Changing how reconnects for any other reason are presented.

## Decisions

### One lifecycle owner: a board host inside `ConnectionsProvider`

New `ServerUpgradeBoardHost` (`src/workspace/ServerUpgradeBoardHost.tsx`)
is rendered by the shell inside `ConnectionsProvider`, around both the
reconnecting overlay and `ConnectedWebRendererWorkspace`. It:

- creates the one `ServerUpgradeBoard` with the per-device memory, and
  disposes it on its own unmount;
- calls `board.sync` from `useConnections()` (connections and profiles), which
  `ConnectionsProvider` keeps current whether or not `App` is mounted, so
  replacement clients, phase changes, attach and detach all reach the board
  while the workspace is away;
- provides the board through a React context.

`useServerUpgrades` stops creating, syncing and disposing a board. It reads the
provided one and derives rows, notices and the confirmation. Without a provider
(unit tests, other compositions) it falls back to owning one, exactly as today.

*Alternative:* keep `App` syncing and feed the shell's primary phase in
separately. Rejected: two feeders for one model, and the gap while `App` is
unmounted is exactly when the steps change.

Boundary: renderer-only. The board reads what the connection registry and the
server's upgrade status already expose; nothing new crosses the preload or the
protocol.

### Steps are derived on the client

The board's snapshot gains `progress` per followed profile:
`{ profileId, label, mode, from, to, initiatedHere, hidden, steps[4], ended }`,
each step `{ id, label, state, detail? }`.

| Step | running when | done when | failed when |
| --- | --- | --- | --- |
| Starting the upgrade | never (the confirmation shows "Starting…") | at acceptance or a lost reply; at follow for an observer | — |
| Installing `<to>` | following, connection up, not dropped | dropped, or an outcome arrives | — |
| Restarting / Recreating the container | dropped and not returned | a status arrives on a new client, or the upgrader finished without a restart | deadline lapses, or phase `unreachable` |
| Running `<to>` | returned, outcome not yet known | `succeeded`; or `none` with `version === to` | `failed`; `none` on `from`; ready but silent at the deadline; phase `incompatible` |

The card appears only after acceptance, so **Starting** is always done on it:
the request's own pending state stays in the confirmation, refusals stay there,
and `markStarted` is called only on acceptance or a lost reply (as today), now
with `{ mode, to }` captured from the confirmed entry. A status that arrives
before the reply has already started following (observer path); `markStarted`
then upgrades the record to `initiatedHere` and fills in the mode and target.

The existing paths that today `unfollow` without an outcome (incompatible,
ready-but-silent at the deadline, `none` on the old version) now end the
progress with the failed step above instead of dropping it. Notifications are
unchanged for those three; `lost` keeps its notice. A record whose progress has
ended does not change again: a later return after `lost` updates the menu row
and nothing else.

Under ADR-0028 nothing polls: the steps move on the status subscription,
connection-phase changes, and the one existing return deadline.

### What is remembered

The per-device memory's `following` entry gains `initiated: true`, `mode` and
`to`. On `recall`, a remembered initiated upgrade restores the full card with
**Starting** and **Installing** done and **Restarting** running; an entry
without them restores as an observer. `recall` needs the server id, which the
connection learns from its hello, so the card returns once the reconnected
window identifies the server (non-goal above covers the earlier screen).

### Where the card is drawn

New `ServerUpgradeProgress` renders the ticklist (`role="status"`, the step
list as an ordered list with each state in text, not colour alone). The board
host draws it for the window's primary connection only:

- while that connection is reconnecting and its upgrade is followed: inside
  the reconnecting overlay, replacing the text and `LoadingDots` (the dim
  stays), regardless of `hidden`;
- otherwise, when `initiatedHere`, not `hidden`, and not closed: as a small
  card over the workspace at the same position.

`main.tsx` asks the board host whether to draw the overlay's own text. The
confirmation dialog closes on acceptance as today; the card the host then draws
is the confirmation "becoming" the progress. **Hide** (while connected, before
the end) sets `hidden`; **Close** (after the end) removes the progress record.

### Status and menu row wording

`describeConnection` takes an optional `upgradeRestarting` flag that the board
host passes down with the connection, and reports "Restarting for upgrade…"
(pending tone) instead of "Reconnecting…". `ServerUpgradeRow` gains `step?:
string` (the running step's label) and the row prints it in place of
"Upgrading…" for every attached server, primary or not. The registry's `error`
text is unchanged; it is not drawn while the card is.

## Risks / Trade-offs

- [A long-running card covers the workspace] → Only on the device that started
  it, small, hideable while connected; on observers only while the workspace is
  unusable anyway.
- [The board now outlives `App`] → It is disposed by the board host, which
  lives as long as the shell's connected composition; tests prove `App`'s
  unmount neither disposes it nor leaves a stale subscription or timer.
- [Ordering against `remote-server-in-app-upgrade`] → This change modifies a
  requirement that change adds; it archives after that one, and
  `openspec validate --all` is re-run after that archive.

## Migration Plan

Client-only. Memory entries without the new fields read as observed upgrades.
Rolling back drops the card and restores the "Upgrading…" text.

## Open Questions

None.
