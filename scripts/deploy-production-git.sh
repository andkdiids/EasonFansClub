#!/usr/bin/env bash
set -Eeuo pipefail

umask 027
export GIT_TERMINAL_PROMPT=0

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 APP_DIR APP_PORT DEPLOY_SHA PM2_APP_NAME GITHUB_REPOSITORY" >&2
  exit 2
fi

APP_DIR="$1"
APP_PORT="$2"
DEPLOY_SHA="$3"
PM2_APP_NAME="$4"
GITHUB_REPOSITORY="$5"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

log_step() {
  printf '\n===== [deploy %s] %s =====\n' "$1" "$2"
}

if [ "${APP_DIR}" != "/home/apps/easonfansclub" ]; then
  die "Refusing an unexpected production application directory: ${APP_DIR}"
fi
if [[ "${APP_PORT}" =~ ^[0-9]+$ ]]; then :; else
  die "APP_PORT must be numeric."
fi
if [[ "${DEPLOY_SHA}" =~ ^[0-9a-f]{40}$ ]]; then :; else
  die "DEPLOY_SHA is not a 40-character hexadecimal Git SHA."
fi
if [[ "${PM2_APP_NAME}" =~ ^[A-Za-z0-9._-]+$ ]]; then :; else
  die "PM2_APP_NAME contains unexpected characters."
fi
if [[ "${GITHUB_REPOSITORY}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then :; else
  die "GITHUB_REPOSITORY has an unexpected format."
fi

releases_dir="${APP_DIR}/releases"
shared_dir="${APP_DIR}/shared"
repo_dir="${APP_DIR}/repo"
current_link="${APP_DIR}/current"
release_id=""
release_dir=""
previous_target=""
previous_sha=""
rollback_target=""
deployment_succeeded=false
deploy_lock_acquired=false
PNPM_CMD=()

prune_worktrees() {
  [ "${deploy_lock_acquired}" = true ] || return 0
  if [ -d "${repo_dir}" ] &&
     [ "$(git -C "${repo_dir}" rev-parse --is-inside-work-tree 2>/dev/null || true)" = true ]; then
    git -C "${repo_dir}" worktree prune --expire now >/dev/null 2>&1 || true
  fi
}

assert_release_valid() {
  local candidate="$1" marker
  case "${candidate}" in
    "${releases_dir}/"*) ;;
    *) return 1 ;;
  esac
  [ -d "${candidate}" ] || return 1
  [ -s "${candidate}/.deployed-sha" ] || return 1
  [ -f "${candidate}/ecosystem.config.js" ] || return 1
  [ -r "${candidate}/.env" ] || return 1
  [ -s "${candidate}/.env" ] || return 1
  marker="$(tr -d '[:space:]' < "${candidate}/.deployed-sha" 2>/dev/null || true)"
  [[ "${marker}" =~ ^[0-9a-f]{40}$ ]]
}

