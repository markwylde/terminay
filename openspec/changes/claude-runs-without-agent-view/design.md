## Context

Agent status binds a session to a terminal when the session's process descends
from the terminal's PTY shell and shares its controlling terminal
(`ProcessAncestry.sharesTerminal`). The controlling-terminal check keeps
detached servers a terminal spawned from claiming it.

Claude Code's agent view breaks that check. Observed on 15 November 2026:

```
bash (pts/0, the tab)
└─ claude                                   pts/0  agent view client
   └─ claude daemon run --origin transient  ?      no controlling terminal
      └─ claude bg-pty-host …               ?
         └─ claude --session-id …           pts/1  the conversation
```

The conversation descends from the tab's shell, but on `pts/1`, so it is
external and drives no tab status.

## Goals / Non-Goals

**Goals:** keep Claude Code conversations bound to the terminal they start in;
write nothing into Claude Code's configuration; affect nothing outside
Terminay terminals.

**Non-Goals:** binding daemon-hosted conversations back to a terminal. The
daemon is shared, `claude attach` can move a conversation between terminals,
and nothing Claude Code exposes maps a conversation to the terminal driving it.
That is the same reason Codex runs with `--no-daemon`.

## Decisions

1. **Turn agent view off, rather than relax binding.** Relaxing the
   controlling-terminal rule would bind detached servers again, and would bind
   a shared daemon's conversations to whichever terminal happened to start the
   daemon.
2. **Environment, not a flag.** Claude Code 2.1.325 has no flag for this.
   `--settings='{"disableAgentView":true}'` blocks `claude agents` but still
   starts a `--bg` session. `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, which Claude
   Code documents as equivalent to the `disableAgentView` setting, refuses
   `--bg`, `claude agents`, and the daemon.
3. **Set on the integrated shell, not per command.** The variable goes in the
   environment Terminay starts the integrated shell with. That covers a typed
   `claude`, a launcher, an alias, and a script, with no new shell code in the
   four integration scripts and no change to launcher lines. The cost is that
   every program in the terminal sees the variable. Only Claude Code reads it.
4. **The user wins.** A variable already in the shell's environment, from the
   server or the profile, is not overridden. Startup files run afterwards and
   can change it. A variable two defaults both set is set by neither.
5. **Support is proven by asking Claude Code.** `claude agents --json`, run
   with the variable set, refuses before doing anything and names the
   variable. The answer is cached per executable path, size, and modification
   time, as the Codex `--help` check is.

## Boundaries

- **ADR-0051 (observe, do not instrument):** crossed with the owner's approval,
  recorded in ADR-0124. Nothing is written into Claude Code's files.
- **ADR-0082 (shell integration fed only by data):** environment values reach
  the shell as data. Names are upper case, bounded, never `TERMINAY_`, and
  values hold no control characters. No script changes.
- **Extension trust boundary:** the host validates every resolution
  (`validateTerminalCommandDefaultResolution`) and the registry validates again.

## Risks / Trade-offs

- Users lose Claude Code's agent view inside Terminay terminals. They can turn
  the Claude Code harness off under Built-in Agents, or `unset` the variable in
  a terminal.
- The variable is not in `claude --help`. If Claude Code renames it, the probe
  stops matching, the default stops applying, and the bug returns, but nothing
  breaks.
