## Why

A project tab announces activity with a numbered circle after its title. It is large, it competes with the title, and the number says little: what matters is whether the project wants you, not how many terminals do. Meanwhile the terminal tab right below it already has the right answer — a small dot before the label that breathes while working. In the top right, up to three coloured count circles sit side by side, so the answer to "does anything need me?" has to be read off three numbers, and nothing there can be cleared without visiting each terminal.

## What Changes

- **BREAKING** The project tab's activity count badge is removed. The project tab shows the same status dot a terminal tab shows — same size, colours, and breathing effect — placed before the title and coloured by the most urgent state in the project.
- The project switcher menu and compact switcher rows show that same dot instead of the count badge.
- **BREAKING** The header's three coloured count badges are replaced by one always-visible Notifications icon carrying a single red number: terminals that need attention plus terminals that finished unviewed, across every attached server. Working terminals are not counted. At zero the icon stays and the number hides.
- The Notifications list groups notifications first and working terminals in a separate, uncounted **Working** section. Each notification row has a dismiss control and the list has **Clear all**. Working rows cannot be dismissed.
- Dismissing a notification is the same acknowledgement as viewing the terminal: its tab dot, its project dot, and the header number clear together, on every attached client.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the project tab and switcher rows present a status dot before the title instead of a count badge after it; the overflow layout follows the dot.
- `agent-status-and-sidebar`: the header presents a single Notifications control with one red total, a sectioned list, and dismiss / clear all, in place of three fixed-size count badges.
- `terminal-activity-signals`: dismissing a notification is an acknowledgement equivalent to selecting the terminal tab; wording follows the dot and the single header number.
- `workspace-dashboard`: the notable-only surfaces are named as the Notifications list and the project tab dots.

## Impact

- UI: `src/workspace/ProjectTabList.tsx`, `ProjectSwitcherMenu.tsx`, `CompactSwitcher.tsx`, `ProjectTabActivityBadge.tsx` (replaced), `TerminalActivityOverview.tsx` (becomes the Notifications control), `activityCountBadge.ts`, `src/components/AgentStatusIndicator.tsx` (reused), `src/App.tsx` wiring, `src/App.css`.
- No protocol, server, or persistence change: dismissal uses the existing `activity.acknowledge` and agent acknowledge operations.
- Tests: `e2e/project-tabs.spec.ts`, `e2e/terminal-signals.spec.ts`, `e2e/terminal.spec.ts`, and unit tests for the badge and overview models locate elements by the classes being removed.
- Settings are unchanged: **Show indicator for active tabs** and **Show indicator for finished tabs** keep governing what appears.
