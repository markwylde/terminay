## Context

`BotEnvironmentService.overview()` ran inspect, `docker stats --no-stream` (about a second, since it waits for a second sample), a `docker run --rm … du -sk /home/bot` helper container, and `docker logs`, in sequence. The UI rendered nothing until all of them returned. Image currency also awaited the engine's AppArmor decision, which on a cold Docker host with AppArmor runs probe containers. `BotShellService.open()` called `start()` before every shell. `BotDesktopService.open()` refused a stopped machine with a plain `Error`, which the dispatcher reduces to "command failed".

## Goals / Non-Goals

**Goals:**

- The Overview appears as fast as one `inspect`.
- Opening a view never changes the machine's state.
- An ordinary stopped or not-created machine reads as a state with an action, not as an error.

**Non-Goals:**

- Caching home size across Overview opens. Reading it once after the Overview renders is enough, and bot-engine-recovery keeps full measurements to Overview open and Refresh.
- Changing Files, which already works while the machine is stopped.
- Changing how engine outages, image builds, or engine adoption are recovered. Those keep their bot-engine-recovery surfaces.

## Decisions

### Two reads, one query

The overview query gains an optional `usage: false` flag rather than a new query. The state read returns state, uptime, image, currency, limits, and engine socket, with blank usage and `usageRead: false`. The full, unflagged read returns everything, as before. A server that predates the flag ignores it and returns the full overview, and a client that predates it never sends it, so mixed versions behave as before. A new query would have needed both sides upgraded to work at all.

The state read never waits on an AppArmor probe. It uses the engine's AppArmor decision only when that decision has already settled; otherwise it judges currency by the image fingerprint alone, and the full read, which waits for the decision, settles it. No security check is weakened: the decision still governs every container create and every recreate; only the Overview's out-of-date notice may appear a moment later on a cold server.

Usage reads (stats, home size, log) run concurrently, so the full read takes as long as the slowest of them rather than their sum. A failed stats or home-size read leaves that figure unavailable and a failed log read leaves the log empty, as before. A home volume owned by someone else still fails the full read, as before.

### When the Overview measures

Full measurements happen only when the Overview opens and on Refresh, as bot-engine-recovery requires. Lifecycle changes, whether the user's own Start or Stop in the Overview or a change the client observes, re-read state only.

Each Overview load has a generation; a response from an older load is dropped. Within one load, the full response wins: a state response that arrives after the full one is dropped, so a slow state read can never overwrite newer state or clear the full read's error.

While a Refresh is under way, the previous figures stay on screen with the time they were read (`sampledAt`), and are replaced together with their time when the full read lands. A state read that follows a lifecycle change clears figures that no longer describe the machine, since a stopped machine has no CPU or memory; home size and the log are kept with their own read time.

If the full read fails after the state read succeeded, the Overview keeps showing state, stops showing figures as being read, shows them as unavailable (—), and shows the error. Refresh tries again. Unavailable is shown as —, never as 0.

### Opening a view never starts the machine

**BREAKING:** Shell no longer calls `start()`. The server refuses a shell while the machine is not running, matching Desktop, so a client that opens a stream anyway, including one that lost a race with an idle stop, gets a clear refusal rather than a machine starting under it. Both refusals are `BotError('conflict', 'The machine is not started.')`, which the bot failure mapping passes through, instead of "command failed".

Agent sign-in keeps starting the machine: the user chose Sign in, and it cannot run otherwise.

Boundary: this crosses no new boundary. Shell and desktop streams stay bound to the authorized connection and bot, and starting still goes through the existing lifecycle command and its authority checks.

### A gate in the UI

`BotMachineGate` wraps Shell and Desktop. It reads the environment state the client already watches and renders the view only while it is `running`, so the view opens when the machine starts, by the panel or otherwise, and is replaced by the panel when it stops. Otherwise it shows the state and one action: Start machine (stopped), Create machine (not created), Try again (failed), or a disabled action while the machine starts, is created, or stops.

The calm treatment covers the machine's ordinary states only. A failure to start, including an engine or image failure returned by the lifecycle command, is a real error: the panel shows its cause, and the engine and image recovery surfaces stay where bot-engine-recovery puts them. A failed machine is labelled as failed, not as stopped.

## Risks / Trade-offs

- [The Overview issues two queries per open] → The state read is one `inspect` plus cached decisions. The full read does the same work as before, now in parallel.
- [Currency judged by fingerprint alone on a cold server] → The full read settles it within the same open; container creation is unaffected.
- [A user who relied on Shell to start the machine needs one more click] → The panel says what is needed and the action is in place.
