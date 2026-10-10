# ADR-0057: Nothing Terminay writes into a terminal is a secret, so no feature moves a vault entry into a PTY

Status: accepted
Date: 2026-10-10

## Context

Macros had a `secret` step. A user saved a credential in a Secrets Manager, and
a macro pasted it into the terminal at the chosen point. The stated purpose was
to keep the credential away from the agent working in that terminal.

It cannot do that. Bytes written to a PTY are delivered to whatever program is
reading it. When that program is a coding agent, the agent receives the
credential as input, may echo it, and may carry it into its own transcript and
its provider's logs. The same holds for any shell with history, any program
with a debug log, and any recording of the session. Terminay cannot know or
control what the reader does.

The implementation also crossed the vault boundary of ADR-0003 in the wrong
direction. A macro definition is authored in the renderer, which ADR-0011
treats as untrusted. The server's macro secret resolver read whichever vault
entry a step named and wrote it to the terminal, so untrusted content selected
a vault entry and caused its plaintext to leave the server.

A feature that presents itself as protection and provides none invites people
to put real credentials where they are exposed.

## Decision

1. **Terminal input is not confidential.** Terminay treats every byte it
   writes to a PTY as visible to the program reading it and to anything that
   program does with it. No feature may describe terminal input as hidden from
   an agent or a program.
2. **No vault entry is written to a PTY.** Macros, automations, MCP tools, and
   any future command that produces terminal input take their content from
   their own definitions and from values the user supplies at run time. None of
   them resolves a vault entry into terminal input.
3. **Vault entries are consumed by server-side callers only.** A vault entry
   is delivered to a privileged server callback that uses it itself: a
   provider adapter making an API call, the extension secret broker, a
   connected-server launcher building a child process environment. The entry
   to read is chosen by server-owned configuration, never by an identifier
   inside renderer-authored or agent-authored content.
4. **A credential a program needs reaches it outside the terminal stream.**
   Where Terminay later helps deliver a credential to a program it starts, it
   does so through that process's environment or configuration at launch, under
   a decision of its own, and not by typing.

## Consequences

- The macro `secret` step, the Secrets Manager, and the macro secret resolver
  are removed. A stored macro that still holds a secret step is kept and does
  not run.
- A user who wants a credential in a terminal session sets it up in the shell
  environment or the program's own configuration. Terminay offers no shortcut
  for that today.
- A proposal to "insert a password", "paste a token", or "fill a prompt from
  the vault" into a terminal is rejected by this record unless a new ADR
  supersedes it with a mechanism that keeps the value from the reader.
- Macro file fields, text fields, and run-time values remain ordinary input.
  A user can still type a credential into a field by hand; Terminay does not
  store it in the vault and makes no claim about it.
- ADR-0003 is unchanged. The vault keeps its other consumers.
