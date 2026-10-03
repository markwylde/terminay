## Context

A containerised Terminay Server cannot observe the address a client reaches it on. Its own interface is the container's (`10.88.0.88` under podman on macOS), `host.containers.internal` is a gateway inside the runtime's VM, and STUN returns the router's public address. `--advertise-address` exists to fill that gap, and the 2026-09 changes (`local-container-ice-advertising`, `advertise-address-reachability`, `desktop-container-pairing-reliability`) made it reliable. The cost is the onboarding: a systemd-in-a-container recipe or a hand-built foreground command, the host address typed twice, and five published ports.

Measurement on 2026-10-03 ([evidence](../../adr/evidence/container-reachability-without-advertised-address.md)) changed the picture:

- Desktop's WebRTC peer is werift in the Electron main process (`electron/remote/desktopWebRtcTransport.ts`), so it offers real host addresses, not mDNS names.
- A container can send UDP out to the host's LAN address and receive the reply.
- So a server with no advertised address and no published UDP port pairs and holds a session with Desktop's own pairing code, over hosted and direct signaling. The server's selected pair is `host`/`host`: it dialled Desktop.
- Browsers conceal local addresses behind mDNS names the container cannot resolve, so for them the advertised address and published range remain necessary.

In-force ADRs that constrain this design: ADR-0006 (werift runtime), ADR-0011 (trust boundaries), ADR-0013 (host approval, credentials only on authenticated channels), ADR-0015 (direct signaling authenticated by the transcript alone), ADR-0016 (signed self-contained archives and release channels), ADR-0017 (one server type), ADR-0033 (pinned Node and npm).

An image already exists (`apps/terminay-server/Dockerfile`, published as `ghcr.io/<owner>/terminay-server`): unprivileged, foreground, health on 8080, HTTP on 4317, exposure off, no CLI. The runbook describes it as a lifecycle slice that a client cannot connect to.

## Goals / Non-Goals

**Goals:**

- `docker run -d --name terminaydemo markwylde/terminay` then `docker exec -it terminaydemo terminay daemon qr-code` pairs Desktop, on a Mac, a VM, or a homelab.
- Browser and phone access costs one address given once, plus one published UDP range.
- A Linux host needs nothing beyond host networking.
- The no-UDP-port Desktop path is a tested contract, not an accident of the runtime.

**Non-Goals:**

- A Terminay-operated TURN or other media relay. Owner decision: relayed terminal traffic is bandwidth Terminay would pay for. The supported answer to a hostile network is an overlay such as Tailscale, whose addresses the server already gathers.
- Discovering the host's LAN address from inside a container. Nothing inside the container can observe it.
- Making browsers work with no address. Their address concealment is not ours to change.
- UPnP, NAT-PMP, or any automatic port mapping.
- Changing the systemd installer's behaviour on a real host, beyond accepting `--public-host`.

## Decisions

### 1. Build the image from the release archive's tree; publish it under both names

The existing root `Dockerfile` copied the compiled server and nothing else: no
workspace UI and no WebRTC runtime. It started, reported ready, and could not be
paired with, which is why the runbook called it a lifecycle slice. The release
archive (ADR-0016) is the layout that is known to work, so the build stage now
runs the same assembly — `build-standalone-server-artifact.mjs` over the
compiled server, the server-served UI, the built-in extensions, the staged
werift runtime, and the pinned Node archive — and the runtime stage is
`debian:bookworm-slim` plus that tree at `/opt/terminay`, with the CLI bundled
beside it. The image and an installed archive are the same server.

One build publishes `markwylde/terminay` on Docker Hub and
`ghcr.io/<owner>/terminay-server`, so both resolve to one digest. Docker Hub is
added only where its credential exists, so the workflow is safe to merge before
the secret is created.

- *Alternative: download the published, signed archive into the image.*
  Rejected: a pull request has no published archive to test, and the image
  would lag the code it is built beside. The image is built from source in the
  same workflow, so ADR-0016's signature boundary — release pipeline to
  operator's machine — is not the one crossed; image provenance stays what
  `docker-image-release.md` records.
- *Alternative: systemd in the image so `daemon install` runs unchanged.*
  Rejected: needs a privileged or specially-flagged container and a second
  init, for no user-visible gain.

