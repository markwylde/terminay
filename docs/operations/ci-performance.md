# CI readiness and performance

The target is less than 300 seconds from original run creation to completion of
all required checks. Queueing, cold caches, retries, uploads and teardown count.
A green run over that limit is a budget miss. CI runs on canonical Gitea;
GitHub is the release mirror, not a source of pull-request status evidence.

## Capture and report

Use the read-only `scripts/ci-run-timing.mjs` CLI with Node 24.15.0. It prints
JSON to stdout, so the caller chooses whether and where to save evidence:

```sh
timeout 60 node scripts/ci-run-timing.mjs capture.json > report.json
timeout 180 node scripts/ci-run-timing.mjs --fetch markwylde/terminay 25305 requirements.json > report.json
```

The fetch mode uses authenticated `tea api` GET requests, bounded to 20 seconds
per request. It reads every page until an empty page, allowing for server page
size caps, and rejects evidence exceeding its twenty-page safety limit.
It does not mutate runs, statuses or runners. The output is the report; preserve
raw API captures separately when reproducibility is required.

A captured envelope has this shape (the names here are illustrative):

```json
{
  "run": {
    "id": 123,
    "head_sha": "abc",
    "run_attempt": 1,
    "created_at": "2026-11-14T14:00:00Z",
    "completed_at": "2026-11-14T14:04:00Z",
    "status": "completed",
    "conclusion": "success"
  },
  "originalCreatedAt": "2026-11-14T14:00:00Z",
  "requiredStatuses": ["CI / Build E2E image (pull_request)"],
  "dependencies": {"Build E2E image": []},
  "jobs": [{
    "name": "Build E2E image",
    "status": "completed",
    "conclusion": "success",
    "run_attempt": 1,
    "started_at": "2026-11-14T14:00:10Z",
    "completed_at": "2026-11-14T14:03:50Z"
  }],
  "statuses": [{
    "context": "CI / Build E2E image (pull_request)",
    "status": "success",
    "updated_at": "2026-11-14T14:03:50Z"
  }],
  "attempts": [{"attempt": 1, "conclusion": "success"}],
  "fleet": null,
  "cacheConditions": null
}
```

`jobs` may also be the API's `{ "jobs": [...] }` wrapper. Status records accept
Gitea's `status` field or `state`. The requirements file for fetch mode contains
`requiredStatuses`, `dependencies` and any preserved `originalCreatedAt`,
`attempts`, `fleet` or `cacheConditions` metadata. List every required context
from the workflow and repository policy; deriving requirements only from
statuses already present would hide a missing check. Context strings include
the event suffix, and matrix shards each have their own context.

Readiness needs a completed successful/skipped run, every captured job
completed successfully/skipped, and every explicitly required status
successful/skipped. The most recent status for each context wins. The report
uses the last completion among jobs, required statuses and the run itself.
An absent requirement set cannot prove readiness. Do not supply a partial job
capture as evidence of the complete run.

Dependency mappings use job display names and list direct prerequisite display
names, expanding matrix jobs individually. An empty list explicitly marks a
root job. Only a complete successful prerequisite set on a first attempt lets
the tool calculate dependency wait and subsequent runner admission wait.
Unspecified or unresolved dependencies produce `null`, not a guessed queue.
Execution includes the whole job from its start through its completion.

## Retries and comparisons

Save original creation time and each attempt's raw evidence before requesting
a retry. Gitea can rewrite job `created_at` and `run_attempt` while preserving
successful jobs' earlier start/completion timestamps. A later shard start may
be a retry, rather than an original scheduling delay. For retry snapshots the
CLI requires independently preserved `originalCreatedAt` to calculate elapsed
time and leaves inferred queue waits unknown. Supply `attempts` to retain
previous failures; otherwise the report warns that history is incomplete.

Run 25305 provides a first-attempt baseline: creation at 14:09:45 UTC and final
completion at 14:29:14 UTC on 2026-11-14, or 1,169 seconds. The image producer
waited 484 seconds and executed for 48 seconds. The image completed at 14:18:37;
the last shard started at 14:22:31, another 234 seconds later. Run 25316's shard
3 start at 14:57:19 belongs to attempt 2 and must not be presented as a queue
from the image's earlier completion.

## Runner capacity and isolation

The intended fleet has thirteen Linux workers (eight on `pop-os`, five on
`home3`), one macOS worker and one separately labelled GPU worker. The owner
confirmed the Linux fleet was deliberately reduced on 2026-10-18 (commit
`7d62b81`); the seven old registrations were stale and have been removed.
They were not lost capacity and restoring them is not part of this plan.
A fresh `/admin/actions/runners` observation on 2026-11-14 lists all thirteen
Linux workers online, plus online macOS and GPU workers. Twelve Linux workers
were busy and one idle at that instant; availability changes with live work.
The GPU label does not provide `ubuntu-latest` capacity. Query instance-level
fleet state with `tea api` when authorized; repository-local runners may be empty.

Optimize scheduling and total work for these thirteen Linux slots. Eighteen
shards necessarily use more than one scheduling wave when other jobs occupy
slots. Start shared-image producers early, shorten long jobs and balance actual
shard durations; measure the resulting queue and full readiness time.

Keep one job per isolated Docker store. The cleanup script prunes stopped
containers and images globally inside that store; raising concurrency against
a shared store can destroy another job's resources. Do not treat stale
registrations as a reason to expand the fleet or require host access.

Compare fresh runs with all required statuses read back on the exact head SHA.
Record worker availability, overlap with other runs and cache conditions.
Keep misses in the evidence instead of selecting only warm, uncontended runs.

## Standalone systemd restart fixture

`node scripts/standalone-systemd-restart.mjs --archive ARCHIVE` builds the
`Dockerfile.systemd-test` runtime image once, then runs A, B and C concurrently
in separate privileged systemd containers. Each gets its own copied archive,
CLI and driver. No scenario shares a service unit, data root or mount namespace
with another. Failure stops sibling processes and removes their containers;
`TERMINAY_SYSTEMD_KEEP=1` deliberately retains containers for diagnosis.
The exported `runSystemdRestart` function still supports serial scenarios in
one container for callers that need that form.

The small image build context contains only the Dockerfile. Its dependency
layer and tag depend on the Dockerfile and Debian base reference, including
the internal mirror when configured. Package installation runs during image
build rather than at every container boot. A new worker or a pruned layer pays
that cold build cost and it remains part of readiness. Do not report the cache
optimization as a proven five-minute run without fresh Gitea evidence.

## Workspace execution evidence

The full 31-task workspace gate passed locally in 357.842 seconds on overlay
storage and 185.967 seconds with an executable 2 GiB tmpfs for disposable test
roots. Peak observed use was 358 MiB. Gitea run 25343 completed the workspace
job in 172 seconds, including job setup and teardown. These are individual gate
measurements, not evidence that the complete run meets the readiness target.

Production UI bundles use explicit Turbo inputs and workspace dependencies.
Release staging runs after restoration; native outputs retain their platform
provenance checks. Browser optimizer reuse additionally keys the absolute
checkout root and runtime, and validates metadata and referenced chunks.
Pinned Electron packaging downloads persist in a platform-specific Docker
volume; cold downloads still count toward the budget.
