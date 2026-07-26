# Terminal workspace

## Summary

Terminay provides native PTY terminals inside the project workspace. Electron
creates and owns each session; xterm renders it in a panel and forwards input,
resize, clipboard, and lifecycle actions through the preload contract.

## Behaviour

- New sessions resolve the configured shell and launch mode. They inherit a
  sensible working directory from the active terminal/project when applicable.
- Terminals support splits, search, copy/paste including bracketed-paste-aware
  input, dropped paths, guarded external links, resizing, scrollback, zoom, and
  exit handling.
- A tab can be renamed and styled manually with colour, emoji, terminal-theme
  controls, and an optional note. Tab context actions expose terminal-specific
  actions such as recording and moving it to another project.
- The Command Bar exposes terminal and workspace actions; terminal commands
  report an inline failure rather than silently targeting a different panel.
- PTY output fans out in the main process to the renderer and the authorised
  recording, remote, activity, and agent integrations. These consumers do not
  change the terminal stream.

## Safety and accessibility

The terminal is untrusted text: link navigation is protocol-guarded, paste and
external drop behaviour remain user initiated, and screen-reader/reduced-motion
settings are honoured. Secrets typed in a terminal are not collected by default;
recording has its own explicit policy.

## Acceptance outcomes

- Terminal identity survives panel moves and native-window adoption.
- Resize and input reach only the intended live PTY.
- An exited terminal is clearly represented and cannot be accidentally reused as
  a live session.

