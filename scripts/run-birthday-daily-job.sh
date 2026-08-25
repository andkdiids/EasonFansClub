#!/usr/bin/env sh
set -eu

# The secret is supplied by the host environment (or a root-readable env file
# sourced by cron). It is never stored in this repository or echoed by curl.
: "${DAILY_JOB_SECRET:?DAILY_JOB_SECRET is required}"

DAILY_JOB_URL="${DAILY_JOB_URL:-http://127.0.0.1:${PORT:-3000}/api/internal/daily-jobs/birthday}"

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout "${DAILY_JOB_CONNECT_TIMEOUT_SECONDS:-3}" \
  --max-time "${DAILY_JOB_TIMEOUT_SECONDS:-45}" \
  --request POST \
  --header "x-daily-job-secret: ${DAILY_JOB_SECRET}" \
  --header 'content-type: application/json' \
  --data '{}' \
  "${DAILY_JOB_URL}"