remove_release() {
  local release_path="$1" release_name active_target resolved_path
  case "${release_path}" in
    "${releases_dir}/"*) ;;
    *)
      echo "Refusing to remove a path outside releases/: ${release_path}" >&2
      return 1
      ;;
  esac
  release_name="${release_path#${releases_dir}/}"
  case "${release_name}" in
    ""|*/*|.|..)
      echo "Refusing to remove a non-release child path: ${release_path}" >&2
      return 1
      ;;
  esac
  active_target="$(readlink -f -- "${current_link}" 2>/dev/null || true)"
  resolved_path="$(readlink -f -- "${release_path}" 2>/dev/null || true)"
  if [ "${release_path}" = "${active_target}" ] ||
     [ "${resolved_path}" = "${active_target}" ] ||
     [ "${release_path}" = "${previous_target:-}" ] ||
     [ "${resolved_path}" = "${previous_target:-}" ] ||
     [ "${release_path}" = "${rollback_target:-}" ] ||
     [ "${resolved_path}" = "${rollback_target:-}" ]; then
    echo "Refusing to remove the active release: ${release_path}" >&2
    return 1
  fi
  if [ -d "${repo_dir}" ] &&
     [ "$(git -C "${repo_dir}" rev-parse --is-inside-work-tree 2>/dev/null || true)" = true ]; then
    git -C "${repo_dir}" worktree remove --force "${release_path}" >/dev/null 2>&1 || true
  fi
  if [ -d "${release_path}" ] || [ -L "${release_path}" ]; then
    rm -rf -- "${release_path}"
  fi
  prune_worktrees
}

cleanup_failed_release() {
  if [ -n "${release_dir}" ] &&
     { [ -d "${release_dir}" ] || [ -L "${release_dir}" ]; }; then
    remove_release "${release_dir}" || true
  fi
  prune_worktrees
}

recover_abandoned_releases() {
  local active_target release_path release_name
  active_target="$(readlink -f -- "${current_link}" 2>/dev/null || true)"
  while IFS= read -r release_path; do
    [ -d "${release_path}" ] || continue
    [ "${release_path}" = "${active_target}" ] && continue
    [ "${release_path}" = "${previous_target}" ] && continue
    [ "${release_path}" = "${rollback_target}" ] && continue
    release_name="${release_path#${releases_dir}/}"

    if [ -f "${release_path}/.deploy-failed" ] ||
       [ -f "${release_path}/.deploy-in-progress" ] ||
       { [ ! -s "${release_path}/.deployed-sha" ] &&
         [[ "${release_name}" =~ ^[0-9]{14}-[0-9a-f]{12}(-[0-9]+)?$ ]]; }; then
      echo "Removing abandoned release worktree: ${release_path}"
      remove_release "${release_path}" || die "Unable to remove abandoned release: ${release_path}"
    fi
  done < <(find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d -print)
  prune_worktrees
}

on_exit() {
  local status=$?
  if [ "${deployment_succeeded}" != true ] && [ -d "${release_dir}" ]; then
    printf '%s\n' "${DEPLOY_SHA}" > "${release_dir}/.deploy-failed" || true
  fi
  cleanup_failed_release || true
  return "${status}"
}
trap on_exit EXIT

log_step "1/8" "Load runtime and validate the stable release layout"
export NVM_DIR="${HOME}/.nvm"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  . "${NVM_DIR}/nvm.sh"
fi

command -v git >/dev/null 2>&1 || die "git is not installed on the deployment host."
command -v node >/dev/null 2>&1 || die "node is not installed on the deployment host."
command -v pm2 >/dev/null 2>&1 || die "pm2 is not installed on the deployment host."
command -v curl >/dev/null 2>&1 || die "curl is not installed on the deployment host."
command -v readlink >/dev/null 2>&1 || die "readlink is not installed on the deployment host."
command -v flock >/dev/null 2>&1 || die "flock is not installed on the deployment host."

test -d "${APP_DIR}" || die "Application directory does not exist: ${APP_DIR}"
test -w "${APP_DIR}" || die "Application directory is not writable: ${APP_DIR}"
exec 9>"${APP_DIR}/.deploy.lock"
flock -n 9 || die "Another production deployment is already in progress."
deploy_lock_acquired=true

test -d "${releases_dir}" || die "Release directory does not exist: ${releases_dir}"
test -w "${releases_dir}" || die "Release directory is not writable: ${releases_dir}"
test -d "${shared_dir}" || die "Shared directory does not exist: ${shared_dir}"
test -w "${shared_dir}" || die "Shared directory is not writable: ${shared_dir}"
test -r "${shared_dir}/.env" || die "Production shared/.env is not readable."
test -s "${shared_dir}/.env" || die "Production shared/.env is empty."
shared_env_real="$(readlink -f -- "${shared_dir}/.env" 2>/dev/null || true)"
test -n "${shared_env_real}" || die "Production shared/.env does not resolve to a file."
test -f "${shared_env_real}" || die "Production shared/.env target is not a regular file."
test -L "${current_link}" || die "Production current must be a symlink into releases/."

previous_target="$(readlink -f -- "${current_link}" 2>/dev/null || true)"
case "${previous_target}" in
  "${releases_dir}/"*) ;;
  *) die "Current target is outside the release root: ${previous_target}" ;;
esac
assert_release_valid "${previous_target}" || die "Current release is not a valid rollback target: ${previous_target}"
previous_sha="$(tr -d '[:space:]' < "${previous_target}/.deployed-sha")"
if [ -s "${shared_dir}/previous-release" ]; then
  rollback_target="$(tr -d '[:space:]' < "${shared_dir}/previous-release")"
  case "${rollback_target}" in
    "${releases_dir}/"*) ;;
    *) die "Recorded previous release is outside the release root: ${rollback_target}" ;;
  esac
  assert_release_valid "${rollback_target}" || die "Recorded previous release is not available: ${rollback_target}"
fi

if [ ! -d "${repo_dir}" ]; then
  die "SERVER_GIT_ACCESS=NOT_READY: cached repository is missing at ${repo_dir}."
fi
if [ "$(git -C "${repo_dir}" rev-parse --is-inside-work-tree 2>/dev/null || true)" != true ]; then
  die "SERVER_GIT_ACCESS=NOT_READY: ${repo_dir} is not a usable non-bare Git checkout."
fi
origin_url="$(git -C "${repo_dir}" remote get-url origin 2>/dev/null || true)"
[ -n "${origin_url}" ] || die "SERVER_GIT_ACCESS=NOT_READY: cached repository has no origin remote."
if [[ "${origin_url}" == https://*:*@* ]]; then
  die "Refusing a Git remote URL containing embedded credentials."
fi
case "${origin_url}" in
  "git@github.com:${GITHUB_REPOSITORY}.git"|"https://github.com/${GITHUB_REPOSITORY}.git"|"https://github.com/${GITHUB_REPOSITORY}") ;;
  *) die "Cached repository origin does not match the workflow repository." ;;
esac
if [ -n "$(git -C "${repo_dir}" status --porcelain --untracked-files=all)" ]; then
  die "Cached repository has local changes; refusing to fetch into a dirty checkout."
fi

prune_worktrees
recover_abandoned_releases

release_id_base="$(date -u +%Y%m%d%H%M%S)-${DEPLOY_SHA:0:12}"
release_id="${release_id_base}"
release_counter=0
while [ -e "${releases_dir}/${release_id}" ] || [ -L "${releases_dir}/${release_id}" ]; do
  release_counter=$((release_counter + 1))
  release_id="${release_id_base}-${release_counter}"
done
release_dir="${releases_dir}/${release_id}"

echo "Node: $(node --version)"
echo "PM2: $(pm2 --version)"
echo "Release SHA: ${DEPLOY_SHA}"
echo "Previous release: ${previous_target}"

log_step "2/8" "Fetch the exact GitHub commit into the server-side cache"
if ! git -C "${repo_dir}" fetch --no-tags --prune origin "${DEPLOY_SHA}"; then
  die "SERVER_GIT_ACCESS=NOT_READY: unable to fetch ${DEPLOY_SHA} from origin."
fi
resolved_sha="$(git -C "${repo_dir}" rev-parse "${DEPLOY_SHA}^{commit}" 2>/dev/null || true)"
[ "${resolved_sha}" = "${DEPLOY_SHA}" ] || die "Fetched commit does not resolve to DEPLOY_SHA."

log_step "3/8" "Create an isolated release worktree"
git -C "${repo_dir}" worktree add --detach "${release_dir}" "${DEPLOY_SHA}"
touch "${release_dir}/.deploy-in-progress"
release_head="$(git -C "${release_dir}" rev-parse HEAD 2>/dev/null || true)"
[ "${release_head}" = "${DEPLOY_SHA}" ] || die "Release worktree HEAD does not match DEPLOY_SHA."
if [ -e "${release_dir}/.env" ] || [ -L "${release_dir}/.env" ]; then
  die "Release source unexpectedly contains .env; refusing to overwrite it."
fi
ln -s -- "${shared_dir}/.env" "${release_dir}/.env"
release_env_real="$(readlink -f -- "${release_dir}/.env" 2>/dev/null || true)"
[ "${release_env_real}" = "${shared_env_real}" ] || die "Release .env does not point to shared/.env."
test -r "${release_dir}/.env"
test -s "${release_dir}/.env"

for required_path in package.json pnpm-lock.yaml server.ts ecosystem.config.js prisma/schema.prisma; do
  test -e "${release_dir}/${required_path}" || die "Release is missing required path: ${required_path}"
done

log_step "4/8" "Install exact dependencies from the shared pnpm store and generate Prisma"
pnpm_store_dir="${shared_dir}/pnpm-store"
test -w "${shared_dir}" || die "Shared directory is not writable for the pnpm store."
install -d -m 755 "${pnpm_store_dir}"
test -d "${pnpm_store_dir}" || die "Unable to create the shared pnpm store: ${pnpm_store_dir}"
test -w "${pnpm_store_dir}" || die "Shared pnpm store is not writable: ${pnpm_store_dir}"
cd "${release_dir}"
package_manager="$(node -e 'process.stdout.write(String(require("./package.json").packageManager || ""))')"
case "${package_manager}" in
  pnpm@*) expected_pnpm_version="${package_manager#pnpm@}" ;;
  *) die "package.json must declare an exact pnpm version via packageManager." ;;
esac
if [[ "${expected_pnpm_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then :; else
  die "package.json must declare a concrete pnpm version; found ${package_manager}."
fi

pnpm_installation_version=""
if command -v pnpm >/dev/null 2>&1; then
  pnpm_installation_version="$(pnpm --version || true)"
fi
if [ "${pnpm_installation_version}" = "${expected_pnpm_version}" ]; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  corepack_cache_dir="${shared_dir}/corepack"
  install -d -m 755 "${corepack_cache_dir}"
  test -w "${corepack_cache_dir}" || die "Shared Corepack cache is not writable: ${corepack_cache_dir}"
  export COREPACK_HOME="${corepack_cache_dir}"
  export COREPACK_ENABLE_PROJECT_SPEC=1
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  PNPM_CMD=(corepack pnpm)
else
  die "pnpm ${expected_pnpm_version} is unavailable and corepack is not installed."
fi

pnpm_run() {
  "${PNPM_CMD[@]}" "$@"
}

if ! actual_pnpm_version="$(pnpm_run --version)"; then
  die "Unable to activate pnpm ${expected_pnpm_version} through ${PNPM_CMD[*]}."
fi
[ "${actual_pnpm_version}" = "${expected_pnpm_version}" ] || die "pnpm ${expected_pnpm_version} is required by package.json; found ${actual_pnpm_version}."
if [ -n "${PNPM_HOME:-}" ] &&
   [ "$(readlink -f -- "${PNPM_HOME}" 2>/dev/null || true)" = "$(readlink -f -- "${pnpm_store_dir}" 2>/dev/null || true)" ]; then
  die "PNPM_HOME must not point at the shared pnpm store."
fi
echo "pnpm: ${actual_pnpm_version} (runner: ${PNPM_CMD[*]})"
echo "pnpm store: ${pnpm_store_dir}"
install_started="$(date +%s)"
pnpm_run install --frozen-lockfile --prefer-offline --store-dir "${pnpm_store_dir}"
test -d node_modules
echo "Dependency install completed in $(( $(date +%s) - install_started ))s."
pnpm_run prisma generate

log_step "5/8" "Build the release before touching current"
build_started="$(date +%s)"
build_node_options="${BUILD_NODE_OPTIONS:---max-old-space-size=4096}"
echo "Node build options: ${build_node_options}"
export NODE_OPTIONS="${build_node_options}"
pnpm_run build
test -s "${release_dir}/.next/BUILD_ID"
test -d "${release_dir}/.next/static"
test -d "${release_dir}/public"
echo "Build completed successfully in $(( $(date +%s) - build_started ))s."

log_step "6/8" "Apply production migrations and verify notification data before current switch"
pnpm_run migration:check:mysql
pnpm_run prisma migrate deploy
pnpm_run notification:integrity

atomic_switch() {
  local target="$1"
  local temporary_link="${APP_DIR}/.current-${release_id}-${RANDOM}"
  case "${target}" in
    "${releases_dir}/"*) ;;
    *)
      echo "Refusing to point current outside releases/: ${target}" >&2
      return 1
      ;;
  esac
  rm -f -- "${temporary_link}"
  ln -s -- "${target}" "${temporary_link}"
  mv -Tf -- "${temporary_link}" "${current_link}"
}

read_pm2_snapshot() {
  local pm2_json pm2_snapshot
  if ! pm2_json="$(pm2 jlist)"; then
    echo "Unable to read PM2 process list." >&2
    return 1
  fi
  if ! pm2_snapshot="$(printf '%s' "${pm2_json}" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const appName = process.argv[1];
        const app = JSON.parse(raw).find((entry) => entry.name === appName);
        if (!app) process.exit(1);
        const env = app.pm2_env || {};
        process.stdout.write(JSON.stringify({
          cwd: env.pm_cwd || "",
          script: env.pm_exec_path || "",
          args: Array.isArray(env.args) ? env.args.join(" ") : String(env.args || ""),
        }));
      } catch {
        process.exit(2);
      }
    });
  ' "${PM2_APP_NAME}")"; then
    echo "PM2 app ${PM2_APP_NAME} is not present in the process list." >&2
    return 1
  fi
  pm2_cwd="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).cwd)' "${pm2_snapshot}")"
  pm2_script="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).script)' "${pm2_snapshot}")"
  pm2_args="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).args)' "${pm2_snapshot}")"
}

pm2_app_exists() {
  local pm2_json pm2_status
  if ! pm2_json="$(pm2 jlist)"; then
    return 2
  fi
  if printf '%s' "${pm2_json}" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const exists = JSON.parse(raw).some((entry) => entry.name === process.argv[1]);
        process.exit(exists ? 0 : 1);
      } catch {
        process.exit(2);
      }
    });
  ' "${PM2_APP_NAME}"; then
    return 0
  else
    pm2_status=$?
    [ "${pm2_status}" -eq 1 ] && return 1
    return 2
  fi
}

pm2_script_is_npm() {
  case "$1" in
    npm|*/npm|npm.cmd|*/npm.cmd) return 0 ;;
    *) return 1 ;;
  esac
}