Publication stays release-only, as `provider-portable-ci.test.mjs` already
requires of this workflow. `latest` is emitted on a release tag rather than for
the default branch, so the bare image name is always a release. The proposal's
`main` image tag is dropped: nothing is published from the default branch.

### 2. Image defaults: 8443/tcp, `https://localhost:8443`, and no pinned range

8443 is the installer's existing default, so the image, the installer, and the
docs name the same number. The image sets `TERMINAY_PUBLIC_HOST=localhost`,
which derives a loopback direct origin and no candidate: correct for the case
that needs no configuration, Desktop on the same machine. Health stays on its
own loopback port for the in-container check.

The ICE range is not pinned by default. Decision 5 explains why.

### 3. The CLI finds a foreground server through `TERMINAY_DATA_ROOT`

Pairing and approval already go through the owner-only socket in the data root; only the CLI's route to it assumes an install record and a systemd unit. With no install record the CLI uses `TERMINAY_DATA_ROOT` and connects as the invoking account. The image sets that variable and runs `docker exec` as the same unprivileged user, so the socket's owner-only permission is satisfied without `sudo`. **Boundary:** the data-root socket remains the authority boundary — whoever can approve a device already owns the data root. Nothing is widened.

`status` reads from the server (socket or health) instead of systemd. Lifecycle commands refuse when `TERMINAY_MANAGED_BY=container` is set by the image, and name the `docker` action instead.

- *Alternative: a separate `terminay-server --pairing` wrapper script in the image.* Rejected: the user asked for `terminay daemon qr-code`, and one command that works everywhere is the onboarding.

### 4. One public host derives the direct origin and the advertised address

`TERMINAY_PUBLIC_HOST` (server) and `--public-host` (installer). Derivation happens in the server, so the image needs no entrypoint logic and the installer only records and passes it. A literal routable address derives both; a name or loopback derives the direct origin only, because a candidate must be a literal address (existing requirement) and a loopback candidate is pruned by Firefox. Explicit `--direct-origin` / `--advertise-address` still win, so nothing existing breaks.

**Boundary:** both derived values are routing hints. The existing requirement "An advertised ICE address grants no authority" covers them unchanged; the pairing URL's direct form already carries the direct origin.

- *Alternative: resolve a public host name to a literal on the server at startup.* Deferred: the server's resolver may not see what the client's does, and a stale resolution fails silently. Open question below.

### 5. Pin the ICE range independently of an advertised address, and only when asked

`hostedPeerConfiguration` pinned `icePortRange` only when an advertised address
was present. Splitting the two lets an operator publish a known UDP range
without knowing an address, which decision 6 depends on. The server gains
`--ice-port` / `TERMINAY_ICE_PORT` and `--ice-port-span` /
`TERMINAY_ICE_PORT_SPAN`; an advertised address still implies the range.

Measurement settled the open question: the range is a budget across every live
peer. werift gives each candidate of each peer its own socket, so a second peer
under a spent four-port range gathers nothing at all (evidence file). With an
advertised address in a container each peer takes two ports, so the installer's
four-port default serves two peers at once.

So the image does not pin by default — the no-configuration Desktop path uses
ephemeral ports and has no such cap — and when a public host or ICE port does
pin, the image's span is sixteen. The installer's default stays four: changing
it would silently change which ports existing operators must have forwarded.
A peer that gathers nothing under a pinned range is logged as
`ice-range-exhausted`, because the symptom is otherwise an unexplained
`checking`.

- *Alternative: multiplex every peer on one UDP port.* That is the real fix
  and removes the budget. It is a change to the vendored runtime (ADR-0006),
  not to this image, and is left as an open question.

### 6. Direct-mode clients derive a candidate from the signaling host

A client that signalled through `https://<host>:<port>` has proof that `<host>` reaches the server's machine. For each UDP host-candidate port in the server's description, it adds a remote candidate at that host. With a pinned, forwarded range this makes a port-forwarded server reachable by Desktop with no advertised address, and it works for a DNS name because the client resolves the name it already used. No protocol change: the ports come from the SDP the server already signs.

**Boundary:** the derived candidate is added on the client after the server's signed description is verified, and changes neither the description nor the transcript (ADR-0015). A wrong candidate costs failed connectivity checks, nothing else. Hosted signaling derives nothing: the relay's host is not the server's.

- *Alternative: the server announces an "ICE port" field in signaling.* Rejected: a new signed field for information already in the SDP.

### 7. Desktop host candidates and server dial-out become a requirement

