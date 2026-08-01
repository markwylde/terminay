# AGENTS — product specifications

`CORE.md` is the product-level source of truth. `features/` contains one
canonical specification per product capability. Read and update the applicable
feature spec before changing that capability's implementation.

- Use `tasks/` only for active, unimplemented work. Name task files with the
  next numeric prefix, concise slug, goal, scope, implementation slices, and
  definition of done.
- Move completed implementation plans to `tasks_completed/`; preserve their
  decisions and checked items as history.
- Do not leave proposals, transition notes, implementation status, or stale
  checklists in feature specs. Describe the required product behaviour in
  present tense; put every implementation gap and delivery sequence in an
  active task.
- Keep feature documents implementation-aware but product-led: state the user
  contract, boundaries, persistence/security constraints, and testable outcomes.