pm2_is_current_release() {
  [ "${pm2_cwd}" = "${current_link}" ] || return 1
  pm2_script_is_npm "${pm2_script}" || return 1
  [ "${pm2_args}" = "run start" ]
}

reload_pm2() {
  local release_sha="$1" pm2_status
  export NODE_ENV=production
  export DEPLOY_SHA="${release_sha}"
  export PORT="${APP_PORT}"
  cd "${current_link}"
  test -f ecosystem.config.js
  test -r .env
  test -s .env
  if pm2_app_exists; then
    echo "Reloading existing PM2 app ${PM2_APP_NAME}."
    pm2 reload "${PM2_APP_NAME}" --update-env
  else
    pm2_status=$?
    if [ "${pm2_status}" -ne 1 ]; then
      echo "PM2 process list is invalid; refusing to create a duplicate process." >&2
      return 1
    fi
    echo "Starting missing PM2 app ${PM2_APP_NAME} from ecosystem.config.js."
    pm2 start ecosystem.config.js --only "${PM2_APP_NAME}" --update-env
  fi
  pm2 save || true
  sleep 10
  if ! read_pm2_snapshot || ! pm2_is_current_release; then
    echo "PM2 configuration does not point through current." >&2
    return 1
  fi
}

print_health_diagnostics() {
  echo "===== Health check diagnostics =====" >&2
  echo "Current release target:" >&2
  readlink -f -- "${current_link}" >&2 || true
  echo "Deployed SHA:" >&2
  cat "${current_link}/.deployed-sha" >&2 || true
  echo "PM2 description:" >&2
  pm2 describe "${PM2_APP_NAME}" >&2 || true
  echo "Listening port:" >&2
  ss -lntp 2>/dev/null | grep "${APP_PORT}" >&2 || true
  echo "Local HTTP headers:" >&2
  curl -I --max-time 10 "http://127.0.0.1:${APP_PORT}" >&2 || true
  echo "PM2 error log (last 200 lines):" >&2
  tail -200 -- "${HOME}/.pm2/logs/${PM2_APP_NAME}-error.log" >&2 || true
}

