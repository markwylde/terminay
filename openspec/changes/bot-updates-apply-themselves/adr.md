# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: bot-updates-apply-themselves

## In-Force ADR Context Reviewed

- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - one container and home per bot; the update keeps the home and touches only the bot's owned resources.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - container removal still goes through the pinned local engine socket.
- openspec/adr/0098-bot-desktop-owns-graphical-applications.md - desktop apps outlive executions but not their container; the idle update runs only while no desktop is open and accepts closing them.
- openspec/adr/0120-bot-containers-run-under-a-terminay-apparmor-profile-that-allows-user-namespaces.md - a changed AppArmor choice also makes a container out of date and is applied by the same idle update.
- openspec/adr/0028-no-polling-without-owner-approval.md - the removal wait subscribes to engine container events under a one-shot deadline; it never re-checks state on a timer.
- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - an open shell or desktop counts as use and blocks the idle update.

## Repository-Level ADRs Created

- openspec/adr/0131-an-idle-bot-takes-its-container-update-before-its-next-run.md - an out-of-date running container is recreated before the bot's next run when nothing else uses it, and the fingerprint covers only built inputs.

## Notes

The Files helper removal race and the conflict message are bug fixes inside the existing engine boundary. They need no ADR.
