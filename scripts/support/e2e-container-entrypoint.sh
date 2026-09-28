#!/bin/sh
set -eu

# Run the suite, then print the slowest tests into the log. The summary never
# changes the result: the container exits with Playwright's status.
set +e
xvfb-run --auto-servernum npx playwright test "$@"
status=$?
set -e

node scripts/summarize-e2e-timings.mjs test-results/e2e-timings.json || true

exit "$status"
