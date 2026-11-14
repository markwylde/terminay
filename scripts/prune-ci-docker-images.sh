#!/bin/sh
# Frees the Docker images a CI job leaves behind on its runner.
#
# A runner's Docker store outlives its jobs and nothing else clears it. Two
# things fill it: the conformance and MCP CLI images are rebuilt every run
# under a fixed ":local" tag, which strands the previous build as an untagged
# image of a couple of gigabytes, and every commit adds a new
# content-addressed E2E image. Builds also leave BuildKit cache and anonymous
# volumes behind. Left alone they grow a runner by hundreds of gigabytes in a
# day, until the node runs out of disk.
#
# The newest E2E image and dependency base survive, along with the ones named
# by the first and second arguments, so the next pull on this runner reuses
# the base's layers. Cleanup is best effort: it never fails the job it runs in.
set -u

timed_prune() {
  phase=$1
  shift
  prune_started=$(date +%s)
  "$@" >/dev/null || true
  echo "CI Docker cleanup $phase: $(($(date +%s) - prune_started))s"
}

keep_image=${1:-}
keep_base=${2:-}

# A stopped container pins its image. Runners take one job at a time, so any
# stopped container here belongs to a job that has already finished.
timed_prune containers docker container prune --force

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

timed_prune e2e-images prune_repository git.i.wylde.net/markwylde/terminay-e2e "$keep_image"
timed_prune dependency-images prune_repository git.i.wylde.net/markwylde/terminay-e2e-base "$keep_base"

timed_prune dangling-images docker image prune --force

# Keep the most recently used build cache. Dockerfile builds such as the bot
# image download hundreds of megabytes of apt packages in one layer; wiping the
# cache after every job made each run fetch them again over the internet. The
# cap matches the runner fleet's scheduled prune (gitea-runner-docker-prune).
timed_prune build-cache docker builder prune --force --keep-storage 10GB
timed_prune anonymous-volumes docker volume prune --force
