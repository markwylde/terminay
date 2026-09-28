#!/bin/sh
# Frees the Docker images a CI job leaves behind on its runner.
#
# A runner's Docker store outlives its jobs and nothing else clears it. Two
# things fill it: the conformance and MCP CLI images are rebuilt every run
# under a fixed ":local" tag, which strands the previous build as an untagged
# image of a couple of gigabytes, and every commit adds a new
# content-addressed E2E image. Left alone they grow a runner by hundreds of
# gigabytes in a few days, until the node runs out of disk.
#
# The newest E2E image and dependency base survive, along with the ones named
# by the first and second arguments, so the next pull on this runner reuses
# the base's layers. Cleanup is best effort: it never fails the job it runs in.
set -u

keep_image=${1:-}
keep_base=${2:-}

# A stopped container pins its image. Runners take one job at a time, so any
# stopped container here belongs to a job that has already finished.
docker container prune --force >/dev/null || true

# Keep the newest image in a repository and the one this job used; remove the
# rest. For the dependency base this keeps the layers every later per-commit
# E2E image is built on, while superseded bases do not accumulate.
prune_repository() {
  repository=$1
  keep=$2
  references=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository" || true)
  newest=$(printf '%s\n' "$references" | head -n 1)
  for reference in $references; do
    if [ "$reference" = "$newest" ] || [ "$reference" = "$keep" ]; then
      continue
    fi
    docker image rm "$reference" >/dev/null || true
  done
}

prune_repository git.i.wylde.net/markwylde/terminay-e2e "$keep_image"
prune_repository git.i.wylde.net/markwylde/terminay-e2e-base "$keep_base"

docker image prune --force || true
