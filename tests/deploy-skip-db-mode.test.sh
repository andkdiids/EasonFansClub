#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(git rev-parse --show-toplevel)"
source "${repo_root}/scripts/deploy-safety.sh"

[[ "$(deploy_parse_db_mode_arg)" == full ]]
[[ "$(deploy_parse_db_mode_arg --skip-db)" == skip-db ]]
if deploy_parse_db_mode_arg --unknown >/dev/null 2>&1; then
  echo "Unknown deploy arguments were accepted." >&2
  exit 1
fi
if deploy_parse_db_mode_arg --skip-db --unknown >/dev/null 2>&1; then
  echo "Multiple deploy mode arguments were accepted." >&2
  exit 1
fi

temporary_root="$(mktemp -d)"
trap 'rm -rf -- "${temporary_root}"' EXIT

hold_file="${temporary_root}/db-maintenance.hold"
release_sha="0123456789abcdef0123456789abcdef01234567"
other_sha="1123456789abcdef0123456789abcdef01234567"
deploy_create_db_maintenance_hold "${hold_file}" "${release_sha}"
[[ "$(cat -- "${hold_file}")" == "${release_sha}" ]]
if [[ "$(uname -s)" != MINGW* ]]; then
  [[ "$(stat -c '%a' "${hold_file}")" == 600 ]]
fi
if deploy_create_db_maintenance_hold "${hold_file}" "${other_sha}" >/dev/null 2>&1; then
  echo "An existing hold file was overwritten." >&2
  exit 1
fi
[[ "$(cat -- "${hold_file}")" == "${release_sha}" ]]
if deploy_remove_db_maintenance_hold "${hold_file}" "${other_sha}" >/dev/null 2>&1; then
  echo "A hold owned by another release was removed." >&2
  exit 1
fi
deploy_remove_db_maintenance_hold "${hold_file}" "${release_sha}"
[[ ! -e "${hold_file}" ]]

fixture_repo="${temporary_root}/git-fixture"
mkdir -p "${fixture_repo}/prisma"
git -C "${fixture_repo}" init -q
git -C "${fixture_repo}" config user.name "Deploy Test"
git -C "${fixture_repo}" config user.email "deploy-test@example.invalid"
printf 'model Example { id Int @id }\n' > "${fixture_repo}/prisma/schema.prisma"
git -C "${fixture_repo}" add prisma/schema.prisma
git -C "${fixture_repo}" commit -qm baseline
baseline_sha="$(git -C "${fixture_repo}" rev-parse HEAD)"

printf 'export const release = true\n' > "${fixture_repo}/app.ts"
git -C "${fixture_repo}" add app.ts
git -C "${fixture_repo}" commit -qm app-only
app_sha="$(git -C "${fixture_repo}" rev-parse HEAD)"
deploy_skip_db_schema_guard "${fixture_repo}" "${baseline_sha}" "${app_sha}"

printf '\n// schema change\n' >> "${fixture_repo}/prisma/schema.prisma"
git -C "${fixture_repo}" add prisma/schema.prisma
git -C "${fixture_repo}" commit -qm schema-change
schema_sha="$(git -C "${fixture_repo}" rev-parse HEAD)"
if deploy_skip_db_schema_guard "${fixture_repo}" "${baseline_sha}" "${schema_sha}" 2>"${temporary_root}/schema-error"; then
  echo "--skip-db accepted a schema change." >&2
  exit 1
fi
grep -Fq 'Cannot use --skip-db because this release contains database schema/migration changes.' "${temporary_root}/schema-error"

mkdir -p "${fixture_repo}/prisma/migrations/20261030_test"
printf 'ALTER TABLE Example ADD COLUMN name VARCHAR(20);\n' > "${fixture_repo}/prisma/migrations/20261030_test/migration.sql"
git -C "${fixture_repo}" add prisma/migrations
git -C "${fixture_repo}" commit -qm migration-change
migration_sha="$(git -C "${fixture_repo}" rev-parse HEAD)"
if deploy_skip_db_schema_guard "${fixture_repo}" "${baseline_sha}" "${migration_sha}" >/dev/null 2>&1; then
  echo "--skip-db accepted a migration." >&2
  exit 1
fi

git -C "${fixture_repo}" checkout -q "${app_sha}"
printf 'provider = "mysql"\n' > "${fixture_repo}/prisma/migration_lock.toml"
git -C "${fixture_repo}" add prisma/migration_lock.toml
git -C "${fixture_repo}" commit -qm migration-lock-change
lock_sha="$(git -C "${fixture_repo}" rev-parse HEAD)"
if deploy_skip_db_schema_guard "${fixture_repo}" "${baseline_sha}" "${lock_sha}" >/dev/null 2>&1; then
  echo "--skip-db accepted a migration lock change." >&2
  exit 1
fi

if deploy_skip_db_schema_guard "${fixture_repo}" "${migration_sha}" "${app_sha}" >/dev/null 2>&1; then
  echo "--skip-db accepted a non-ancestor baseline." >&2
  exit 1
fi

echo "SERVER_SKIP_DB_MODE_TEST=PASS"
