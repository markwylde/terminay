## Context

`createAppUpdater().check()` paces network checks: hourly, or ten minutes when
forced by the host timer or after a failure. Renderers call `updater.check`
every five minutes (five seconds while busy) purely to read status. Nothing in
the product lets a person start a check.

## Goals / Non-Goals

**Goals:** a person can start a check now, learns what it found, and sees the
title-bar action update without waiting.

**Non-Goals:** no new renderer-initiated check. The `updater.check` host action
stays throttled, so an untrusted renderer still cannot drive the network faster
than the host's pacing (ADR-0011). No change to download, verification, install,
or channel rules (ADR-0027).

## Decisions

- **The check starts in the main process, from a native menu item.** The
  pacing bypass is a `manual` option on `AppUpdater.check` that only the menu
  handler passes. The renderer host action cannot set it.
- **A manual check joins a check already in flight** rather than starting a
  second one; the dialog then reports that check's result. A second click while
  one manual check is outstanding is ignored.
- **The outcome is a native message box.** A check that finds nothing would
  otherwise be indistinguishable from a menu item that did nothing. The wording
  is a pure function of `AppUpdateStatus` so it is unit-tested without Electron.
- **`updater.status.changed` carries no payload.** Renderers re-read status
  through the existing `updater.check` action, so there is one status shape and
  one parser. The event is an edge, not state, and is not replayed to late
  subscribers.
- **Help, not the macOS application menu.** One location on every platform,
  next to the other host-owned Help items.

## Risks / Trade-offs

- Repeated manual checks hit GitHub each time. They are human-paced and
  single-flight, and the beta feed is a static release asset, so this is not a
  rate-limit concern.
