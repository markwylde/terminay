## Why

Bots are independent of projects, but their event picker offers project and terminal activity rather than the files, services, and commands a bot actually uses. Users need to delegate ongoing work through generic outbound observations, with predictable recovery when their Terminay Server sleeps or goes offline.

## What Changes

- **BREAKING:** Replace bot subscriptions to project/terminal automation events with container-local Files, Network, and Commands sources. Existing automation events and policies remain unchanged. Existing bot event definitions are retained disabled with an explanation rather than silently reinterpreted.
- Add file/folder watches with filters and debounce, outbound SSE subscriptions, HTTP response polling, and periodic shell commands. All source execution occurs in the owning bot container, using its environment and credentials; no inbound webhook endpoint is introduced.
- Add generic changed-value, text-match, exit-code and new-JSON-item conditions, with durable observation state. There is no Git, PR, forge or CLI-specific integration.
- Support one-minute command/HTTP checks and time intervals. A check starts an AI session only when its condition fires; each new item gets an independent session and bounded structured context.
- Add per-trigger missed-run policy: skip, run once on return, or replay missed occurrences for time-based sources. Explain the distinction between recovered source events and repeated current-state checks.
- Separate durable bot Disable/Enable from container Stop/Start and configurable idle shutdown. Enabled triggers can wake an idle-stopped container; continuous watchers keep it running. Disabled periods do not accumulate catch-up work.
- Replace the trigger modal with a source-grouped list and adjacent editor, responsive on narrow clients. Add source tests, health, last-check/last-fire separation, observation memory, recovery policy and actionable errors. Agent tools share exactly the same definitions and validation.

## Capabilities

### New Capabilities

None. This extends capabilities already specified in the active `add-terminay-bots` change.

### Modified Capabilities

- `bot-triggers`: generic outbound sources, matching and memory, durable pending events, recovery policy, tool parity, and list/editor experience.
- `bot-environment`: watcher activity and polling checks in container lifecycle and idle shutdown.
- `terminay-bots`: durable enabled state, Disable/Enable controls, and per-event admission instead of one pending firing per trigger.

These capabilities are not yet in `openspec/specs/`; this change's MODIFIED deltas target the full requirement blocks in `add-terminay-bots`. Archive that prerequisite before this change, then validate the deltas against the resulting canonical specs. Do not duplicate their capabilities as new ADDED specs.

## Impact

- Server: `packages/server-core/src/botService/{triggers,triggerState,runtimeTriggers,store,queue,idle,environment,composition}.ts`, `scheduleEngine`, and a container source worker shipped in `docker/terminay-bot/`.
- Contracts: `packages/protocol`, `packages/client-core`, bot runtime tool schemas, durable event/checkpoint storage and protocol capability negotiation.
- UI: `src/workspace/bots/{BotTriggersPanel,BotTriggerEditor,triggersModel,BotTab,BotsSection}` and related styles/lifecycle controls.
- Verification: bot trigger, runtime, queue, persistence and engine tests; UI model tests; Docker-isolated `e2e/bots.spec.ts`; real Docker/Podman source-worker smoke tests.
- Architecture: record the owner-approved one-minute-minimum command/HTTP polling scope under ADR-0028 and preserve server ownership, container execution, scoped runtime authority and durable replace. No change to project automation or host credential access.
- The owner explicitly approved keeping proposal and implementation together in PR #489. Capability deltas remain active until the implementation is merged; archive must reconcile prerequisite deltas in dependency order.
