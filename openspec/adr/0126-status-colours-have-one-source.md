# ADR-0126: Status colours have one source

Status: accepted
Date: 2026-11-16
Supersedes: none

## Context

Agent, terminal and workflow status share one colour vocabulary: amber for
working, red for needs you, green for done and neutral for idle. Several
surfaces drew it from their own copies of the hex values. The compact section
page kit then shipped its own palette, which drew working in the blue accent
and needs you in amber. Phones contradicted desktop, and nothing in review
flagged it.

## Decision

Status colours are declared once, as CSS custom properties on `:root`
(`--status-working`, `--status-attention`, `--status-done`, `--status-idle`),
next to `AgentStatusIndicator`. Any surface that expresses agent, terminal,
workflow or bot status reads them, directly or through a local alias. It never
declares its own values. Where a surface shows a per-item agent status dot, it
renders `AgentStatusIndicator`, not a look-alike.

Alternatives rejected:

- **Per-surface palettes with matching values.** This is what drifted. Nothing
  keeps the copies equal.
- **A TypeScript colour map passed as inline styles.** This splits styling
  between CSS and JS, and blocks theming through custom properties.
- **A design-token build step.** It is heavier than four properties need, and
  the renderer already uses custom properties for theming.

## Consequences

- Phones and desktop cannot disagree about a status colour, and changing one is
  a single edit.
- A surface's status colours depend on `AgentStatusIndicator.css` being loaded.
  A surface that uses them imports that stylesheet itself, rather than relying
  on load order.
- Lighter text tints derived for a particular surface, such as bot status text,
  remain local. They are shades for legibility, not the status colour itself.
