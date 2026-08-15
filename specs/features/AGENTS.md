# AGENTS — feature specifications

Each file documents the required behaviour of one product capability.

- Use lowercase kebab-case filenames and link related feature specs.
- Describe required product behaviour directly in present tense; include
  acceptance outcomes and important non-goals, privacy/security boundaries,
  persistence, and failure behaviour.
- Keep implementation detail only where it protects an architectural boundary
  or makes the contract testable. Put active delivery sequencing in `../tasks/`.
- Write each feature as the complete, correct product contract, as though the
  specified behaviour has always been the product. A feature spec must not
  describe old, legacy, deprecated, removed, replaced, transitional, migration,
  cleanup, or backwards-compatibility behaviour—not even to say that such
  behaviour no longer exists.
- State only what exists and how it behaves. For example, write "The red button
  is on the home page and clicking it shows an alert," not that a blue button
  used to exist, is being removed, was replaced, or must be removed first.
- Put implementation gaps and cleanup sequencing in `../tasks/`, completed
  history in `../tasks_completed/`, and lasting architectural rationale in
  `../decisions/`. Do not preserve delivery history in a feature definition.
