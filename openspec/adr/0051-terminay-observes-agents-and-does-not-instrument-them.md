# ADR-0051: Terminay observes agents and does not instrument them, except where the owner has approved it

Status: accepted
Date: 2026-10-08

## Context

Terminay shows what coding agents are doing: which terminal an agent runs in,
whether it is working or waiting, and what it is called. ADR-0025 settled how:
a machine-wide detection library reads what each agent already writes, and the
host binds a session to a terminal by process ancestry.

The `linked-folders` change needed to know which terminal created a Git
worktree. The first design answered that from agent behaviour: it watched for
an agent's reported directory moving into the new worktree. A spike showed that
this works for one agent, when it uses one particular tool, and not for others
(see [worktree capture signals](./evidence/worktree-capture-signals.md)). Making
it work everywhere would have meant asking each agent to behave differently, or
adding a hook to each. The repository owner stopped the design there and asked
for the rule to be written down.

The pressure is recurring. Every agent has a hook system, a settings file, and
launch flags, and each is the shortest path to some feature. Each one also
changes a tool the user configured themselves, breaks when the agent updates,
and makes a Terminay feature work in some agents and not others.

## Decision

1. **Terminay does not instrument an agent.** It does not install hooks into an
   agent, write or edit an agent's settings or configuration, wrap or replace an
   agent's executable, add flags or environment variables in order to change how
   an agent behaves, or send an agent input on its own initiative.
2. **A feature does not depend on which agent is in the terminal.** Where a
   feature needs to know what happened in a terminal, it learns that from the
   terminal: its processes, its output, and the files and repositories it works
   on. If a feature can only be built by knowing agent internals, it is either
   limited to presenting agent status, which ADR-0025 covers, or it is not
   built.
3. **Reading what an agent already writes stays allowed.** Passive detection
   through the library of ADR-0025 is observation, not instrumentation, and is
   unchanged.
4. **An exception needs the owner's explicit approval, recorded in an ADR.** A
   reviewer, an implementer, or an agent working on Terminay cannot grant one.
5. **One exception is approved: installing the Terminay MCP server.** When a
   user asks Terminay to connect an agent to its MCP server, Terminay may write
   that one entry into the agent's MCP configuration. It writes nothing else
   there, and only on that request.

## Consequences

- Capturing a terminal into the folder of a worktree it created is designed
  around the terminal and Git, not around the agent, and works the same for any
  agent, a script, or a person typing.
- Some agent-specific conveniences will not be built, or will arrive later than
  a hook would have delivered them.
- An agent update cannot break a Terminay feature other than agent status and
  the MCP entry.
- Variables Terminay sets in its own terminals for its own purposes, such as the
  terminal capability variables, are not agent instrumentation. A variable that
  changes the behaviour of another tool the user runs in the terminal is a
  separate question and is decided where it comes up.
- Reviewers should treat a new write under an agent's configuration directory,
  or a new agent hook, as a defect unless an ADR names it.
