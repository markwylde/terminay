# ADR-0096: Bots use Terminay-owned native CLI drivers adapted from Atlas

Status: accepted, supersedes ADR-0089, ADR-0091, ADR-0092, ADR-0093, ADR-0094 and ADR-0095 in part
Date: 2026-11-04
Supersedes: ADR-0089 (ACP client, adapter declarations and adapter-bound installs only); ADR-0091 (Codex ACP authentication mechanism only); ADR-0092, ADR-0093 and ADR-0094 (reaffirmation of ACP only); ADR-0095-claude-bots-sign-in-through-their-own-cli (adapter-bound installation choice only)

## Context

The owner requests Atlas's native CLI runner and capable desktop for Terminay bots, and explicitly instructs that relevant source be copied and adapted because Atlas is proprietary. Terminay is public and cannot depend on Atlas packages, services, checkout paths or private image registries. Building a runtime image locally instead of pulling it is a provisioning difference, not a reason to retain a different execution protocol.

The current bot decisions require ACP while preserving server-owned execution, per-bot credentials, supervised cleanup and scoped communication. Atlas's disposable runners, provider-shared credential storage, published service ports and autonomous-only Claude launch cannot be copied unchanged without losing these Terminay contracts. This decision replaces the agent protocol choice only; its source port and native drivers are owned and maintained by Terminay.

## Decision

Terminay Server owns native Codex and Claude Code drivers using first-party CLI protocols, with relevant runner and desktop source copied/adapted into this repository. There is no direct import, shared private package or build/runtime dependency on Atlas. Copied revision/adaptations and applicable notices are recorded locally. Public dependencies are pinned and installed when the user's server builds the shipped Dockerfile; Terminay does not distribute or pull a prebuilt bot image.

Extensions describe a supported native driver, exact install inputs, models, availability, sign-in and bounded launch settings. The host validates these declarations and owns process launch, protocol translation, permissions, credentials and lifecycle. A driver execution runs only inside the owning bot's existing container as `bot` in `/home/bot`, under the existing supervisor and through the pinned local Docker-compatible socket. No local-process/SSH execution fallback, host credential mount, shared provider credential store or arbitrary extension parser is introduced.

Claude Ask me must be proven against its pinned native control channel, and Codex remains Autonomous only. Missing capabilities block adoption rather than silently bypassing approvals. Credential isolation, selected-sign-in precedence, token non-persistence, tool-shell environment exclusion, redaction and confirmed process cleanup remain required. Explicit bot-runtime posts alone create shared-chat replies; native output remains bounded diagnostics. Concurrent coordination, revocation and work ownership remain governed by ADR-0093.

The full desktop and its tools operate inside that same bot environment. Human VNC remains bootstrap-protected and relayed through Terminay, no bot service port is published, Chromium remains sandboxed, and desktop/browser dispatch checks execution capability and shared-work ownership. Shared engine access retains ADR-0094's explicitly unrestricted engine authority; it is not a security sandbox. Desktop readiness/supervision and build progress remain event-driven under ADR-0028.

Every other commitment in the referenced ADRs continues, including the owner-approved bot-launch exception, no workspace authority, per-bot sign-in, local image builds, local engine identity, protected desktop relay and shared-engine attribution. Accepted ADR files remain unchanged. Ordinary terminal agents and project chat providers retain their existing decisions.

## Consequences

- Users receive native CLI behaviour and the fuller desktop without requiring private infrastructure. Terminay maintains and tests the copied source independently.
- Native protocols require exact pins, incremental bounded parsing, executable conformance and explicit approval verification; a successful process exit alone is insufficient evidence.
- Third-party ACP contributions need the versioned native-driver declaration and are rejected actionably until updated. Historical diagnostics remain readable; executions are not replayed.
- Local builds become larger with the creative suite. Build failure must preserve the previous usable image and report actual progress/failure.
- Keeping ACP is rejected because it maintains the separate execution stack the owner wants to replace. Direct Atlas imports are rejected by the owner's public/private boundary. A wholesale copy of Atlas deployment/auth/port behaviour is rejected because it violates Terminay's retained contracts.

## Open items

Prove the exact native CLI versions, Claude permission control, API-key non-persistence, guided sign-in, desktop software rendering and public builds on supported architectures before declaring implementation complete. Reconcile pending bot specifications before archive. This record authorizes the architecture; it is not evidence that these implementation gates have passed.
