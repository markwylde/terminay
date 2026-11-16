## Why

On a phone, the Tabs page shows a working agent as a blue dot. On desktop, the
same agent shows the amber, breathing dot that the agent-status contract
requires. "Needs you" is amber on phones but red on desktop. The phone section
pages define their own colour set, which has drifted from the indicator used
everywhere else. A phone user therefore reads the wrong state.

## What Changes

- Tabs rows on a compact workspace use the same status indicator as the
  desktop dashboard: the same component, colours, size rule and breathing
  effect. Working is amber and breathing, needs you is red, done is green and
  idle is neutral grey.
- An untracked tab, or an idle tab with no agent, shows its kind icon instead
  of a status dot.
- Every other compact section page (Workflows, Bots, Automations, Recordings)
  takes its status marks, status chips and attention text from one shared
  palette of status colours. That puts running work in amber, needs you in red
  and done in green, matching their desktop views.
- The status colours are defined once, as shared CSS custom properties. Both
  the desktop indicator and the compact pages read them, so the two cannot
  drift.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-dashboard`: adds requirements that compact Tabs rows use the
  desktop status indicator, and that every compact section page uses the
  desktop status colour vocabulary.

## Impact

- `src/components/AgentStatusIndicator.css`: declares the shared status colour
  properties and uses them.
- `src/workspace/compact/compactSection.css`: status tones, chips, attention
  text and the working mark read the shared properties; the working mark
  breathes.
- `src/workspace/WorkspaceDashboard.tsx` (`TabsCompactRow`): renders
  `AgentStatusIndicator`.
- `src/workspace/bots/bots.css` and `BotsCompactPage.tsx`: bot dot colours
  alias the shared properties, and a queued bot's chip is informational.
- No protocol, server or data change.