check_health() {
  local health_response active_target pm2_ready
  for attempt in $(seq 1 10); do
    health_response="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT}/api/health/live" || true)"
    active_target="$(readlink -f -- "${current_link}" 2>/dev/null || true)"
    pm2_ready=false
    if read_pm2_snapshot 2>/dev/null && pm2_is_current_release; then
      pm2_ready=true
    fi
    if [ "${active_target}" = "${release_dir}" ] &&
       printf '%s' "${health_response}" | grep -Fq "\"release\":\"${DEPLOY_SHA}\"" &&
       [ "${pm2_ready}" = true ]; then
      return 0
    fi
    echo "Health attempt ${attempt}/10 did not confirm release ${DEPLOY_SHA} (pm2_ready=${pm2_ready})."
    sleep 3
  done
  return 1
}

rollback_release() {
  local previous_sha
  assert_release_valid "${previous_target}" || {
    echo "Previous release is no longer a valid rollback target: ${previous_target}" >&2
    return 1
  }
  previous_sha="$(tr -d '[:space:]' < "${previous_target}/.deployed-sha")"
  printf '%s\n' "${DEPLOY_SHA}" > "${release_dir}/.deploy-failed" || true
  echo "Restoring previous release atomically: ${previous_target}" >&2
  atomic_switch "${previous_target}"
  if ! reload_pm2 "${previous_sha}"; then
    echo "PM2 reload failed while restoring the previous release." >&2
    return 1
  fi
  pm2 logs "${PM2_APP_NAME}" --lines 80 --nostream || true
}