Nothing changes in code if the measurement holds for the packaged app; what changes is that the behaviour is specified and guarded. A CI smoke test starts the image with only the signaling port published and drives `pairDesktopHostedDevice` and `connectDesktopHostedRemote`, asserting the server's device-scope pair is `host`/`host`. Without the test, a future switch of Desktop to a Chromium peer, or an ICE-interface restriction, would silently bring back the configuration this change removes.

### 8. Identity is already stored in the data root; the image must not override it

The proposal assumed the identity came from the hostname. It does not:
`resolveStandaloneServerIdentity` gives a new data root an opaque persisted
identity and refuses a `--server-id` that disagrees with it. The installer
writes `TERMINAY_SERVER_ID` from the hostname, which is safe on a host and
would be wrong in a container, whose hostname is its id and changes on
recreation. So the image sets no server id and no code changes. The hostname is
used only as the label in pairing links. The smoke test recreates the container
on the same volume under a different hostname and requires the same identity.

The version is the package version stamped at build time, and a default-branch
build keeps the placeholder `0.0.0`: the project's version grammar has no form
for it, and the UI bundle manifest must match the server's version exactly. The
build is identified by its revision instead, which the server now reports
(`TERMINAY_SERVER_REVISION`) in its readiness record and through
`daemon status`.

### 9. No media relay, recorded as an ADR

The reachability model — gathered candidates, an operator-supplied or client-derived routing hint, server dial-out, and no Terminay relay — will shape every later connectivity decision. It is recorded as ADR-0034.

## Risks / Trade-offs

- [Only Desktop's modules were driven in Node, not the packaged Electron app] → task 6.1 pairs the packaged app against the image before the docs claim it.
- [macOS firewall on: the server's first packet to Desktop is unsolicited inbound UDP and may be dropped] → task 6.2 measures it; the runbook names it; the fallback is the public-host run line, and decision 6 gives Desktop a client-initiated route when the range is published.
- [A literal public host goes stale when a laptop changes network] → documented; `daemon status` shows it; Desktop on the same machine does not depend on it.
- [A pinned range caps concurrent devices — measured, and true] → the image does not pin by default, pins sixteen ports when it must, logs exhaustion, and documents the budget. The installer's four-port range keeps its two-peer cap; see Open Questions.
- [`latest` changes meaning on GHCR] → it was only ever emitted for the default branch, from a workflow that runs on tags, so it was never published; the release contract now defines it.
- [The arm64 image is built under emulation and now builds the UI and assembles the archive] → the release build is slower. It affects tagged releases only; a native arm64 runner is the remedy if it becomes a problem.
- [The image has no init process, so orphaned grandchildren of terminals are not reaped] → `docker run --init` adds one; the image does not ship one because it would be a second process manager to reason about.
- [Docker Hub is a new publication target with a new credential] → the credential is a release secret on the mirror only; a pull request never publishes.
- [Unprivileged image user cannot `apt install` in a terminal] → documented with a derived-image example. Open question below.
- [`agent source com.terminay.builtin-agents/agents failed to start: extension host stopped` appears at startup in a container] → task 7.1 diagnoses it; a fix belongs to `builtin-agents-extension` unless the cause is the image.

## Migration Plan

1. Land server options (public host, ICE port and span), CLI foreground mode, the direct-mode derived candidate, and the rebuilt image; all are additive and off unless used. Nothing is published by merging.
2. Add the Docker Hub credential to the mirror.
3. Run the manual checks in task group 6 against a locally built image.
4. Cut a release; the image is published under both names and `latest` names it; update the installation page.

Rollback is the previous image tag. Data roots are forward-compatible: the persisted identity file is additive.

## Open Questions

- Should the image's terminal user be able to become root (passwordless `sudo`) for a demo container, or stay strictly unprivileged with a documented derived image? This design assumes unprivileged.
- Should a public host given as a name be resolved on the server to produce an advertised candidate for browsers?
- Should `ghcr.io/<owner>/terminay-server` keep being published, or be retired once `markwylde/terminay` is established? This design keeps both.
- Should the WebRTC runtime multiplex every peer on one UDP port, removing the pinned-range budget and the installer's two-peer cap? That is a change under ADR-0006.
- The systemd installer still pins four ports. Should its default grow, given that existing operators have forwarded exactly four?
- No in-force ADR needs revisiting.
