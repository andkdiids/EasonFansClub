#!/usr/bin/env sh
set -eu

# The secret is supplied by the host environment (root-readable env file sourced
# by cron). It is never stored in this repository or echoed by curl.
: "${DAILY_JOB_SECRET:?DAILY_JOB_SECRET is required}"

# KIND is weekly (Monday) or monthly (1st). The settlement endpoint resolves
# the previous full period from the wall clock by itself.
KIND="${LEADERBOARD_SETTLEMENT_KIND:-weekly}"
case "$KIND" in
  weekly|monthly) ;;
  *) echo "invalid LEADERBOARD_SETTLEMENT_KIND: $KIND" >&2; exit 2 ;;
esac

DAILY_JOB_URL="${DAILY_JOB_URL:-http://127.0.0.1:${PORT:-3000}/api/internal/daily-jobs/leaderboard-rewards}"

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout "${DAILY_JOB_CONNECT_TIMEOUT_SECONDS:-3}" \
  --max-time "${DAILY_JOB_TIMEOUT_SECONDS:-120}" \
  --request POST \
  --header "x-daily-job-secret: ${DAILY_JOB_SECRET}" \
  --header 'content-type: application/json' \
  --data "{\"kind\":\"${KIND}\"}" \
  "${DAILY_JOB_URL}"
