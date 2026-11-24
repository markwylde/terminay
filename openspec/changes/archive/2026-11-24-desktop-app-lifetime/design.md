## Context

The local session launched foreground `gridcraft` at 20:25:06 on 2026-11-04; its tool process ended with code -1 at 20:25:27. This supports tool-lifetime termination but does not establish the exact signal sender. Independently, `terminay-run` explicitly ends its process group after the CLI exits. The running container retained Chromium but no Gridcraft process.

`terminay-browser` already serves bounded requests over an owner-only Unix socket, runs as `bot` under `terminay-init`, launches Chromium outside agent groups, and redirects output. `terminay-tool-shell` enforces work ownership and strips execution secrets from ordinary tools. `memories.ts` gives browser-specific launch instructions but no equivalent for other apps. `bot-init.test.mjs` exercises browser dispatch with fake executables.

The ADR directory and Supersedes fields were reviewed. Relevant live commitments are ADR-0028 (event-driven lifecycle), ADR-0093 (execution capability and work ownership), ADR-0094 (engine attribution), and ADR-0096 native CLI drivers (desktop in the existing bot container and protected dispatch). No accepted ADR needs superseding. The broad phrase “no command the turn started keeps running” in the stopping requirement needs narrowing to session-owned commands; its process-group boundary stays intact.

## Goals / Non-Goals

**Goals:** Keep desktop apps and unsaved in-memory documents available between executions; preserve Stop for agent commands; provide one documented launch path and useful diagnostics.

**Non-Goals:** Host app launch, arbitrary persistent background jobs, automatic app restart, restoring unsaved documents after container shutdown, app installation, and a new desktop control UI. Browser URL dispatch remains unchanged.

## Decisions

1. Add `terminay-app` as a desktop-owned request service and client, following the existing browser helper. Start it once from `terminay-init` as `bot`, wait for readiness through the existing event-driven mechanisms, and package it in the bot Dockerfile. Use `terminay-app launch gridcraft` with optional literal arguments after `--`. This crosses the session/desktop lifetime boundary only inside the owning bot container. Prompt-only `&`, `nohup`, or `setsid` is rejected because it relies on agent improvisation and provides no consistent diagnostics or environment hygiene. Removing group cleanup is rejected because Stop must still terminate session commands.
2. Use an owner-only Unix socket, bounded JSON messages (8 KiB), a simple executable basename identifier, at most 64 string arguments, and direct argv execution without a shell. Resolve installed executables through the fixed desktop PATH; reject paths, control characters, malformed shapes, and oversized requests. Support installed graphical executables generally, rather than a Gridcraft-only fix or freedesktop Exec parsing. This is not a new sandbox: agents already execute commands as bot. Preserve the existing execution-capability and shared-work gate at agent dispatch, including native shell paths; do not grant new renderer or workspace authority.
3. Launch from the service's clean desktop environment, never the requesting session environment. Do not pass session nonce, runtime tokens, provider credentials, or stdio handles. Set stdin to null and output to bot-local per-application logs with a documented size bound/rotation. Reap children through SIGCHLD; no polling or automatic restart. Acknowledge successful process creation, return synchronous errors, and expose later startup failures in diagnostics. Independent app failure must leave the service available for later requests.
4. Update bot instructions to use the helper for graphical apps, reuse existing windows where practical, preserve unsaved work, and inspect a fresh screenshot after launch. Keep website requests on `terminay-browser`. The UI's process-group explanation must explicitly say desktop apps outlive Stop and end when the bot container stops.

## Risks / Trade-offs

- [An application exits after acceptance] → Distinguish acceptance from visual success; provide diagnostics and screenshot verification.
- [Desktop apps accumulate] → Explicit user/app close and bot container stop remain lifecycle controls; no automatic reopening.
- [Tool requests lose their work lease] → Keep request dispatch gated; desktop ownership never implies execution authority.
- [Unknown app argument behavior] → Pass literal argv and let the executable interpret its arguments; do not promise single-instance behavior or parse desktop entries.
- [Existing overlapping bot changes] → Keep the overlapping stopping requirement in `add-terminay-bots` aligned with this change. `adopt-atlas-bot-runtime` uses the separate `bot-desktop` capability and remains additive. Sync/archive `add-terminay-bots` and `adopt-atlas-bot-runtime` before `desktop-app-lifetime`, preserving browser, credential, work-ownership, and cleanup contracts.

## Migration Plan

Ship the helper, init wiring, and instructions together through the normal local bot-image build. Existing containers need replacement through the existing rebuild flow; warn that stopping/replacing a container ends unsaved app state. Do not hot-patch the user's running container. Rollback uses the previous usable image and matching instructions; no stored-state schema changes are needed.

## Open Questions

None blocking planning. Real Gridcraft persistence and both native CLI request paths require implementation verification; the observed exit code alone is not proof of a particular cleanup signal.
