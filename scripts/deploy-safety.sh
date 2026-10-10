#!/usr/bin/env bash

# Shared, side-effect-small primitives for the production deploy and rollback
# scripts. Keep these functions independently testable with temporary dirs.

deploy_normalize_path() {
  local value="${1:-}"
  value="${value% (deleted)}"
  if [ -e "$value" ]; then
    readlink -f -- "$value" 2>/dev/null || printf '%s' "$value"
  else
    printf '%s' "$value"
  fi
}

deploy_is_release_child() {
  local target="$1" releases_dir="$2" relative
  case "$target" in
    "$releases_dir"/*) ;;
    *) return 1 ;;
  esac
  relative="${target#"$releases_dir"/}"
  case "$relative" in
    ""|.|..|*/*) return 1 ;;
  esac
  [ -d "$target" ] || return 1
  local resolved_root resolved_target
  resolved_root="$(readlink -f -- "$releases_dir" 2>/dev/null || true)"
  resolved_target="$(readlink -f -- "$target" 2>/dev/null || true)"
  [ -n "$resolved_root" ] && [ -n "$resolved_target" ] || return 1
  case "$resolved_target" in
    "$resolved_root"/*) ;;
    *) return 1 ;;
  esac
  local resolved_relative="${resolved_target#"$resolved_root"/}"
  case "$resolved_relative" in */*) return 1 ;; esac
  [ -n "$resolved_relative" ]
}

deploy_current_target() {
  readlink -f -- "$1" 2>/dev/null || true
}

deploy_release_pm2_names() {
  # Instagram sync has no cancellation primitive for an in-flight provider
  # request. Keep deployments scoped to the web process until the worker has a
  # proven quiesce/drain protocol. PM2 reference detection still protects every
  # live process' release from cleanup.
  printf '%s\n' "$1"
}

deploy_run_pm2_reload() {
  local app_name="$1" duration="$2"
  shift 2
  [ "$app_name" = "easonfansclub" ] || {
    echo "Refusing automatic PM2 reload for ${app_name}; its safe interruption is not proven." >&2
    return 78
  }
  timeout --foreground --signal=TERM --kill-after=30s "$duration" "$@"
}

deploy_migration_status_is_up_to_date() {
  grep -Fq 'Database schema is up to date!' <<<"${1:-}"
}

deploy_atomic_switch() {
  local target="$1" current_link="$2" releases_dir="$3"
  deploy_is_release_child "$target" "$releases_dir" || {
    echo "Refusing to point current outside a direct release child: $target" >&2
    return 1
  }
  local temporary_link="${current_link}.tmp.$$.$RANDOM"
  rm -f -- "$temporary_link"
  ln -s -- "$target" "$temporary_link"
  mv -Tf -- "$temporary_link" "$current_link"
}

# Return 0 when PM2's serialized process list references a release, 1 when it
# does not, and 2 for malformed input. The JSON is consumed on stdin and never
# printed, since PM2's payload includes process environment values.
deploy_pm2_json_references_release() {
  local target="$1"
  node -e '
    const path = require("node:path");
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      try {
        const target = path.resolve(process.argv[1]);
        const entries = JSON.parse(input);
        for (const entry of entries) {
          const env = entry.pm2_env || {};
          const pid = Number(entry.pid || env.pid || 0);
          if (["stopped", "errored"].includes(env.status) || pid <= 0) continue;
          const refs = [env.pm_cwd, env.pm_exec_path];
          try { refs.push(require("node:fs").readlinkSync(`/proc/${pid}/cwd`)); } catch {}
          for (let ref of refs) {
            if (typeof ref !== "string" || !ref) continue;
            ref = ref.replace(/ \(deleted\)$/, "");
            const normalized = path.resolve(ref);
            if (normalized === target || normalized.startsWith(target + path.sep)) {
              process.exit(0);
            }
          }
        }
        process.exit(1);
      } catch {
        process.exit(2);
      }
    });
  ' "$target"
}

deploy_release_reference_status() {
  local release_path="$1" pm2_json="$2" reference_status
  if printf '%s' "$pm2_json" | deploy_pm2_json_references_release "$release_path"; then
    return 0
  else
    reference_status=$?
  fi
  [ "$reference_status" -eq 1 ] && return 1
  return 2
}

deploy_release_is_in_use() {
  local release_path="$1" pm2_json
  pm2_json="$(pm2 jlist 2>/dev/null)" || return 2
  deploy_release_reference_status "$release_path" "$pm2_json"
}

# Compare-and-swap rollback: never point current back if it no longer resolves
# to the release this operation owns. The verifier must check the restored SHA,
# process cwd, and local application health.
deploy_rollback_if_owned() {
  local expected_current="$1" rollback_target="$2" current_link="$3"
  local releases_dir="$4" expected_rollback_sha="$5" verifier="$6"
  local active_target expected_target rollback_sha

  deploy_is_release_child "$expected_current" "$releases_dir" || return 1
  deploy_is_release_child "$rollback_target" "$releases_dir" || return 1
  active_target="$(deploy_current_target "$current_link")"
  expected_target="$(deploy_normalize_path "$expected_current")"
  if [ "$active_target" != "$expected_target" ]; then
    echo "Rollback refused: current no longer points to the release owned by this deployment." >&2
    return 20
  fi

  [ -s "$rollback_target/.deployed-sha" ] || return 1
  rollback_sha="$(tr -d '[:space:]' < "$rollback_target/.deployed-sha")"
  [ "$rollback_sha" = "$expected_rollback_sha" ] || {
    echo "Rollback refused: rollback release SHA does not match the recorded SHA." >&2
    return 1
  }

  deploy_atomic_switch "$rollback_target" "$current_link" "$releases_dir" || return 1
  "$verifier" "$rollback_target" "$rollback_sha"
}
