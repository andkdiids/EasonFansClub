#!/usr/bin/env bash
set -Eeuo pipefail

if ! declare -F deploy_atomic_switch >/dev/null 2>&1; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  source "${script_dir}/deploy-safety.sh"
fi

if [ "$#" -ne 6 ]; then
  echo "Usage: $0 APP_DIR EXPECTED_CANDIDATE_SHA EXPECTED_CANDIDATE_RELEASE PM2_APP_NAME GITHUB_REPOSITORY APP_PORT" >&2
  exit 2
fi

APP_DIR="$1"
EXPECTED_SHA="$2"
EXPECTED_CANDIDATE_RELEASE="$3"
PM2_APP_NAME="$4"
GITHUB_REPOSITORY="$5"
APP_PORT="$6"
releases_dir="${APP_DIR}/releases"
current_link="${APP_DIR}/current"
shared_dir="${APP_DIR}/shared"

die() { echo "ERROR: $*" >&2; exit 1; }

[ "$APP_DIR" = "/home/apps/easonfansclub" ] || die "Unexpected production application directory."
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || die "Expected candidate SHA is invalid."
case "$EXPECTED_CANDIDATE_RELEASE" in
  "${releases_dir}/"*) ;;
  *) die "Expected candidate release is outside the release root." ;;
esac
[ "$PM2_APP_NAME" = "easonfansclub" ] || die "Unexpected primary PM2 application name."
[[ "$GITHUB_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Repository identifier is invalid."
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || die "Application port is invalid."
command -v pm2 >/dev/null 2>&1 || die "PM2 is unavailable."
command -v git >/dev/null 2>&1 || die "Git is unavailable."
command -v curl >/dev/null 2>&1 || die "curl is unavailable."
command -v flock >/dev/null 2>&1 || die "flock is unavailable."
[ -L "$current_link" ] || die "Production current is not a symlink."

test -f "${APP_DIR}/.deploy.lock" || die "Deployment lock file is missing."
exec 9<>"${APP_DIR}/.deploy.lock"
flock -w 360 9 || die "Timed out waiting for the deployment lock."

active_target="$(deploy_current_target "$current_link")"
deploy_is_release_child "$active_target" "$releases_dir" || die "Current target is not a valid release child."
expected_candidate_target="$(deploy_normalize_path "$EXPECTED_CANDIDATE_RELEASE")"
if [ "$active_target" != "$expected_candidate_target" ]; then
  active_sha=""
  if [ -s "${active_target}/.deployed-sha" ]; then
    active_sha="$(tr -d '[:space:]' < "${active_target}/.deployed-sha")"
  fi
  if [ -z "$active_sha" ] && [ -e "${active_target}/.git" ]; then
    active_sha="$(git -C "$active_target" rev-parse HEAD 2>/dev/null || true)"
  fi
  echo "ROLLBACK_RESULT=SKIPPED_CURRENT_CHANGED"
  echo "ROLLBACK_VERIFIED_SHA=${active_sha:-UNKNOWN}"
  exit 0
fi
deploy_is_release_child "$EXPECTED_CANDIDATE_RELEASE" "$releases_dir" || die "Expected candidate release is invalid."
origin_url="$(git -C "$active_target" remote get-url origin 2>/dev/null || true)"
[ -n "$origin_url" ] || die "Current release has no verifiable Git origin."
[[ "$origin_url" != https://*:*@* ]] || die "Refusing a Git origin with embedded credentials."
case "$origin_url" in
  "git@github.com:${GITHUB_REPOSITORY}.git"|"https://github.com/${GITHUB_REPOSITORY}.git"|"https://github.com/${GITHUB_REPOSITORY}") ;;
  *) die "Current release origin does not match the workflow repository." ;;
esac
active_sha=""
if [ -s "${active_target}/.deployed-sha" ]; then
  active_sha="$(tr -d '[:space:]' < "${active_target}/.deployed-sha")"
fi
if [ -z "$active_sha" ] && [ -e "${active_target}/.git" ]; then
  active_sha="$(git -C "$active_target" rev-parse HEAD 2>/dev/null || true)"
fi
if [ "$active_sha" != "$EXPECTED_SHA" ]; then
  echo "ROLLBACK_RESULT=SKIPPED_CURRENT_SHA_CHANGED"
  echo "ROLLBACK_VERIFIED_SHA=${active_sha:-UNKNOWN}"
  exit 0
fi

rollback_record="${active_target}/.rollback-target"
[ -s "${rollback_record}" ] || die "Candidate has no deployment-specific rollback record."
mapfile -t rollback_record_lines < "${rollback_record}"
[ "${#rollback_record_lines[@]}" -eq 2 ] || die "Candidate rollback record is malformed."
rollback_target="${rollback_record_lines[0]}"
rollback_sha="${rollback_record_lines[1]}"
deploy_is_release_child "$rollback_target" "$releases_dir" || die "Recorded rollback target is invalid."
[ -s "${rollback_target}/.deployed-sha" ] || die "Rollback target has no deployed SHA marker."
recorded_rollback_sha="$(tr -d '[:space:]' < "${rollback_target}/.deployed-sha")"
[[ "$rollback_sha" =~ ^[0-9a-f]{40}$ ]] || die "Rollback SHA marker is invalid."
[ "$recorded_rollback_sha" = "$rollback_sha" ] || die "Candidate rollback record does not match the rollback release SHA."

pm2_app_snapshot() {
  local app_name="$1" raw
  raw="$(pm2 jlist)" || return 1
  printf '%s' "$raw" | node -e '
    let raw = "";
    process.stdin.on("data", chunk => raw += chunk);
    process.stdin.on("end", () => {
      try {
        const app = JSON.parse(raw).find(entry => entry.name === process.argv[1]);
        if (!app) process.exit(1);
        const env = app.pm2_env || {};
        process.stdout.write(JSON.stringify({
          status: env.status || "",
          pid: Number(app.pid || env.pid || 0),
          cwd: env.pm_cwd || "",
          script: env.pm_exec_path || "",
          args: Array.isArray(env.args) ? env.args.join(" ") : String(env.args || ""),
          deploySha: env.DEPLOY_SHA || ""
        }));
      } catch { process.exit(2); }
    });
  ' "$app_name"
}

verify_pm2_app() {
  local app_name="$1" snapshot status pid cwd script args deploy_sha process_cwd
  snapshot="$(pm2_app_snapshot "$app_name")" || return 1
  status="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$snapshot")"
  pid="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).pid))' "$snapshot")"
  cwd="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).cwd)' "$snapshot")"
  script="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).script)' "$snapshot")"
  args="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).args)' "$snapshot")"
  deploy_sha="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).deploySha)' "$snapshot")"
  [ "$status" = online ] && [ "$pid" -gt 0 ] && [ "$cwd" = "$current_link" ] && [ "$deploy_sha" = "$rollback_sha" ] || return 1
  process_cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
  process_cwd="${process_cwd% (deleted)}"
  [ "$(deploy_normalize_path "$process_cwd")" = "$rollback_target" ] || return 1
  case "$app_name" in
    "$PM2_APP_NAME")
      case "$script" in npm|*/npm|npm.cmd|*/npm.cmd) ;; *) return 1 ;; esac
      [ "$args" = "run start" ]
      ;;
    instagram-sync-worker)
      case "$script" in */node_modules/tsx/dist/cli.mjs|node_modules/tsx/dist/cli.mjs) ;; *) return 1 ;; esac
      [ "$args" = "scripts/instagram-sync-worker.ts" ]
      ;;
    *) return 1 ;;
  esac
}

