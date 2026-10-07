# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-08
- Reviewer: Claude
- Change: session-holder-diagnostics

## In-Force ADR Context Reviewed

- openspec/adr/0035-detached-session-holder-owns-ptys.md - the holder protocol stays internal, local, and at its current version; the closing notice is an additive message a server may ignore, and holders already running keep their frozen code and simply never send it. The close record holds no terminal output, so decision 5 is untouched.
- openspec/adr/0028-no-polling-without-owner-approval.md - close records are read once at server start and on a connection closing; nothing polls or watches for them.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - `server-core` reports to whichever host composes it and owns no log sink; Desktop records to diagnostics, standalone to its service log.
- openspec/adr/0011-security-trust-boundary-model.md - reports carry no session id, credential, socket path, or generation; the close record lives inside the data root that already bounds the holder socket.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md - reports are made on lifecycle transitions only; nothing is added to the output path.
- openspec/adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md - the unattached limit is recorded, not changed; whether a wall-clock limit misfires after sleep is something the recorded times will show.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Reporting through a host-supplied observer follows the pattern already used for Git observation and file-operation failures. If the history gathered by this change shows sessions are lost to a dropped connection followed by limit expiry, a reattach policy would revisit ADR-0035 decision 4 and need an ADR of its own.