log_step "7/8" "Atomically switch current and reload PM2"
atomic_switch "${release_dir}"
if ! reload_pm2 "${DEPLOY_SHA}"; then
  print_health_diagnostics
  rollback_release || die "PM2 reload failed and automatic rollback also failed."
  die "PM2 reload failed; previous release was restored."
fi

log_step "8/8" "Verify health and retain rollback releases"
if ! check_health; then
  print_health_diagnostics
  rollback_release || die "Health check failed and automatic rollback also failed."
  die "Health check failed; previous release was restored."
fi
if ! ss -ltn 2>/dev/null | grep -Eq "[[:space:]](127\.0\.0\.1|\[::1\]):${APP_PORT}[[:space:]]"; then
  print_health_diagnostics
  rollback_release || die "Local binding check failed and automatic rollback also failed."
  die "Application is not bound to localhost behind Nginx; previous release was restored."
fi

log_step "9/9" "Record the deployed SHA after health verification"
deployed_sha_tmp="${release_dir}/.deployed-sha.tmp"
if ! {
  printf '%s\n' "${DEPLOY_SHA}" > "${deployed_sha_tmp}"
  mv -Tf -- "${deployed_sha_tmp}" "${release_dir}/.deployed-sha"
  test -s "${release_dir}/.deployed-sha"
}; then
  print_health_diagnostics
  rollback_release || die "Unable to record the deployed SHA and automatic rollback also failed."
  die "Unable to record the deployed SHA; previous release was restored."
