# ADR-0098: The bot desktop owns graphical application processes

Status: accepted
Date: 2026-11-04

## Context

Bot executions deliberately end their process groups. A graphical application launched as an ordinary tool command can therefore disappear when the execution ends, losing unsaved work. The existing desktop-owned Chromium helper demonstrates independent desktop lifetime within the same bot container. Native CLI and work-ownership commitments remain in force.

## Decision

Graphical application launch is an explicit request to a service owned by the bot desktop, running as the bot user inside its existing container. Applications inherit clean desktop state and independent standard streams, outside agent and tool process groups. Execution closure and Stop retain these applications; container stop ends them. The service accepts bounded literal argv requests, preserves agent dispatch capability/work checks, provides local diagnostics, and never restarts an application without an explicit request.

Prompt-only backgrounding is rejected because it relies on each agent correctly detaching and sanitizing its launch. Weakening session cleanup is rejected because ordinary commands must still end on Stop. Host-owned launch is rejected because applications belong inside their bot container. This adds no host or workspace authority and supersedes no accepted ADR.

## Consequences

Unsaved work remains available between executions. Terminay maintains an additional image helper and its lifecycle/diagnostics. Launch acceptance cannot prove visual success; bot instructions require fresh screenshot verification. Unsaved state is not guaranteed across container replacement. Applications can remain open after Stop and this distinction must be visible to users.

## Open items

Real Gridcraft continuity, both native shell dispatch gates, clean environment, and container-stop cleanup were verified on 2026-11-04. See [verification evidence](../changes/desktop-app-lifetime/verification.md). No change-specific implementation gates remain.