reload_named_app() {
  local app_name="$1" attempt
  [ "$app_name" = "$PM2_APP_NAME" ] || {
    echo "Refusing to reload ${app_name}; only the web process is eligible for automatic rollback." >&2
    return 78
  }
  export NODE_ENV=production DEPLOY_SHA="$rollback_sha" PORT="${APP_PORT:-3000}"
  cd "$current_link"
  [ -s .env ] || return 1
  deploy_run_pm2_reload "$app_name" 2m pm2 reload ecosystem.config.js --only "$app_name" --update-env || return $?
  for attempt in $(seq 1 30); do
    if verify_pm2_app "$app_name"; then return 0; fi
    sleep 1
  done
  return 1
}

verify_local_health() {
  local attempt response
  for attempt in $(seq 1 10); do
    response="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT:-3000}/api/health/live" || true)"
    if printf '%s' "$response" | node -e '
      let raw = "";
      process.stdin.on("data", chunk => raw += chunk);
      process.stdin.on("end", () => {
        try { process.exit(JSON.parse(raw).release === process.argv[1] ? 0 : 1); }
        catch { process.exit(1); }
      });
    ' "$rollback_sha" &&
       [ "$(deploy_current_target "$current_link")" = "$rollback_target" ] &&
       verify_pm2_app "$PM2_APP_NAME"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

echo "Restoring prior release ${rollback_sha} after guarded health failure."
deploy_atomic_switch "$rollback_target" "$current_link" "$releases_dir" || die "Atomic rollback switch failed."
reload_named_app "$PM2_APP_NAME" || die "Primary application did not reload on the rollback release."
verify_local_health || die "Rollback release SHA or local health verification failed."
if ! printf '%s\n' "$EXPECTED_SHA" > "${active_target}/.deploy-failed"; then
  echo "WARNING: rollback verified, but the failed-candidate marker could not be written." >&2
fi
echo "ROLLBACK_RESULT=RESTORED"
echo "ROLLBACK_VERIFIED_SHA=${rollback_sha}"

