## Context

`BuildBanner` stores dismissals in `localStorage` under
`<buildId>:<state>`, the last 20. `BotBuildTracker` retains only the latest
build in `bots/image-build.json` and gives each build a random id. The server
builds only when asked, or when `ensureImage` finds the image not current.

Two things can bring a dismissed notice back: the client loses its storage
(the framed PWA on iOS, ADR-0012, which fits the report; not reproduced on a
device), or the same image is built again under a new id.

## Goals / Non-Goals

**Goals:** a dismissed ready notice stays dismissed for that image, on every
client of the server.

**Non-Goals:** changing when the server builds; changing running, failed or
interrupted notices; fixing other state a framed session keeps on the device;
syncing an acknowledgement between different servers.

## Decisions

### The server owns the acknowledgement

It is a fact about a server-owned image, and no client storage is reliable
here. Rejected: a stable key in `localStorage` alone (does not survive the
framed PWA or reach other devices); a server setting (the value is bot-engine
state, with bot authority, not a user preference).

### Identity is engine identity plus image fingerprint

Both are already on the build record. The fingerprint covers the declared build
inputs (Dockerfile, copied files, agent installs, user ids, seccomp profile), so
the acknowledgement is of a build configuration. It does not identify resulting
bytes: an uncached rebuild can pick up newer packages from a repository and
still stay quiet. That is intended, since the user asked for nothing new.
Rejected:
build id (new on each build); engine image id (not on the record, and it can
change on a rebuild of identical inputs). Consequence: deleting an image and
rebuilding the same inputs stays quiet.

This also answers "should a cached no-op rebuild announce ready": no separate
no-op detection is needed. An unacknowledged image still announces.

### It lives in the build record

`image-build.json` gains an optional `acknowledged` list of
`{engineIdentity, fingerprint}`, newest last, at most 32. `start()` keeps it.
The record stays version 1, so an older server reads it and merely drops the
list. Loading is lenient for this field only: an absent or non-array list is
empty, invalid entries are skipped, duplicates collapse and only the newest 32
are kept. A bad notice list must not make the build record unreadable and put a
state recovery prompt in front of the user. The record as a whole still
recovers as `bot-builds` state does (ADR-0088). Rejected: a second state file,
which adds a store and its recovery for one list.

`acknowledge` writes the record with the new list first and updates memory only
after the write succeeds. A failed write throws, so the command fails, nothing
is published and the derived flag stays false.

### The wire carries a derived flag and a build id

`BotBuildProgress` gains optional `acknowledged: boolean`, computed in the
snapshot and true only for a completed build of an acknowledged image. It is
never persisted on the build. New command `bots.image.acknowledge` takes
`{buildId}`.

**Boundary:** this crosses the renderer-to-server boundary. The command is
gated by `assertBotAuthority`, as every bot engine operation is, so project,
session, capability, chat and MCP principals cannot call it. The client
supplies no image identity; the server reads it from its own record and ignores
any other id. The list holds no secrets or paths.

Recording bumps the progress revision, so the existing `bots.engine.changed`
event updates every client.

### The engine card keeps the finished build reachable

`bot-image-build-progress` requires the image controls to retain access to the
latest completed build, but only the notice opened the build page. A permanent
dismissal would remove that route for good, so the engine card gets a **Build
details** button while the latest build is completed. On a compact workspace it
closes the engine sheet and opens the page from the section's banner.

### The client keeps only an in-memory optimistic hide

A small module holds, per window and server, the build ids the user has dismissed
and those with a command in flight. Build ids never share acknowledgement state
between servers. The banner remounts when its server changes, keeping deferred
retirement attached to the server that showed it. Status reads are bound to their
client, and results from a retired connection cannot replace the current status.
Dismissing or retiring hides the notice on every surface and sends the command
from that same call, so it does not depend on a
banner still being mounted (seen-and-left retires after the last one unmounts).
While a mounted banner shows a hidden, completed build the server does not
report acknowledged, a new status makes it send again, one in flight per build.
Nothing is timed or polled (ADR-0028). It does not use the hook's `run`, so a
dismissal never marks engine controls busy or raises an engine error. The module
has no React or DOM dependency, so failure and resend are unit tested.

## Risks / Trade-offs

- [Seen-and-left now applies to all devices] → it already means "this was seen
  once", and the build page stays reachable from the engine card's **Build
  details** button.
- [A client closed or reloaded before the command lands] → the notice shows once
  more.
- [Dismissals made before the update are not migrated] → one more dismissal.
- [A newer Desktop connected to an older server (ADR-0047)] → the command is
  refused, so a dismissal lasts only while the window is open until the server
  is upgraded. An older client ignores the new flag.
