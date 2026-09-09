## Context

`--advertise-address` exists so a server behind a port forward — a container on the operator's own machine being the case it was built for — can offer a candidate at the forwarded address rather than only the addresses it can see about itself. The flag shipped with `127.0.0.1:51000` as its example, and the runbook followed.

That example is browser-dependent. Measured against a container installed exactly as documented, Firefox 155 formed three candidate pairs and sent zero connectivity checks on all three; the pair carrying `host 127.0.0.1:42424` was pruned rather than probed. Chromium probes it and connects in tens of milliseconds. The failure surfaces to the operator as `Terminay did not open the api bootstrap lane. (closed; no-channels)` after the peer sits in `checking` — a message about data channels, several layers above the cause.

## Goals / Non-Goals

**Goals**
- An advertised address that works is the only one the CLI accepts.
- A re-run of `install` leaves the running service on the configuration it just wrote.

**Non-Goals**
- Making a loopback candidate work. It is the remote peer that declines to probe it; nothing on this side can change that.
- Retrying or restarting ICE when a peer stalls in `checking`. Worth doing, and separate: it would have turned this into a slow failure rather than a hang, but it would not have made the connection work.

## Decisions

### D1. Refuse loopback rather than warn

A warning on a command whose output already runs to a dozen lines is a line the operator scrolls past, and the failure it predicts arrives minutes later in a different program. Refusing costs one command and names the fix.

It removes one configuration that works today: a loopback forward driven from Chromium only — an SSH tunnel to a remote machine, say, with the browser on the near end. That operator is one `-L` binding away from a routable address on the same machine, and the configuration they lose is one that would have broken the moment they opened Firefox.

### D2. Refuse the whole loopback range, not just `127.0.0.1`

`127.0.0.0/8` and `::1` are all loopback and all equally unprobed. Refusing only the literal `127.0.0.1` would pass `127.0.1.1` through to the same hang.

### D3. Restart on install, not `enable --now`

`systemctl enable --now` starts a stopped unit and does nothing to a running one. Install writes the environment file every time it runs, so on a machine with a running service the two disagree: the operator reads the new advertised address in the command's own output while the process serves the old one. Restarting closes that gap and matches what upgrade already does.

### D4. The example address in every document is routable

The help text, the runbook, and the README all carried the loopback example, which is now a value the CLI rejects. They name the machine's routable address instead, alongside the existing note about publishing the UDP port — the two go together, since the port is published on that same address.

## Risks / Trade-offs

An operator whose install script passes `127.0.0.1` gets a failing command on their next run. The message names the replacement, and an existing install keeps running untouched: the refusal is on the value being supplied, not on the value already recorded.

## Migration Plan

None. Installs already carrying a loopback advertised address keep it until the operator next supplies one.

## Open Questions

None.
