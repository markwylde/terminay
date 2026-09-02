## Context

See proposal.md. This is CI plumbing: it changes which jobs run on a pull request and on main,
not what the product does.

## Goals / Non-Goals

Goals: a fast, provider-portable pull-request gate that is sharded across independent runners
and bounded by runner capacity.

Non-Goals: changing test content, changing the release pipeline's evidence, or coupling the gate
to one CI provider's features.

## Decisions

- Pull-request CI is exactly six eligible jobs: one build/lint/unit job and five independent
  Docker E2E shards. Shards are independent so a provider can schedule them in any order and a
  single shard failure localizes the problem.
- Release, image, and native architecture evidence is release-path work, not merge-confidence
  work, so image workflows lose their pull-request and ordinary-main triggers and native arm64
  stays in the manual release path.
- Stale runs are cancelled and runner-capacity boundaries are stated explicitly so the gate stays
  portable across providers rather than relying on one provider's queueing behaviour.

## Risks / Trade-offs

Removing image and native-architecture jobs from pull requests means a packaging regression is
caught later, in the release path, rather than at merge time. This was accepted as the cost of a
fast merge gate.

## Migration Plan

Verified on the real provider rather than assumed: Gitea created exactly six eligible pull-request
jobs — PR #50 run 6747 produced one build/lint/unit job plus five independent E2E shards. PR #50
run 6747 and post-merge main run 6749 both completed all six jobs successfully.
