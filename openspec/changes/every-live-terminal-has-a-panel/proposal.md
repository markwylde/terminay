## Why

A project can show no terminals while one is still running in it. The sidebar's General folder reads `0`, the panel area says no terminals are open, and yet closing the project warns "A process is still running in this project". Clicking OK kills a shell the user never saw. A terminal nobody can see cannot be read, answered, or closed, and it makes the close warning look broken.

ADR-0071 already decided that every running terminal has a panel, but the server enforced that only when it created a terminal and when it recovered shells after a restart. Several paths still leave a running PTY without a panel:

- closing a tab sends the shell a signal, then removes its panel whether or not the shell exits (a kill that fails is ignored);
- creators spawn the PTY first and commit its panel afterwards, and a standalone server's startup restore spawns terminals with no panel at all;
- a restart re-adopts any persisted session record as live, whether or not a panel names it;
- host-applied `panel.close` and `project.close` never end the PTY.

## What Changes

- The server keeps the rule continuously: a running terminal that has had no panel for a short grace (5 seconds, long enough for every creator to commit its own panel) is given a new panel in its project's General folder, wherever General sits in the folder order, titled with the project's next `Terminal N`.
- A running terminal whose project no longer exists is ended, as closing a project ends its terminals.
- The server checks after every workspace change and once when it starts. It holds a timer only while a panel-less terminal waits out its grace. Nothing is polled.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: adds the requirement that a running terminal always has a panel, and how one found without a panel is placed.

## Impact

- Server: new `packages/server-core/src/liveTerminalPanels.ts`, bound in `packages/server-core/src/composition.ts` (checked at start, released at shutdown before the terminal service stops).
- No protocol, persistence, or renderer change. A recovered panel is an ordinary `panel.create` or `terminal.createPanel` commit, so every client shows it through the existing workspace change.
