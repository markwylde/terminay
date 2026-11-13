# ADR-0112: Live terminal output may write the viewing device's clipboard, and never read it

Status: accepted
Date: 2026-11-13

## Context

Programs copy to the clipboard with OSC 52 (`ESC ] 52 ; <targets> ; <base64> BEL`)
when they cannot reach a clipboard themselves. A program on a remote server has
no clipboard of its own and relies on this sequence: Claude Code, tmux and
Neovim all fall back to it. Terminay's terminals dropped it, so a user working
on a remote Terminay Server from Desktop or a browser could not copy from those
programs at all.

Honouring the sequence gives terminal output an effect on the device showing
it. Terminal content is untrusted text (terminal-workspace, "Terminal link and
input safety"), and the program writing it may run on another machine. OSC 52
also has a query form (`?`) that asks the terminal to send the clipboard back
into the PTY, which would hand that program whatever the user last copied,
passwords included.

A terminal's output is also replayed: on attach, on reconnect and from
checkpoints. A sequence parsed again during replay would copy something the
user copied long ago over what they copied since.

## Decision

1. A terminal client honours the OSC 52 **write** form only. Every target
   (`c`, `p`, `q`, `s`, `0`–`7`, or none) writes the one system clipboard. The
   query form is never answered, and nothing is ever written back to the PTY
   because of OSC 52.
2. Only **live** output may write. A client treats as live only output events
   the server marks as not replayed and that start at or after the position the
   attachment began streaming from. History delivered with an attach, checkpoint
   tails and recordings never write the clipboard.
3. The write goes through the host's existing semantic clipboard-write route:
   the Desktop bridge's `clipboard.write` action, or the browser's Clipboard
   API. OSC 52 adds no bridge action, no IPC and no server operation, and the
   server neither interprets nor forwards the sequence.
4. The decoded text is bounded to the bridge's 1 MiB clipboard bound, must be
   valid UTF-8, and may contain no control character other than tab, line feed
   and carriage return, so a copied payload cannot carry escape sequences into a
   later paste. An empty payload is ignored rather than clearing the clipboard.
5. Whether programs may write the clipboard is a **connection-host** setting,
   on by default: the clipboard belongs to the device, not to the server.

## Consequences

- Copying from programs on a remote server works the way it does in other
  terminal emulators.
- Every client attached live to a terminal receives the copy, so a phone
  watching the same terminal may also be asked to write its clipboard. Browsers
  refuse a clipboard write that has no user activation or focus, and that
  refusal is silent.
- A program the user runs can replace their clipboard contents. That matches
  the trust the user gives a program they run, and a device can turn it off.
  It can never read the clipboard.
- Copies made while a client was disconnected are not delivered on reconnect.
