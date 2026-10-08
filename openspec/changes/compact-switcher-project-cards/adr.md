# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-08
- Reviewer: Claude (for Mark Wylde)
- Change: compact-switcher-project-cards

## In-Force ADR Context Reviewed

Depth of review: 0049 and 0053 were read for their decisions. Every other ADR was screened by title and `Status` line only, which is enough to build the supersession graph and to see that a renderer-only presentation change does not engage it.

- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - names the compact switcher as a separate presentation not covered by the shared frame, so the sheet keeps its own scrim and dismissal.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - a folder carries no authority; choosing the folder a terminal is created in grants nothing and needs no new command.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - supersedes ADR-0018. The switcher lists the window's server; this change does not alter what it lists.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - Add connection keeps its existing path.
- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. No privileged call, protocol command, or Electron IPC is added.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - folder selection, like Home tabs, is device-local presentation; the create bar's label reads it and does not persist it.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - the header summary is counted from states the rows already present and asks the server for nothing.
- Screened by title and not engaged: 0002, 0003, 0005, 0006, 0007, 0012, 0013, 0015, 0016, 0017, 0019, 0020, 0021, 0023, 0025, 0026, 0027, 0028, 0029, 0031, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0041, 0042, 0043, 0044, 0045, 0046, 0050, 0052.
- Superseded and treated as history only: 0001 (by 0033), 0004 (by 0035), 0008 (by 0018), 0009 (by 0017), 0010 (by 0032), 0014 and 0024 (by 0025), 0018 (by 0047), 0022 (by 0028), 0030 (by 0031), 0032 (by 0036).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It redraws one renderer surface over commands and data that already exist.

## Notes

The highest ADR sequence number in use is 0053.
