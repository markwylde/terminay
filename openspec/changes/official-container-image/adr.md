# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (for Mark Wylde)
- Change: official-container-image

## In-Force ADR Context Reviewed

- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - Desktop and server peers are werift; the reason Desktop offers literal host addresses.
- openspec/adr/0011-security-trust-boundary-model.md - hosted services are data-blind signaling; supports refusing a media relay.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - approval stays on the host through the data-root socket; unchanged by the CLI's foreground mode.
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - direct signaling is authenticated by the transcript alone; the derived candidate and public host stay routing hints.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - archive signing and channels; the image is built from the workspace and is not an archive consumer.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - the image is the same standalone server, not a new kind.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md - the image keeps the pinned Node and npm.
- Remaining in-force ADRs (0002–0005, 0012, 0018–0021, 0023, 0025–0029, 0031, 0032) reviewed; not touched by this change.

## Repository-Level ADRs Created

- openspec/adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md - Terminay operates no media relay; connectivity comes from gathered candidates, server-initiated routes, client-derived and operator-supplied routing hints, and the user's own overlay network.

## Notes

- Evidence: openspec/adr/evidence/container-reachability-without-advertised-address.md.
- No in-force ADR is superseded. The image's foreground shape, defaults, and CLI mode are change-level decisions recorded in design.md.
