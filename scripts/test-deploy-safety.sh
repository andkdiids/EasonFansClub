#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/deploy-safety.sh"

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/ecfc-deploy-safety.XXXXXX")"
case "$tmp_root" in
  "${TMPDIR:-/tmp}"/*) ;;
  *) echo "Unsafe temporary test directory: $tmp_root" >&2; exit 1 ;;
esac
trap 'rm -rf -- "$tmp_root"' EXIT

pass_count=0
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { pass_count=$((pass_count + 1)); echo "PASS: $*"; }
assert_eq() { [ "$1" = "$2" ] || fail "$3 (expected '$2', got '$1')"; }

# Git for Windows represents directory links as reparse points that GNU mv in
# this environment cannot replace with Linux's `mv -Tf` semantics. Mock only
# those OS primitives; the production helper's compare/switch/rollback logic
# still runs unchanged against isolated temporary release directories.
CURRENT_STATE_FILE=""
readlink() {
  if [ "$#" -eq 3 ] && [ "$1" = -f ] && [ "$2" = -- ] && [ "$3" = "$CURRENT" ]; then
    cat "$CURRENT_STATE_FILE"
  else
    command readlink "$@"
  fi
}
ln() {
  if [ "$#" -eq 4 ] && [ "$1" = -s ] && [ "$2" = -- ]; then
    printf '%s\n' "$3" > "${4}.sim-link"
  else
    command ln "$@"
  fi
}
mv() {
  if [ "$#" -eq 4 ] && [ "$1" = -Tf ] && [ "$2" = -- ] && [ -f "${3}.sim-link" ]; then
    local next_target
    next_target="$(cat "${3}.sim-link")"
    printf '%s\n' "$next_target" > "${CURRENT_STATE_FILE}.tmp"
    command mv -f -- "${CURRENT_STATE_FILE}.tmp" "$CURRENT_STATE_FILE"
    rm -f -- "${3}.sim-link"
  else
    command mv "$@"
  fi
}

BASE_SHA="635ae4a0e1d8eae9d93420517a17f4b29794896f"
CANDIDATE_SHA="1c0dd55dfe089d8516d3b85b5c521e6b7bd1febf"
NEWER_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

setup_fixture() {
  local name="$1"
  APP="${tmp_root}/${name}"
  RELEASES="${APP}/releases"
  CURRENT="${APP}/current"
  CURRENT_STATE_FILE="${APP}/current-target"
  mkdir -p "$RELEASES/base" "$RELEASES/candidate" "$RELEASES/newer"
  printf '%s\n' "$BASE_SHA" > "$RELEASES/base/.deployed-sha"
  printf '%s\n' "$CANDIDATE_SHA" > "$RELEASES/candidate/.deployed-sha"
  printf '%s\n%s\n' "$RELEASES/base" "$BASE_SHA" > "$RELEASES/candidate/.rollback-target"
  printf '%s\n' "$NEWER_SHA" > "$RELEASES/newer/.deployed-sha"
  printf '%s\n' "$RELEASES/base" > "$CURRENT_STATE_FILE"
}

verify_mock_release() {
  local target="$1" expected_sha="$2" actual
  actual="$(tr -d '[:space:]' < "$target/.deployed-sha")"
  [ "$actual" = "$expected_sha" ] || return 1
  [ "$(deploy_current_target "$CURRENT")" = "$(readlink -f "$target")" ] || return 1
  printf '%s\n' "$actual" >> "${APP}/verified-shas"
}

setup_fixture "switch"
deploy_atomic_switch "$RELEASES/candidate" "$CURRENT" "$RELEASES" || fail "atomic switch returned failure"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/candidate")" "atomic symlink switch"
if find "$APP" -maxdepth 1 -name '.current-*.sim-link' -print -quit | grep -q .; then fail "temporary switch link left behind"; fi
pass "atomic switch changes current without a leftover temporary link"

setup_fixture "cancel-before-switch"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/base")" "cancel before switch"
pass "cancellation before switch leaves the active release untouched"

for scenario in cancellation timeout public-health-failure; do
  setup_fixture "$scenario"
  deploy_atomic_switch "$RELEASES/candidate" "$CURRENT" "$RELEASES" || fail "$scenario setup switch"
  deploy_rollback_if_owned \
    "$RELEASES/candidate" "$RELEASES/base" "$CURRENT" "$RELEASES" "$BASE_SHA" verify_mock_release \
    || fail "$scenario rollback failed"
  assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/base")" "$scenario rollback target"
  assert_eq "$(tr -d '[:space:]' < "${APP}/verified-shas")" "$BASE_SHA" "$scenario rollback SHA verification"
  pass "$scenario after switch atomically restores and verifies the base SHA"
done

setup_fixture "compare-and-swap"
deploy_atomic_switch "$RELEASES/newer" "$CURRENT" "$RELEASES" || fail "advance current setup"
set +e
deploy_rollback_if_owned \
  "$RELEASES/candidate" "$RELEASES/base" "$CURRENT" "$RELEASES" "$BASE_SHA" verify_mock_release >/dev/null 2>&1
rollback_status=$?
set -e
assert_eq "$rollback_status" "20" "compare-and-swap refusal code"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/newer")" "compare-and-swap preserves newer current"
pass "rollback refuses to overwrite a newer current release"

setup_fixture "same-sha-newer-release"
printf '%s\n' "$CANDIDATE_SHA" > "$RELEASES/newer/.deployed-sha"
deploy_atomic_switch "$RELEASES/newer" "$CURRENT" "$RELEASES" || fail "same SHA new release setup"
set +e
deploy_rollback_if_owned \
  "$RELEASES/candidate" "$RELEASES/base" "$CURRENT" "$RELEASES" "$BASE_SHA" verify_mock_release >/dev/null 2>&1
rollback_status=$?
set -e
assert_eq "$rollback_status" "20" "same-SHA compare-and-swap refusal code"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/newer")" "same SHA path guard"
pass "rollback also refuses a different newer release carrying the same SHA"

setup_fixture "deployment-specific-rollback-target"
printf '%s\n' "$RELEASES/newer" > "${APP}/shared-previous-release"
deploy_atomic_switch "$RELEASES/candidate" "$CURRENT" "$RELEASES" || fail "deployment-specific rollback setup switch"
rollback_lines=()
mapfile -t rollback_lines < "$RELEASES/candidate/.rollback-target"
assert_eq "${rollback_lines[0]}" "$RELEASES/base" "candidate-specific rollback path"
assert_eq "${rollback_lines[1]}" "$BASE_SHA" "candidate-specific rollback SHA"
deploy_rollback_if_owned \
  "$RELEASES/candidate" "${rollback_lines[0]}" "$CURRENT" "$RELEASES" "${rollback_lines[1]}" verify_mock_release \
  || fail "candidate-specific rollback failed"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/base")" "candidate-specific rollback target"
pass "external rollback uses the exact immediate pre-deploy release, not stale shared metadata"

set +e
deploy_rollback_if_owned \
  "$RELEASES/candidate" "$RELEASES/base" "$CURRENT" "$RELEASES" "$BASE_SHA" verify_mock_release >/dev/null 2>&1
rollback_status=$?
set -e
assert_eq "$rollback_status" "20" "repeat rollback refusal code"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/base")" "repeat rollback leaves restored current unchanged"
assert_eq "$(wc -l < "${APP}/verified-shas" | tr -d '[:space:]')" "1" "repeat rollback does not rerun verifier"
pass "repeated rollback is a no-op after the first verified restore"

setup_fixture "bad-rollback-sha"
printf '%s\n' "$NEWER_SHA" > "$RELEASES/base/.deployed-sha"
deploy_atomic_switch "$RELEASES/candidate" "$CURRENT" "$RELEASES" || fail "bad SHA setup switch"
set +e
deploy_rollback_if_owned \
  "$RELEASES/candidate" "$RELEASES/base" "$CURRENT" "$RELEASES" "$BASE_SHA" verify_mock_release >/dev/null 2>&1
rollback_status=$?
set -e
[ "$rollback_status" -ne 0 ] || fail "rollback accepted a mismatched SHA"
assert_eq "$(deploy_current_target "$CURRENT")" "$(readlink -f "$RELEASES/candidate")" "bad SHA leaves current unchanged"
pass "rollback refuses a target whose recorded SHA does not match"

setup_fixture "pm2-retention"
candidate_native_path="$(cygpath -m "${RELEASES}/candidate")"
pm2_json="[{\"name\":\"instagram-sync-worker\",\"pid\":999999,\"pm2_env\":{\"status\":\"online\",\"pm_cwd\":\"${candidate_native_path}\",\"pm_exec_path\":\"${candidate_native_path}/scripts/instagram-sync-worker.ts\"}}]"
set +e
deploy_release_reference_status "$candidate_native_path" "$pm2_json"
pm2_match_status=$?
set -e
[ "$pm2_match_status" -eq 0 ] || fail "PM2 active release reference not detected (status $pm2_match_status)"
base_native_path="$(cygpath -m "${RELEASES}/base")"
set +e
deploy_release_reference_status "$base_native_path" "$pm2_json" >/dev/null 2>&1
pm2_match_status=$?
set -e
[ "$pm2_match_status" -eq 1 ] || fail "unreferenced release did not return the safe-to-remove status"
set +e
deploy_release_reference_status "$base_native_path" 'not-json' >/dev/null 2>&1
pm2_match_status=$?
set -e
[ "$pm2_match_status" -eq 2 ] || fail "invalid PM2 payload did not fail closed"
pass "retention detects active PM2 cwd/script references without exposing PM2 env"

setup_fixture "unrelated-pm2"
base_native_path="$(cygpath -m "${RELEASES}/base")"
elsewhere_native_path="$(cygpath -m "${tmp_root}/elsewhere")"
pm2_json="[{\"name\":\"unrelated-service\",\"pid\":999999,\"pm2_env\":{\"status\":\"online\",\"pm_cwd\":\"${elsewhere_native_path}\",\"pm_exec_path\":\"${elsewhere_native_path}/server.js\"}}]"
set +e
deploy_release_reference_status "$base_native_path" "$pm2_json" >/dev/null 2>&1
pm2_match_status=$?
set -e
[ "$pm2_match_status" -eq 1 ] || fail "unrelated PM2 service was not treated as a safe-to-remove reference"
pass "unrelated PM2 cwd does not match or require an action"

assert_eq "$(deploy_release_pm2_names easonfansclub | tr '\n' ',')" "easonfansclub," "PM2 reload allowlist"
pass "automatic release reload is limited to the web process; Instagram worker is excluded"

fake_worker_operation_called=false
fake_worker_reload_failure() { fake_worker_operation_called=true; return 1; }
fake_worker_reload_timeout() { fake_worker_operation_called=true; return 124; }
set +e
deploy_run_pm2_reload instagram-sync-worker 1s fake_worker_reload_failure >/dev/null 2>&1
worker_failure_guard_status=$?
deploy_run_pm2_reload instagram-sync-worker 1s fake_worker_reload_timeout >/dev/null 2>&1
worker_timeout_guard_status=$?
set -e
[ "$worker_failure_guard_status" -eq 78 ] || fail "unsafe worker reload failure scenario was not denied"
[ "$worker_timeout_guard_status" -eq 78 ] || fail "unsafe worker reload timeout scenario was not denied"
[ "$fake_worker_operation_called" = false ] || fail "unsafe worker reload command was invoked"
pass "worker reload failure/timeout scenarios are rejected before touching the unquiesced worker"

set +e
deploy_run_pm2_reload easonfansclub 3s bash -c 'exit 17' >/dev/null 2>&1
pm2_failure_status=$?
deploy_run_pm2_reload easonfansclub 0.2s bash -c 'sleep 5' >/dev/null 2>&1
pm2_timeout_status=$?
set -e
[ "$pm2_failure_status" -eq 17 ] || fail "PM2 reload failure status was not preserved (got $pm2_failure_status)"
[ "$pm2_timeout_status" -eq 124 ] || fail "PM2 reload timeout was not surfaced (got $pm2_timeout_status)"
pass "bounded PM2 command reports reload failure and timeout"

deploy_script="${script_dir}/deploy-production-git.sh"
workflow_file="${script_dir}/../.github/workflows/deploy.yml"
grep -Fq 'prisma migrate status' "$deploy_script" || fail "read-only migration status gate is missing"
deploy_migration_status_is_up_to_date 'Database schema is up to date!' || fail "up-to-date migration status rejected"
deploy_migration_status_is_up_to_date 'Database schema is not up to date' && fail "pending migration status accepted"
grep -Fq 'pnpm_with_timeout 20m "$@"' "$deploy_script" || fail "default package-manager command timeout is missing"
build_line="$(grep -n -F 'pnpm_run build' "$deploy_script" | cut -d: -f1)"
migration_line="$(grep -n -F 'pnpm_run prisma migrate deploy' "$deploy_script" | cut -d: -f1)"
integrity_line="$(grep -n -F 'pnpm_run notification:integrity' "$deploy_script" | cut -d: -f1)"
switch_line="$(grep -n -F 'atomic_switch "${release_dir}"' "$deploy_script" | cut -d: -f1)"
[ -n "$build_line" ] && [ -n "$migration_line" ] && [ -n "$integrity_line" ] && [ -n "$switch_line" ] \
  || fail "bounded build, migration, integrity, and switch steps must all exist"
[ "$build_line" -lt "$migration_line" ] && [ "$migration_line" -lt "$integrity_line" ] && [ "$integrity_line" -lt "$switch_line" ] \
  || fail "migration and notification checks must complete before current switches"
grep -Fq 'cancel-in-progress: false' "$workflow_file" || fail "workflow cancellation protection is missing"
grep -Fq 'queue: max' "$workflow_file" || fail "workflow pending deployment queue is not preserved"
grep -Fq "github.ref == 'refs/heads/main'" "$workflow_file" || fail "manual dispatch is not restricted to main"
grep -Fq 'flock -n 9' "$deploy_script" || fail "server-side deploy lock is missing"
grep -Fq 'flock -w 360 9' "${script_dir}/rollback-production-git.sh" || fail "rollback lock wait is missing"
if grep -Eq 'pm2 (reload|restart|stop|delete) all|pm2 save' "$deploy_script" "${script_dir}/rollback-production-git.sh"; then
  fail "unrelated/global PM2 operation detected"
fi
grep -Fq 'PRODUCTION_DOMAIN: ecfc.fans' "$workflow_file" || fail "public health canonical domain is missing"
pass "deployment keeps migration bounded and ordered before switch without cancelling a running deployment"

if command -v flock >/dev/null 2>&1; then
  lock_file="${tmp_root}/deploy.lock"
  exec 9>"$lock_file"
  flock -n 9 || fail "first deploy lock acquisition"
  set +e
  (exec 8>"$lock_file"; flock -n 8) >/dev/null 2>&1
  lock_status=$?
  set -e
  [ "$lock_status" -ne 0 ] || fail "parallel deploy acquired an already-held lock"
  exec 9>&-
  pass "parallel deploy is rejected while the deployment lock is held"
else
  lock_file="${tmp_root}/deploy-exclusive-open.lock"
  node - "$lock_file" <<'NODE' || fail "cross-process exclusive lock simulation"
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const lockPath = process.argv[2]
const fd = fs.openSync(lockPath, 'wx')
const contender = spawnSync(process.execPath, ['-e', `
  const fs = require('node:fs')
  try { fs.openSync(process.argv[1], 'wx'); process.exit(0) }
  catch (error) { process.exit(error.code === 'EEXIST' ? 9 : 10) }
`, lockPath], { encoding: 'utf8' })
fs.closeSync(fd)
fs.unlinkSync(lockPath)
if (contender.status !== 9) {
  process.stderr.write(`Expected competing deployment to be rejected, got ${contender.status}: ${contender.stderr || ''}`)
  process.exit(1)
}
NODE
  pass "cross-process exclusive lock rejects a concurrent deployment (Windows simulation; GNU flock checked by production preflight)"
fi

echo "DEPLOY_SAFETY_TESTS=${pass_count}"
