# AGENTS — product specifications

`CORE.md` is the product-level source of truth. `features/` contains one
canonical, current-state specification per product capability. Read and update
the applicable feature spec before changing that capability's implementation.

- Use `tasks/` only for active, unimplemented work. Name task files with the
  next numeric prefix, concise slug, goal, scope, implementation slices, and
  definition of done.
- Move completed implementation plans to `tasks_completed/`; preserve their
  decisions and checked items as history.
- Do not leave proposals or stale checklists in feature specs. Mark intentional
  future scope as such and create an active task only when it is actionable.
- Keep feature documents implementation-aware but product-led: state the user
  contract, boundaries, persistence/security constraints, and testable outcomes.

