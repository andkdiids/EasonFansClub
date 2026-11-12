#!/usr/bin/env bash
set -euo pipefail

# Read only, under the same host lock used by deployment. The deployment must
# reacquire that lock and compare against this SHA before changing the release.
app_dir="${1:?application directory required}"
target_sha="${2:?target SHA required}"
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || { echo INVALID_TARGET_SHA >&2; exit 1; }
[[ "${app_dir}" = /home/apps/easonfansclub ]] || { echo INVALID_APP_DIR >&2; exit 1; }
lock="${app_dir}/.deploy.lock"
[[ -f "${lock}" && ! -L "${lock}" ]] || { echo INVALID_DEPLOY_LOCK >&2; exit 1; }
exec 9<>"${lock}"
flock -n 9 || { echo SERVER_DEPLOY_LOCK_BUSY >&2; exit 1; }
current="$(readlink -f -- "${app_dir}/current")"
case "${current}" in "${app_dir}"/releases/*) ;; *) echo INVALID_CURRENT_RELEASE >&2; exit 1 ;; esac
[[ -s "${current}/.deployed-sha" && ! -L "${current}/.deployed-sha" ]] || { echo INVALID_SHA_MARKER >&2; exit 1; }
production_sha="$(tr -d '[:space:]' < "${current}/.deployed-sha")"
[[ "${production_sha}" =~ ^[0-9a-f]{40}$ ]] || { echo INVALID_PRODUCTION_SHA >&2; exit 1; }
printf 'PRODUCTION_SHA=%s\nTARGET_SHA=%s\n' "${production_sha}" "${target_sha}"
