# ADR-0062: A server upgrades itself to its own channel's newest signed release, and a client only asks

Status: accepted
Date: 2026-10-11

## Context

ADR-0016 made the standalone server a signed, self-contained archive that an
installer lays out side by side and switches atomically, and ADR-0027 let
Terminay Desktop update itself while keeping the renderer to "read status, ask
for a restart". A remote server had no equivalent: nothing told its clients a
newer release existed, and upgrading meant a shell on the host.

Letting a connected client start a server upgrade raises four questions that
outlive the change that introduces it: who decides what is installed, where the
upgrader comes from, how a service that runs unprivileged gets replaced, and
what a container image means once the server inside it can be newer than the
image.

## Decision

1. **The server decides the target.** A standalone server checks its own
   installed channel and upgrades only to the newest release there, verified by
   digest and signature as ADR-0016 requires, and never to an older one. A
   client request carries the upgrade mode and nothing else: no version,
   reference, URL, path, or flag. Any paired device may ask.
2. **The upgrader ships in the release.** Every server archive carries the
   `terminay` CLI, covered by the same manifest and signature. A server never
   fetches an upgrader from a package registry in response to a client.
3. **Privilege is crossed by a fixed, root-owned trigger.** A system-scope
   service asks for an upgrade by touching a request file that a root-owned
   systemd path unit watches; the unit starts a root oneshot whose command line
   is fixed and which executes only files under the root-owned install prefix.
   The service keeps `NoNewPrivileges=true`, the prefix stays unwritable by the
   run-as account, and the request file's contents are never read.
4. **A container image is a baseline, not the version.** The image's entrypoint
   stays the container's main process, supervises the server, and runs the
   newest verified release out of the one built into the image and the one
   staged on the data volume. An in-place upgrade therefore keeps terminals
   running and survives restart and recreation, and a newer image still wins.
5. **Recreating a container is an explicit second mode.** It exists only when
   the operator has mounted the Docker socket, is never the default, and is
   presented with the fact that it ends every terminal. Its target is an
   image, which the release signature of decision 1 does not cover: recreate
   trusts the registry and tag the container was created from, exactly as the
   operator's own `docker pull` does. A digest-pinned container is never
   recreated.

## Consequences

- A standalone server makes an outbound HTTPS request to the project's GitHub
  releases. Under ADR-0028 its hourly repeat is a poll the owner approved in
  change `remote-server-in-app-upgrade`; it runs only while a client is
  attached.
- The upgrader that performs an upgrade is the one in the release being
  replaced. A defect in it is fixed by a manual upgrade with a newer CLI, so
  the npm package stays a supported path.
- The run-as account of a system-scope service can cause an upgrade to the
  newest signed release at any time. It cannot choose the release or the
  command.
- An image tag no longer states the version running inside the container.
  Status surfaces report the running release instead.
- A mounted Docker socket gives every terminal in that container control of the
  host's Docker daemon. Terminay documents this and does not mitigate it.
- A future channel-switch or downgrade from a client would contradict decision
  1 and needs a superseding record.
