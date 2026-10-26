# ADR-0075: Management lives in one Settings surface; collections get a list column, workspace content lives in Home

Status: accepted
Date: 2026-10-26

## Context

Terminay grew a management window per feature: Settings, Remote Control, Macros,
and Recordings. Each was its own Desktop auxiliary window and its own in-page
management window (ADR-0053), and all of them were reached from a File menu that
held no files. Settings could show only a category and its page, so any feature
whose content was a list of things (servers, macros, extensions) was given a
window of its own instead of a second level. The result was duplicated chrome,
duplicated CSS, a Settings page whose only content was a button to another
window, and people not knowing where a thing was managed.

New features keep arriving with the same shape (a list of things to configure),
so the rule for where they go needs to be decided once.

## Decision

1. **Settings is the only management surface.** Configuring Terminay or a server,
   including anything that is a list of configurable things, happens in a
   Settings category. A feature does not get its own management window or
   Desktop auxiliary route.
2. **Collections use the list column.** A category whose content is a
   collection declares a list model (sections, items, status, add action) and a
   detail renderer. Settings then presents it as sidebar, list column, and
   detail. Other categories stay sidebar and page.
3. **Workspace content lives in Home.** Things a user browses or opens as
   workspace content (automations, their runs, recordings and their replays) are
   Home sections whose items open as Home tabs (ADR-0040), not Settings
   categories.
4. **Scoping stays explicit inside one surface.** Server-scoped categories act
   on the server chosen in the Settings server selector, through that
   connection's own clients. Host-owned lists (the saved servers) come from the
   host and do not follow the selector. Putting both in one surface never
   merges their data or their authority.
5. **The first menu is the application's.** No host has a File menu. The first
   menu is named Terminay and holds creation commands and Settings.

## Rejected alternatives

- **Keep a window per feature, restyled to match.** It fixes the look but not
  the hunting, and every new feature adds another window and route.
- **A tree sidebar or drill-down pages inside Settings.** A tree gets long with
  many items, and drill-down costs a click per item. The list column keeps the
  master-detail layout people already used in Remote Control and Macros.
- **Recordings as a Settings category.** Recordings are content a user opens
  and replays, like automation runs, not configuration.

## Consequences

- Adding a list-shaped feature means writing a category module with a list
  model and a detail. There is no new window or route to wire up.
- Desktop's auxiliary-route allow-list shrinks to Settings, Performance Log, and
  edit windows. A request for a removed kind is refused like any unknown one.
- A collection category that keeps an explicit save (Macros) has to own its
  pending state for as long as Settings is open and confirm before Settings
  closes.
- Supersedes nothing. ADR-0053 still governs the in-page frame and now has
  one management window to apply to.
