# ADR-0092: Bots use one local Docker-compatible socket transport

Status: accepted, supersedes ADR-0089
Date: 2026-11-02
Supersedes: ADR-0089

## Context

ADR-0089 permits server-owned bots to run their agents inside isolated containers over ACP, and specifies separate engine CLIs. Packaged macOS reports show that executable lookup, CLI-specific diagnostics and Docker-client/Podman-server confusion prevent bots from using a running engine. Podman exposes a Docker-compatible API, but its compatibility info ID is not a stable identity. The owner requests one socket implementation for Docker and Podman in one specification and implementation PR.

This supersession changes the engine transport commitment only. All bot agent exceptions, ACP extension declarations, container isolation, process-group supervision, local image builds and resource ownership rules from ADR-0089 are reaffirmed. Credential ownership remains governed by ADR-0091; the superseded host-login exception from ADR-0090 is not restored.

## Decision

The privileged Terminay Server uses the local Docker-compatible HTTP API over a Unix socket for every bot engine operation and stream. Engine-specific handling supplies discovery and capability metadata, not separate operation backends. A reachable configured or standard socket does not require a host engine CLI. Optional local VM inspection tools may supply discovery metadata only. Remote TCP/SSH engines remain refused.

The server records an explicit socket endpoint and verifies a persistent engine-local identity marker rather than trusting Podman's compatibility info ID. Selection may create this marker; discovery does not mutate engines. A changed or missing marker requires explicit reselection. Host connection socket and daemon-side socket mount source are separate facts.

The engine socket remains privileged and is never exposed through an arbitrary renderer request interface. Sharing it into a bot remains an explicit per-bot opt-in. Existing server-and-bot ownership labels, stream authority, redaction and confirmed process-group cleanup remain mandatory.

## Consequences

A Dock launch can use a running engine without resolving the user's shell PATH. Docker and Podman share error handling and binary stream code. API framing, cancellation, build archive streaming and TTY resize become responsibilities of the shared transport and need protocol regression tests and real-engine smoke coverage.

The labelled identity volume is an additional persistent engine resource. Removing it requires reselection. Old CLI pins may also require reselection; Terminay must preserve bot records, homes and previous-engine resources. Full API compatibility is verified for the operations bots use rather than inferred from a product name.
