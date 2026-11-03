## Context

The report was based on 3eba92ae; inspection here is at 6de21abf. The reported paths remain: environment.setState always emits and rearms idle; follow reconciles every bot for every container event; useServerBots.loadBot always calls overview. Dispatcher drops bot errors into generic internal failures. Chat skips readiness checks and hard-codes its failed-session reason. Deletion awaits engine removal before removing local records. Runtime bridge has a ten-second readiness timeout whose failure can lose its cause during close.

Canonical bot specs are not yet archived; the active bot environment, socket and message-log specs constrain this additive capability. Relevant in-force decisions are ADR-0028 (event-driven observation), ADR-0059 (work proportional to changes), ADR-0088 (durable replacement), ADR-0091 (bot-owned credentials), ADR-0092 (local socket and explicit identity adoption), ADR-0093 (execution-scoped MCP), and ADR-0094 (workload proxy attribution). ADR-0090 is superseded by 0091; 0092/0093/0094 supersede only the stated portions of 0089/0092. No accepted ADR requires rewriting.

## Goals / Non-Goals

Goals: stop the feedback loop at all three boundaries; retain actionable failures; recover in place after explicit engine adoption; permit local deletion; establish useful MCP evidence.

Non-goals: automatic engine adoption, automatic VM administration, remote engines, changes to bot MCP authority, or resetting the user's actual engine during tests.

## Decisions

1. Guard unchanged states before notifications and idle updates. Keep activity/settings updates explicitly able to update deadlines. Filter engine events by exact known main-container identity and ownership information when present, rejecting helpers and workload containers even when they share bot labels. Coalesce bursts per bot with at most one in-flight and one pending reconcile, respecting lifecycle disposal and bot removal. Full reconciliation remains for verified availability transitions. A global debounce alone masks the recursive dependency and leaves cross-bot work.

2. Expose cached environment state through the existing authorized bot query surface and typed client. Replace summary overview reads. Overview metrics remain user-demanded. This crosses the server/client protocol boundary without granting engine access or adding polling. Exact event parsing needs Docker and Podman payload fixtures; names alone never authorize resource mutation.

3. Share a bounded user-safe failure formatter across dispatcher and execution failure handling for BotError, EngineCommandError and BotImageBuildError. Preserve reason codes in protocol details and sanitize diagnostics through the existing secret redaction path. Verify engine availability uniformly before provider launch. Agent-status preflight must not prevent the required first-image build: prepare the environment before rejecting an adapter merely absent from a missing image. Keep unknown exceptions generic to clients while logging sanitized operator context.

4. Reuse the engine service and existing confirmed selection/build/recreate commands in a common bot recovery banner. User intent drives checks and recovery, never timers. Missing marker means identity cannot be verified, not proof that an engine was wiped. Do not label a reset as certain. PrepareSession builds/recreates absent owned resources with observable lifecycle state; unavailable engine and identity change still fail early. Container/session authority remains server-owned.

5. Separate local deletion from engine resource removal. Revoke capabilities and stop local work first. Durably save a deletion intent with original pin identity, server/bot IDs and deleteHome before removing local records; retry owned resource removal on verified engine availability and startup without periodic polling. Report deferred removal in a typed command result shown in the UI. Never silently retarget an intent after engine adoption. Missing or foreign resources are not deletion authority. This crosses the durable local-store/engine boundary and needs crash/restart tests. Blocking deletion on cleanup perpetuates the reported lockout; forgetting cleanup leaves invisible orphans.

6. Preserve the primary MCP startup error if teardown also fails. Capture bounded relay stderr and adapter startup diagnostics through existing runner output, applying redaction before persistence. Verify actual socket/token propagation using the execution-scoped bridge tests and a fresh real adapter session after the loop fix. Do not increase timeouts without evidence. Independent cause is unknown; saturation remains a hypothesis.

## Risks / Trade-offs

- Event payload differences → Docker/Podman fixtures and unknown-event rejection; ownership inspection remains authoritative.
- Readiness checks reject missing images prematurely → recovery-first ordering and fresh-engine regression test.
- Deferred deletion adds durable lifecycle state → use ADR-0088 replacement and idempotent restart handling.
- Old engine may never return → retain an explicit pending warning rather than claim removal succeeded.
- Provider may omit MCP startup diagnostics → verify adapter notification surface and bridge failure paths; record limits honestly.
- Redaction can hide useful detail → stable reason/stage fields plus bounded sanitized text.

## Migration Plan

Add the query and command result across server, client and UI together. Preserve saved engine pins and existing bot data. New deferred intents use a versioned store. Rollback requires retaining pending intents for later supported processing; engine resources are never removed by name alone.

## Open Questions

The independent MCP startup failure is unconfirmed. Reproduce after eliminating the feedback loop, capture adapter notifications and relay stderr, and fix the evidenced path. No in-force ADR needs supersession for this change.
