# ADR-0098: Project reach may curate the server's workflow templates, behind a group that asks

Status: accepted, supersedes ADR-0072 in part (decision 2: what project reach grants)
Date: 2026-11-04
Supersedes: ADR-0072 (decision 2, project reach scope only; every other decision continues)

## Context

ADR-0072 made reach the MCP authority line. Project reach grants control inside its own project "and nothing beyond it". Workspace reach controls the app.

Workflow templates (ADR-0097) are server-wide: every project's Command Bar lists the same templates. Users asked for agents to save and edit reusable templates while working, and nearly all agents run in project terminals. Under ADR-0072 only an automation-space terminal or a workspace chat could do that, which is the wrong place for the agent that just worked out the routine.

A template is user-authored text. Terminay never executes it (ADR-0097). Its prompts reach a terminal only when a user launches the template from the Command Bar, or when an agent copies it into a terminal it can already reach.

## Decision

1. **Project reach may create, update, and delete the workflow templates of its own server**, in addition to everything ADR-0072 grants it. This is the only server-wide state project reach may write. It does not extend to template order, category order or deletion, macros, settings, or anything else ADR-0072 reserves for workspace reach.
2. **Template writes form their own permission group, Workflow Templates, whose default is Ask Permission.** Its approval shows the template's name, category, and every step title. Reading templates is in Read Terminals.
3. **Copying a template into a terminal's workflow is a terminal operation.** It is authorised against that terminal like any workflow write and types nothing into it.

## Rejected alternatives

- **Workspace reach only.** It keeps ADR-0072 intact, but the feature would be unusable from the terminals where agents do their work.
- **Put template writes in Change Settings.** Change Settings also asks, but it is workspace-only. Sharing the group would tie "let agents curate templates" to "let agents change server settings".
- **Per-project templates.** These would keep project reach inside its project. They contradict the server-wide library users already have in Settings and the Command Bar.

## Consequences

- An agent in one project can change what other projects' Command Bars offer. The Ask default, the content shown in the approval, and Never Allow are the controls. Workflows already copied from a template never change.
- The trust-boundary review (ADR-0011) gains one exception. Project reach writes one kind of server-wide, never-executed, user-visible data, and only through an asking group by default.
- Extending project reach to any other server-wide state, such as macro CRUD, needs a new ADR. Narrowing this one back to workspace reach does not.
