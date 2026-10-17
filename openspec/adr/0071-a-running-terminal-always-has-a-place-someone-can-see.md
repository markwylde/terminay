# ADR-0071: A running terminal always has a place someone can see

Status: accepted
Date: 2026-10-17

## Context

An agent opened terminals that kept running but appeared nowhere the user
looked. Pixel's terminals went to the automation space. That space is never a
project tab, and the Tabs section left it out on purpose. A project in a
workspace view that no window shows is just as invisible. On restart, a shell
the session holder still had but the workspace did not name was ended without
a trace (ADR-0035 recovery, `reattachHeldSessions`), even though it might still
be doing work someone wanted.

A terminal nobody can see cannot be read, answered, or closed. A user who is
told "seven terminals" and can find two has lost trust in the workspace.

## Decision

1. **Every running terminal belongs to a project and has a panel.** No path
   creates a running terminal without both, and closing a panel or project
   ends its terminals (unchanged).
2. **A shell found running on restart that the workspace does not name is
   recovered, not ended.** It gets a panel in a new project named "Recovered
   terminals" in the server's first view, and is adopted under that project.
   A held shell that has already ended, or that the workspace names for
   another server, is ended as before. On a freshly initialised workspace, the
   one session about to be created is still not mistaken for a lost one.
3. **The Tabs section lists every terminal on the window's server,** including
   those this window does not present:
   - the automation space, listed after the window's projects;
   - projects of other workspace views, marked "not in this window".

   Activating an automation-space terminal opens it in the Automations
   section. Activating a terminal of another view's project brings that
   project into this window.
4. The automation space is still never a project tab or a project, and the
   project tab bar still shows only the window's own view.

## Consequences

- A restart can add a project the user did not create. It is named for what
  it is, and closing it ends its terminals like any other project.
- The Tabs section and the Home overview now count terminals outside the
  window's own projects.
- A future surface that hides terminals by placement must list them somewhere
  else, or it breaks this rule.
