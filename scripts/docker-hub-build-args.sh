#!/bin/sh
# Prints the `docker build` arguments that take Docker Hub images from the
# mirror named by TERMINAY_DOCKER_HUB_MIRROR, one per line. The internal Gitea
# CI sets it, because Docker Hub rate-limits its runners. Everywhere else it is
# unset, nothing is printed, and builds pull from Docker Hub as before.
#
# DOCKER_HUB replaces docker.io/library in each Dockerfile's FROM lines.
# BUILDKIT_SYNTAX replaces the `# syntax=docker/dockerfile:1.7` frontend.
# The mirror holds both at the same tags and digests as Docker Hub.
set -eu

mirror=${TERMINAY_DOCKER_HUB_MIRROR:-}
[ -n "$mirror" ] || exit 0
case "$mirror" in
  *[!A-Za-z0-9./:_-]*)
    echo "TERMINAY_DOCKER_HUB_MIRROR is not a registry path: $mirror" >&2
    exit 64
    ;;
esac
printf '%s\n' \
  --build-arg "DOCKER_HUB=$mirror" \
  --build-arg "BUILDKIT_SYNTAX=$mirror/dockerfile:1.7"
