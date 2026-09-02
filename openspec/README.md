# Terminay specifications

This directory is the product source of truth for Terminay. It uses
[OpenSpec](https://github.com/Fission-AI/OpenSpec) with the `spec-driven-with-adr`
workflow: describe a capability, propose a change against it, implement it, then
archive the change so its deltas fold back into the capability.

## Map

| Path | Contents |
| --- | --- |
| [`specs/`](./specs/) | 28 capability specifications — the canonical product contract |
| [`changes/`](./changes/) | Active, unimplemented work |
| [`changes/archive/`](./changes/archive/) | Completed changes, kept as delivery history |
| [`adr/`](./adr/) | Durable architecture decision records, with `evidence/` |
| [`config.yaml`](./config.yaml) | Project context and per-artifact authoring rules |
| [`schemas/`](./schemas/) | The vendored `spec-driven-with-adr` workflow schema |

Product purpose, the core model, and the architecture boundaries live in
[`docs/product-overview.md`](../docs/product-overview.md). Operator runbooks live
in [`docs/operations/`](../docs/operations/).

## Working agreement

A capability spec states the required behaviour in present tense, as though it had
always been that way. Requirements are normative (`SHALL`/`MUST`) and every one
carries at least one testable scenario. Legacy, transitional, migration, and
cleanup framing belongs in a change, never in a capability spec.

ADRs are immutable once accepted. To revisit a decision, record a new ADR that
supersedes it; readers derive what is in force by walking `Supersedes:` links.

## Commands

```bash
openspec list                 # active changes
openspec list --specs         # capabilities
openspec view                 # interactive dashboard
openspec validate --all       # validate specs and active changes
openspec validate --archived  # validate the archive, which --all does not walk
```

Propose new work with `/opsx:propose` (Claude Code) or the `openspec-propose`
skill, then apply and archive it through the matching workflows.

## A note on the schema

`schemas/spec-driven-with-adr/` is a vendored copy of the community schema from
[intent-driven-dev/openspec-schemas](https://github.com/intent-driven-dev/openspec-schemas),
modified so ADRs live at `openspec/adr/` rather than the repository root. Re-running
the upstream installer would overwrite that change; re-apply it if you ever do.
