# ADR-0096: Bot trigger sources execute in the owning container under server-owned observation state

Status: proposed
Date: 2026-11-04

## Context

Bots are server-owned agents independent of projects. Their project-event subscriptions cannot observe arbitrary files, streams, HTTP services or container CLI results. On 2026-11-04 the owner requested generic outbound trigger sources, including HTTP and shell commands checked every 60,000 ms, with all execution inside the owning bot's container and no inbound webhooks. He also requested per-trigger missed-run recovery for laptop-hosted and continuously running remote servers.

Existing bot tools are execution-bound and bot-scoped. The local engine socket transport, separate bot credentials, server-owned durable state and supervised process groups already establish the relevant authority boundaries. ADR-0028 permits specific owner-approved polls with a recorded interval, reason and lifecycle; it does not permit ambient background polling.

## Decision

Bot trigger observations execute only in the owning bot container as its bot user, independently of AI providers. The privileged server owns validated definitions, lifecycle, generation fencing, durable observation checkpoints and event admission. It reaches workers through the existing local engine exec transport, creates no inbound source listener, and grants no project/terminal/host-path authority through source tools. Client connection state is presentation, not the source lifecycle.

Only configured, enabled periodic HTTP and shell-command sources poll: default/minimum 60,000 ms, with longer configured intervals permitted. This records the owner's 2026-11-04 approval under ADR-0028 for these specific generic source types. Request/response HTTP and terminating CLI commands have no universal push subscription. File and SSE sources use events. No default source poll, credential poll, host engine-availability poll, or silent watch-to-poll fallback is authorized. Code sites cite ADR-0028 and change `outbound-bot-triggers`; disabling/deleting the owner cancels its timers and workers.

The server commits accepted event identities, bounded pending payloads and observation progress atomically before acknowledging progress. Admission to AI work remains bounded and idempotent by event/session identity. A missed-run policy describes replayable schedule occurrences or source-supported recovery; it does not promise historical state that the source cannot supply or exactly-once external side effects. Bot Disable is a durable observation pause; an idle-stopped container can wake for an enabled source, and continuous sources keep their container active.

Rejected alternatives: host execution changes source filesystem/network/credentials; waking an AI provider for every poll wastes work and makes matching probabilistic; provider-specific trigger types undermine agent-configured generic sources; unbounded queues and in-memory-only checkpoints lose or duplicate work; inbound webhook services do not fit laptop deployments.

## Consequences

- Agent-created and human-created sources share one authority and validation path, with no special forge integration.
- The locally built image must ship and qualify its source worker; observation storage and crash-safe dispatch add server complexity.
- Continuous sources consume container resources while enabled. Periodic sources can release them between checks; users can disable a bot to pause all automatic observation.
- Gaps, memory limits, errors and recovery capabilities must be visible. A source that cannot replay can still miss transient events while offline.
- Existing accepted ADRs remain immutable. This is a scoped approval through ADR-0028, not its replacement; bot execution, credential and engine authority remain as carried forward by ADR-0092 through ADR-0095.

## Open items

Validate worker framing, process cleanup, persistence/crash boundaries and real Docker/Podman source operation before release. The detailed proposed limits and replay semantics are in `openspec/changes/outbound-bot-triggers/design.md` and its capability deltas. This record is proposed for review alongside those planning artifacts.
