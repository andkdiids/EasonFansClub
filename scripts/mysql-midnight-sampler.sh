#!/usr/bin/env bash
set -euo pipefail

# Read-only sampler. It emits TSV to stdout; redirect it to a file on the
# server. No SQL in this script writes, locks, truncates or changes data.
: "${MYSQL_HOST:?MYSQL_HOST is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"

MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_DATABASE="${MYSQL_DATABASE:-}"
MIDNIGHT_TIMEZONE="${MIDNIGHT_TIMEZONE:-Asia/Shanghai}"
export MYSQL_PWD="${MYSQL_PASSWORD}"
trap 'unset MYSQL_PWD' EXIT

mysql_args=(--host="$MYSQL_HOST" --port="$MYSQL_PORT" --user="$MYSQL_USER" --batch --raw --skip-column-names)
if [[ -n "$MYSQL_DATABASE" ]]; then mysql_args+=(--database="$MYSQL_DATABASE"); fi

sample_at="$(TZ="$MIDNIGHT_TIMEZONE" date --iso-8601=seconds)"
server_timezone="$(timedatectl show --property=Timezone --value 2>/dev/null || date +%Z)"
printf '# sample_at=%s timezone=%s server_timezone=%s\n' "$sample_at" "$MIDNIGHT_TIMEZONE" "$server_timezone"

status_names="Threads_connected|Threads_running|Questions|Queries|Slow_queries|Innodb_row_lock_waits|Innodb_row_lock_time|Connections|Select_scan|Select_full_join|Created_tmp_tables|Created_tmp_disk_tables|Handler_read_rnd_next"
while IFS=$'\t' read -r name value; do
  printf '%s\t%s\t%s\n' "$sample_at" "$name" "$value"
done < <(mysql "${mysql_args[@]}" -e "SHOW GLOBAL STATUS WHERE Variable_name REGEXP '$status_names';")

while IFS=$'\t' read -r name value; do
  printf '%s\t%s\t%s\n' "$sample_at" "$name" "$value"
done < <(mysql "${mysql_args[@]}" -e "SHOW GLOBAL VARIABLES WHERE Variable_name = 'max_connections';")

if [[ "${MYSQL_CAPTURE_PROCESSLIST:-0}" == "1" ]]; then
  printf '# processlist_begin=%s\n' "$sample_at"
  mysql "${mysql_args[@]}" -e "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, LEFT(INFO, 240) FROM information_schema.PROCESSLIST ORDER BY TIME DESC LIMIT 100;" || printf '# processlist=permission_denied_or_unavailable\n'
  printf '# processlist_end=%s\n' "$sample_at"
  mysql "${mysql_args[@]}" -e "SELECT trx_id, trx_started, trx_state, trx_wait_started, trx_mysql_thread_id, trx_query FROM information_schema.INNODB_TRX ORDER BY trx_started;" || printf '# innodb_trx=permission_denied_or_unavailable\n'
  mysql "${mysql_args[@]}" -e "SELECT REQUESTING_ENGINE_LOCK_ID, BLOCKING_ENGINE_LOCK_ID FROM performance_schema.data_lock_waits LIMIT 100;" || printf '# data_lock_waits=permission_denied_or_unavailable\n'
  mysql "${mysql_args[@]}" -e "SHOW ENGINE INNODB STATUS\G" | grep -E 'LATEST DETECTED DEADLOCK|TRANSACTIONS|WAITING|lock wait|WE ROLL BACK' || true
fi
