# ADR-0115: Settings are organised by the place that stores them

Status: accepted, supersedes ADR-0075 in part
Date: 2026-11-13
Supersedes: ADR-0075 (rule 4's "server selector", and its placement of the host's saved servers inside a server-scoped category: scoping inside Settings is now chosen on a place rail in which this device is a place of its own, and host-owned lists live under that place; the rule's substance, that scoping stays explicit and data and authority are never merged, continues, as does every other rule)

## Context

ADR-0075 put all management in one Settings surface and scoped server
categories with a server selector. Every setting already has exactly one
authority, server or connection host (`SETTING_AUTHORITY`). But Settings listed
both kinds side by side in one sidebar, five categories mixed them, and the
host's saved servers sat inside a category that otherwise followed the
selector. Users could not tell that the update channel changed only Terminay
Desktop, or that tab indicators changed every device connected to a server.

## Decision

1. **Settings is navigated by place.** A rail lists this device, then each
   attached server. Choosing a place shows only that place's categories.
2. **A setting's place is its authority.** Server-authority settings appear
   only under a server. Connection-host settings, device overrides and
   host-owned collections (saved servers) appear only under this device. A
   surface that spans servers through each server's own connection (Import &
   Export, ADR-0111) belongs to this device. A field may be listed under a
   different category for presentation, but never under a different place.
3. **Edits and resets are scoped to the place.** A device change sends no
   server operation, and a server change or reset leaves the device untouched.
4. **Every page names its place in words**, including who else it reaches.
5. **A server's release track is shown, not set, from Settings** until the
   upgrade protocol can carry a track. ADR-0062's rule that a client request
   carries only a mode is unchanged.

## Rejected alternatives

- **One sidebar with a This Mac / Server badge on each category.** It keeps
  mixed categories, so a user still has to read badges field by field.
- **A two-tab switch (This Mac | Server) with a server dropdown.** It hides
  which servers exist and needs two controls to reach a server.
- **Server settings in each server's connection menu.** It splits Settings
  across two entry points and hides server settings behind a menu.

## Consequences

- A new setting lands in its place by declaring its authority. The renderer
  keeps its own server-key set, and a contract test keeps it equal to
  `SETTING_AUTHORITY`.
- A category exists under a place only while that place has fields, a
  collection or a status page for it, so places have different category lists
  and some categories (Interaction, Scrolling, AI, Updates) appear under both.
- The same category name can mean different fields under different places,
  and commands that open a category must also choose a place.
- Moving saved servers out of Remote Access costs Remote Access its list
  column.
- Letting a client switch a server's track needs a new ADR that supersedes
  decision 5 and amends ADR-0062.
