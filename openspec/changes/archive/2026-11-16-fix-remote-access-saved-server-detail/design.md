## Context

Settings › Remote Access renders `SharedConnectionsRouteBody` in its `settings` presentation. A saved server's detail reused the page presentation's confirmation panel (`shared-connections__action-panel`), which carries the connections page's own styling and no spacing against Settings cards. On Desktop the saved servers come from `useConnections().profiles`, a sanitized `ConnectionProfileSummary` list that already carries `status` and `attached`; the settings list dropped both and showed "Saved" for every row.

Boundary: the profile summary crosses from the host into the server-bundled UI. This change reads two fields that already cross that boundary and adds none.

## Goals / Non-Goals

**Goals:**

- The detail reads with the same hierarchy as the rest of Settings: section titles, grouped rows, buttons in Settings styles.
- Destructive actions are grouped, marked, and confirmed in place.
- The list says something useful about each saved server.

**Non-Goals:**

- Changing what forget, revoke or rename do, or adding new actions.
- Probing a server that is not attached to learn whether it is up.

## Decisions

1. **Settings gets its own confirmation markup.** The page presentation keeps its panel; the settings detail renders the confirmation inside the danger-zone group with Settings classes. Sharing one panel is what put connection-page styling into Settings.
2. **Show state only for an attached server.** A host knows the state of a connection it holds, not of one it does not. An unattached server stays "Saved · not attached" rather than guessing "offline".
3. **Cancel takes focus.** The confirmation replaces the button that opened it, so focus would otherwise be lost; Cancel is the safe landing place.
