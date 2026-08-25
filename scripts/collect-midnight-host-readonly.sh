#!/usr/bin/env bash
set -u

# Host-side read-only snapshot. It intentionally does not invoke process or
# service control commands, or any database write command.
echo '# timezone'
date --iso-8601=seconds
if command -v timedatectl >/dev/null 2>&1; then timedatectl show --property=Timezone --value; fi

echo '# pm2 list'
if command -v pm2 >/dev/null 2>&1; then
  pm2 list
  if [[ -n "${PM2_APP_NAME:-}" ]]; then pm2 describe "$PM2_APP_NAME"; fi
else
  echo 'pm2=not_found'
fi

echo '# system resources'
uptime || true
free -m || true
if command -v vmstat >/dev/null 2>&1; then vmstat 1 2 || true; fi
if command -v iostat >/dev/null 2>&1; then iostat -xz 1 2 || true; fi
if command -v ss >/dev/null 2>&1; then ss -s || true; fi

echo '# nginx performance log configuration'
if command -v nginx >/dev/null 2>&1; then
  nginx -T 2>&1 | grep -E 'log_format|access_perf|request_time|upstream_response_time|/api/' || true
else
  echo 'nginx=not_found'
fi
