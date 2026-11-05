#!/usr/bin/env sh
set -eu

# The secret comes from the protected host env file and is never printed.
: "${DAILY_JOB_SECRET:?DAILY_JOB_SECRET is required}"

SCHEDULED_POST_PUBLICATION_JOB_URL="${SCHEDULED_POST_PUBLICATION_JOB_URL:-http://127.0.0.1:${PORT:-3000}/api/internal/daily-jobs/scheduled-post-publication}"

if curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout "${POST_PUBLICATION_JOB_CONNECT_TIMEOUT_SECONDS:-3}" \
  --max-time "${POST_PUBLICATION_JOB_TIMEOUT_SECONDS:-50}" \
  --request POST \
  --header "x-daily-job-secret: ${DAILY_JOB_SECRET}" \
  --header 'content-type: application/json' \
  --data '{}' \
  "${SCHEDULED_POST_PUBLICATION_JOB_URL}"; then
  exit 0
else
  curl_status=$?
  if command -v logger >/dev/null 2>&1; then
    logger -p daemon.err -t easonfansclub-scheduled-post-publication "cron invocation failed (curl exit ${curl_status}); see /var/log/eason-fans-club/scheduled-post-publication.log"
  fi
  exit "${curl_status}"
fi
