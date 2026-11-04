## Why

Opening Bots can freeze Terminay by continuously spawning home-size helper containers. Engine outages and resets also leave users with opaque failures, blocked deletion, and no recovery actions on the affected bot; MCP startup failures lack useful diagnostics.

## What Changes

- Make environment notifications reflect actual state transitions, ignore helper events, and reconcile only the affected owned bot container with bounded pending work.
- Add a cheap environment-state query for bot summaries; reserve stats, home-size measurement and logs for opening Overview and explicit Refresh.
- Return structured, sanitized bot/engine/image failures and retain specific failure reasons and runner diagnostics for every execution origin.
- Show engine status and existing recovery actions on individual bot views, preserving explicit confirmation before accepting an engine identity change.
- Build missing images and recreate missing owned resources through the existing environment preparation lifecycle, with visible progress and actionable failure messages.
- Allow confirmed local bot deletion during engine outages or identity changes, with durable deferred cleanup scoped to the original engine identity and owned resources.
- Diagnose MCP relay/adapter startup failures without exposing runtime credentials, and investigate independent failure after removing the event storm.

## Capabilities

### New Capabilities

- `bot-engine-recovery`: Bounded bot environment observation, actionable engine recovery, failure diagnostics, and deletion independent of engine availability.

### Modified Capabilities

None in canonical specs. Bot environment, engine and messaging contracts currently live in active changes (`add-terminay-bots`, `bots-use-container-socket`, `bots-use-message-log`); this additive capability supplements them without rewriting those changes.

## Impact

Server environment/engine event handling, bot service execution and deletion, protocol dispatcher and query schemas, client environment API, Bots summary loading and recovery UI, runtime MCP bridge and runner diagnostics. Tests extend the existing server/client bot suites and Docker-isolated E2E coverage. No renderer engine access, implicit engine adoption, host Electron tests, or changes to accepted ADRs.
