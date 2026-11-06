## Context

Chat renders the shared message log through `BotTranscript`, which also renders execution transcripts in Sessions and groups consecutive agent items into one turn. Messages already carry `sequence` and `createdAt`. The rail reads `ServerBots.upcoming`, fetched with a limit of three.

## Goals / Non-Goals

**Goals:** separate, timed messages; a visible unread boundary; read state that settles without a click; one row per trigger in the rail.

**Non-Goals:** unread badges in the sidebar, read state shared across devices, changes to the Sessions transcript or the Triggers tab's Coming up strip.

## Decisions

- **Read position is a per-device view hint.** It is stored in `localViewState` as the highest message `sequence` read, keyed by bot id and bounded. Which messages one device has looked at is view state, like the selected tab, and the server owns no per-device reader state today. A bot never seen on this device starts fully read, so first use shows no divider over old history.
- **The divider is fixed for the visit.** On entering Chat the stored position is snapshotted; the divider sits before the first bot message after it and stays put while the user reads, including messages that arrive during the visit. Leaving (Chat hidden, the component unmounting, or `document.visibilityState` becoming hidden) writes the latest loaded sequence. Returning recomputes the divider. Sending a message also marks everything read and removes the divider: the user has plainly caught up.
- **Chat messages are not grouped.** `BotTranscript` gains an optional per-key meta map. When given (Chat), every agent message is its own block with avatar, name and time; without it (Sessions), turns group as before.
- **Initial position.** If the divider exists and the content below it is taller than the viewport, Chat scrolls the divider near the top and stops following the bottom; otherwise it keeps the existing bottom-pinned behaviour.
- **Distinct upcoming.** `useServerBots` fetches up to 250 firings so a frequent trigger cannot hide others from the window; `distinctUpcoming` keeps each trigger's earliest firing, marks it repeating when more than one firing exists, and the rail shows the first three.

## Risks / Trade-offs

- A trigger firing more often than 250 times within the window can still crowd out triggers that fire later than that horizon → acceptable for a three-row summary; the Triggers tab remains complete.
- Read state does not follow the user between devices → stated non-goal; it can move server-side later without changing the UI.
