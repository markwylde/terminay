# ADR-0094: Bots attribute engine workloads through per-bot socket proxies

Status: accepted, supersedes ADR-0089 and ADR-0092 in part
Date: 2026-11-02
Supersedes: ADR-0089 and ADR-0092 (per-bot socket opt-in, raw socket exposure and CLI-only workload labelling only; remaining decisions continue)

## Context

Compose and SDK clients bypass CLI-only label injection. The owner requests automatic attribution for all bots and explicitly accepts their control over other containers. The engine remains local and pinned; Terminay workspace, credential and MCP authority remain separate.

## Decision

Every bot container owns a lifecycle-bound Docker-compatible Unix-socket proxy. Its standard /var/run/docker.sock forwards to the selected engine's daemon-side socket, mounted in a private runtime directory. Server bootstrap fixes its bot/server identity. Container/network/volume creation requests receive ownership labels and a workload marker; application labels remain intact. Non-creation operations and streams remain unrestricted and do not reassign existing resources.

The proxy streams ordinary traffic and hijacked exec/attach connections; only bounded creation JSON is buffered. It has bounded connections, input/header limits, explicit cleanup and no request-body logging. It starts before container readiness and is independent of agent sessions. Failure is visible through the container lifecycle. Bots receive standard Docker CLI and Compose without a socket-sharing toggle.

## Consequences

Compose and direct API clients receive consistent attribution without client wrappers. A per-container proxy avoids a host listener and survives application reconnects. It adds HTTP streaming and lifecycle responsibilities, requiring protocol and real-engine/Compose tests.

This is attribution, not a security sandbox. Bots may control other engine resources, and full engine authority can bypass ordinary metadata conventions. The prior CLI wrapper is insufficient; default raw sharing would retain attribution gaps; ownership-filtering proxies and separate nested engines are rejected because the owner requests shared engine control.

Implementation and verification: openspec/changes/bots-proxy-engine-socket/verification.md.
