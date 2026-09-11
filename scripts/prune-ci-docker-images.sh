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
# The newest E2E image survives, along with the one named by the first
# argument, so the next build on this runner still reuses its dependency
# layers. Cleanup is best effort: it never fails the job it runs in.
set -u

keep=${1:-}
repository=git.i.wylde.net/markwylde/terminay-e2e

# A stopped container pins its image. Runners take one job at a time, so any
# stopped container here belongs to a job that has already finished.
docker container prune --force >/dev/null || true

references=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository" || true)
newest=$(printf '%s\n' "$references" | head -n 1)
for reference in $references; do
  if [ "$reference" = "$newest" ] || [ "$reference" = "$keep" ]; then
    continue
  fi
  docker image rm "$reference" >/dev/null || true
done

docker image prune --force || true
