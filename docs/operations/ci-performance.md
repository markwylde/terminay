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

## Official container smoke

The local four-case image smoke proves pairing, approval, reconnect,
advertised/derived routing, a negative network control and sustained
connections. Its bare case also describes the installed upgrade mechanism
with the release service deliberately unreachable, asserting that lookup
failure is reported without hiding the available local upgrade capability.
Both GitHub's API and its HTML fallback are refused by that case's container
host mapping. The optional `--only upgrade` case retains real published-release
discovery and installation; it is explicitly network-dependent.

Image assembly consumes the standalone builder's fully validated and normalized
`--output-tree` result directly. Release archive callers keep deterministic
compression and archive digests. The direct image path avoids compressing a
temporary archive only to extract it into the same build stage. Image builds
may use the signed internal Turbo cache through ephemeral BuildKit secrets;
the credentials are not copied into the image.

## Linux pull-request dependency installs

Seven Linux jobs mount `terminay-ci-npm-cache` at `/var/cache/terminay-npm` in
their job container and set `npm_config_cache` to that same path. The volume
holds npm's integrity-verified download cache, never shared `node_modules`.
The existing Docker runner and executable test tmpfs isolation remain in use.
No cache-action archive or end-of-job upload is involved.

`sh scripts/install-ci-dependencies.sh` pins npm only when its version differs
from 12.2.1, then performs a real `npm ci` with lifecycle scripts enabled.
It prefers cached downloads, reports fetch/lifecycle timings, limits fetch
retries and bounds npm installation to 60 seconds and dependency installation
to 180 seconds, with a further ten-second termination grace. Install-time
advisory and funding requests are disabled; an advisory lookup does not affect
`npm ci`'s exit status. Required security and boundary tests are unchanged.
macOS, weekly benchmarks and release workflows retain their existing installers.

## Parallel E2E and archive measurements

Ordinary shards use two workers with separate Xvfb displays, profiles, ports and
renderer copies. Shared-setup files run in declaration order. The native-module
packaging shard uses one worker and is scheduled first by predicted wall time.
A seven-scenario Docker trial passed on first attempts in 78 seconds versus
121.8 seconds of summed test durations. Full-run verification remains required.

A representative 196 MB standalone payload compressed in 2.680 seconds at gzip
level 1 versus 21.937 seconds at level 9, producing 68.48 MB versus 60.19 MB.
CI requests level 1 explicitly; release defaults remain level 9. Tests verify
identical decompressed tar bytes, payload hashes and modes, deterministic gzip
metadata, and reproducibility at both levels.

During dependency installation, node-gyp reuses headers from the actual Node
executable's installation prefix only when `node_version.h` declares exactly
the running major, minor and patch version. Missing or mismatched headers keep
the normal pinned-download path. `npm_config_nodedir` is scoped to the install
child; it is not exported to later Electron rebuilds, which select Electron's
own headers. The floor image applies the same exact-version check.

Run 25350 (head `6932bf63`) finished all eighteen E2E shards, workspace tests,
packaged platform checks, floor/systemd checks and container scenarios
successfully. The run failed its fast gate on a stale assertion that rejected
the new daemon-owned tool-cache volume; the assertion is corrected to retain
the prohibition on repository bind mounts. This run took 819 seconds from
creation to completion and is a budget miss. Its E2E image took 377 seconds
and several Linux dependency installs took about four minutes. It must not be
used as evidence of a five-minute green run.

## Linux artifact producer and independent consumers

`Build Linux floor artifacts (linux-x64)` builds the standalone archive and
AppImage once in the floor environment, records their SHA-256 digests and
uploads two revision-named artifacts. It copies only those distributable bytes
out of Docker; the unpacked Electron staging directory stays in the producer.
Both `Linux glibc floor (linux-x64)` and `Standalone systemd restart (linux-x64)`
depend directly on that producer. Each checks transferred digests before use;
the floor's static and clean-runtime probes can run alongside the real systemd
scenarios. Readiness requires the producer and both consumers successful.
Record both artifact transfers when comparing the added handoff cost with the
removed serial dependency. Queue delays from overlapping runs remain separate
from the dependency wait.

The final local workspace concurrency comparison capped server-core at six test
files: all 31 tasks passed in 168.502 seconds, with core tests in 70.812 seconds.
Both watcher responsiveness assertions retain their 250 ms limit and the wide
directory fixture retains all 30,000 files. A four-file trial slowed core tests
to 138.84 seconds and is not the selected configuration.

## Bot production-image build cache

The bot MCP CI driver may use `TERMINAY_BOT_MCP_IMAGE_CACHE` as an internal
registry repository for disposable build cache. Its key binds the complete
production context fingerprint, generated Dockerfile (including the CI mirror)
and actual Docker daemon architecture. A pulled cache must report the expected
platform and production fingerprint. The driver still builds the original
production Dockerfile with that image as BuildKit `--cache-from` and runs every
agent, desktop, source and MCP ownership suite. It never caches test success.
Only after all suites pass does it publish the resulting image with inline
build-cache metadata. Production bots keep their local-only image build path.

A cache miss still pays for the full production desktop image and counts toward
the run budget. Run 25353 spent 96.3 seconds installing system packages and
176.3 seconds installing pinned creative applications and browser tooling;
downloading the creative packages itself took only 16 seconds. The bottleneck
was installation, so parallel downloads would not remove most of that cost.
Actual registry transfer/cache-hit performance requires a subsequent CI run.

Run 25353 (head `93c066f7`) verified the cache and isolation rollout: Linux
installs took 19–24 seconds, the E2E image took 58 seconds, and official-image
smoke took 173 seconds. Every E2E shard passed, finishing 412 seconds after
creation. The workspace gate failed its unchanged responsiveness assertion;
the six-file concurrency fix was then verified locally. Systemd ran for
129 seconds after waiting 495 seconds beyond its floor dependency. Another
main run began at 16:05:22 UTC, two minutes into this run, followed by another
PR; shared-fleet contention remains included. Final completion was 16:17:49
UTC, 867 seconds after creation, so this is another failed budget observation.

The parallel systemd driver prepares its source-channel test archive once in
the parent using gzip level 1. Before host extraction it rejects unsafe tar
paths, duplicates, links, special files and special permissions, then validates
the original complete payload, modes and native architecture. Preparation
changes only the manifest's channel to `source`; private provenance binds both
archive digests and both manifests. Each child checks those digests and the
permitted metadata edit before copying the same prepared bytes into its own
container; the in-container driver checks the transferred digest and source
identity again. The parent removes the shared temporary archive after all
children finish or are stopped. Serial API callers retain their existing path.

The allocator now reserves the native-packaging bin at capacity one and assigns
remaining units by predicted completion time at each bin’s worker capacity.
On run 25350 evidence this reduces the native bin from about 165 to 85 seconds
and keeps ordinary bins near 85 seconds, with exactly-once native selection
validated for all 718 identities. Eighteen shards remain the selected plan.

CI collects trace/video on the first retry; local retain-on-failure defaults,
first-failure screenshots/logs and retry counts are unchanged. Four serialized
Docker trials (32 passed cases) measured mean wall time 87.868 versus 63.617
seconds and CPU time 208.332 versus 135.749 seconds. A deliberate first-attempt
failure separately proved screenshot/error context retention and successful
retry trace/video files. This saves routine recording work but an initial
failure’s trace/video comes from the retry, not the original attempt.