fi

rm -f -- "${release_dir}/.deploy-in-progress"

previous_metadata="${shared_dir}/previous-release"
previous_metadata_tmp="${shared_dir}/.previous-release-${release_id}.tmp"
printf '%s\n' "${previous_target}" > "${previous_metadata_tmp}"
mv -Tf -- "${previous_metadata_tmp}" "${previous_metadata}"
rollback_target="${previous_target}"

kept_successful=0
while IFS= read -r release_entry; do
  release_path="${release_entry#* }"
  [ -n "${release_path}" ] || continue
  case "${release_path}" in
    "${releases_dir}/"*) ;;
    *) continue ;;
  esac
  [ "${release_path}" = "${release_dir}" ] && continue
  [ "${release_path}" = "${previous_target}" ] && continue
  [ -f "${release_path}/.deploy-failed" ] && continue
  [ -s "${release_path}/.deployed-sha" ] || continue
  kept_successful=$((kept_successful + 1))
  if [ "${kept_successful}" -gt 3 ]; then
    echo "Removing old successful release: ${release_path}"
    remove_release "${release_path}" || true
  fi
done < <(find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr)
prune_worktrees

pm2 describe "${PM2_APP_NAME}" || true
echo "Current release: $(readlink -f -- "${current_link}")"
echo "Previous release: ${previous_target}"
echo "Deployment health check passed for ${DEPLOY_SHA}."
deployment_succeeded=true
