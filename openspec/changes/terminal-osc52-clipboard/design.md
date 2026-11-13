## Context

Terminay renders terminals with xterm.js in the server-bundled workspace UI. That UI runs in the Desktop renderer, which reaches the native clipboard only through the presentation bridge's `clipboard.write` action, or in a browser, which uses the exact-origin Clipboard API. Selection copy (`copyTerminalSelection` → `writeClipboardText`) already uses both routes.

xterm.js parses OSC 52 but does nothing with it unless a handler is registered (or `@xterm/addon-clipboard` is loaded). Terminay registers none.

Output reaches the panel as `TerminalStreamEvent`s. The server marks output events read from its replay buffer `replay: true` and live PTY output `replay: false`. Checkpoint tails are decoded client-side with `replay: true`. Initial events delivered with an attach may be merged, and a merged event is `replay: false` if any part of it was live.

## Goals / Non-Goals

**Goals:**

- Live OSC 52 writes from any program in a terminal reach the clipboard of the device showing it, on Desktop and in a browser.
- No program can read the clipboard through the terminal.
- Replaying history never copies again.

**Non-Goals:**

- A separate primary selection. Every target writes the one system clipboard.
- Delivering copies made while no client was attached.
- A per-request confirmation prompt.
- Interpreting OSC 52 on the server, in recordings, or for MCP.

## Decisions

**Handle OSC 52 in the client with a small parser rather than `@xterm/addon-clipboard`.** The addon answers the `?` query when given a provider that can read, and writes through `navigator.clipboard` directly. Terminay needs the write to go through `writeClipboardText`, so that Desktop uses the bridge, and needs a hard guarantee that a query is never answered. A ~60-line parser with unit tests is easier to bound than configuring the addon around both. Boundary: renderer → presentation bridge. The renderer still sees only the semantic `clipboard.write` action, which the bridge validates (1 MiB, no C0 controls except tab and line breaks).

**Mark live output by event, not by time.** `renderTerminalOutput` takes a `live` flag and sets it for exactly the duration of that event's `terminal.write`. The render queue already awaits each write before the next, so the flag cannot leak onto another event's bytes. An output event is live when `replay === false` and its `position` is at or after `attachment.position` as it was when the attachment resolved. The position check catches an attach batch that merged replayed and live output. A copy that arrives in that same batch is treated as history and not delivered. That is the safe way to fail.

**Validate in the client the same way the bridge does.** The browser route has no bridge validation, so the parser refuses control characters, invalid UTF-8 and text over 1 MiB itself. Both hosts then behave the same, and a payload cannot carry `ESC [201~` or similar into a later paste.

**Always consume the sequence.** The handler returns `true` whether or not it writes, so xterm never falls back to anything else and nothing is ever written to the PTY.

**Connection-host setting, default on.** The clipboard is the device's. One user's phone and Mac attached to the same server may want different answers, so this is not a server setting. On by default matches Ghostty, kitty and WezTerm, and is what makes the reported problem go away without configuration.

## Risks / Trade-offs

- A program can replace the user's clipboard. That is the trust the user gives a program they run, and they can turn it off. Reading the clipboard is never possible.
- Every live client attached to the terminal is asked to write. A browser without focus or user activation refuses, silently. Desktop windows in the background do write.
- A copy delivered in the same batch as attach history is dropped.
