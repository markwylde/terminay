# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude
- Change: bot-browser-sandbox-under-apparmor

## In-Force ADR Context Reviewed

- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - the bot container is the isolation boundary this change keeps intact.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - the engine may not share the server's view of host policy, so the server asks the engine with probe containers.
- openspec/adr/0098-bot-desktop-owns-graphical-applications.md - the desktop owns Chromium, which must run sandboxed.
- openspec/adr/0011-security-trust-boundary-model.md - the profile is a mandatory-access-control boundary; only user-namespace creation is added.
- openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md - the root upgrade helper is where existing installs gain the profile.

## Repository-Level ADRs Created

- openspec/adr/0119-bot-containers-run-under-a-terminay-apparmor-profile-that-allows-user-namespaces.md - Terminay ships and root-installs a docker-default-plus-userns profile; the server uses it only when the engine needs and has it; Chromium's sandbox is never disabled.

## Notes

Measured on Debian 13 (kernel 6.12, AppArmor 4) before proposing.
