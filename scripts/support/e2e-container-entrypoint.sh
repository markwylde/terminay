#!/bin/sh
set -eu

exec xvfb-run --auto-servernum npx playwright test "$@"
