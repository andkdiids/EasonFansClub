#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/ecfc-approved-release.XXXXXX")"
case "$root" in "${TMPDIR:-/tmp}"/*) ;; *) echo "Unsafe temp path" >&2; exit 1 ;; esac
trap 'rm -rf -- "$root"' EXIT

repo="$root/repo"
remote="$root/origin.git"
policy="$root/policy.json"
mkdir -p "$repo/prisma/migrations/20260101000000_init" "$repo/src"
git init --bare -q "$remote"
git init -q -b main "$repo"
git -C "$repo" config user.name 'Release Guard Test'
git -C "$repo" config user.email 'release-guard-test@example.invalid'
printf 'CREATE TABLE fixture (id INT);\n' > "$repo/prisma/migrations/20260101000000_init/migration.sql"
printf 'base\n' > "$repo/src/approved.txt"
git -C "$repo" add prisma/migrations/20260101000000_init/migration.sql src/approved.txt
git -C "$repo" commit -q -m base
base="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" remote add origin "$remote"
git -C "$repo" push -q origin HEAD:refs/heads/main
git -C "$repo" switch -q -c release/fixture
printf 'candidate\n' > "$repo/src/approved.txt"
git -C "$repo" add src/approved.txt
git -C "$repo" commit -q -m candidate
candidate="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" push -q origin HEAD:refs/heads/release/fixture

write_policy() {
  node - "$policy" "$1" "$2" "$3" "$4" "$5" <<'NODE'
const fs = require('node:fs')
const [file, sha, base, branch, count, allowedJson] = process.argv.slice(2)
fs.writeFileSync(file, JSON.stringify({
  schema_version: 1,
  approved_sha: sha,
  expected_production_sha: base,
  approved_rc_branch: branch,
  expected_migration_count: Number(count),
  migration_policy: 'unchanged',
  allowed_paths: JSON.parse(allowedJson),
}))
NODE
}
write_policy "$candidate" "$base" release/fixture 1 '["src/approved.txt"]'

run_guard() {
  RELEASE_REPO_DIR="$repo" APPROVED_RELEASE_POLICY="$policy" \
    "$script_dir/approved-release-guard.sh" validate "$1" "$2" "$3"
}
expect_reject() {
  if run_guard "$@" >/dev/null 2>&1; then
    echo "Expected release guard rejection: $*" >&2
    exit 1
  fi
}

run_guard "$candidate" "$base" release/fixture >/dev/null
echo 'PASS exact SHA, base ancestry, remote ref, allowlist and no-migration policy'
expect_reject short "$base" release/fixture
echo 'PASS malformed SHA rejected'
expect_reject "$(printf 'b%.0s' {1..40})" "$base" release/fixture
echo 'PASS unapproved full-length SHA rejected'
expect_reject "$candidate" "$(printf 'a%.0s' {1..40})" release/fixture
echo 'PASS production SHA mismatch rejected'
expect_reject "$candidate" "$base" release/../fixture
echo 'PASS invalid RC branch rejected'
expect_reject "$candidate" "$base" release/not-approved
echo 'PASS valid-format but unapproved RC branch rejected'

printf 'unapproved\n' > "$repo/src/unapproved.txt"
git -C "$repo" add src/unapproved.txt
git -C "$repo" commit -q -m 'unapproved file'
unapproved="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" push -q origin HEAD:refs/heads/release/fixture
original_candidate="$candidate"
candidate="$unapproved"
write_policy "$candidate" "$base" release/fixture 1 '["src/approved.txt"]'
expect_reject "$unapproved" "$base" release/fixture
echo 'PASS unapproved changed file rejected'

candidate="$original_candidate"
write_policy "$candidate" "$base" release/fixture 1 '["src/approved.txt"]'
expect_reject "$candidate" "$base" release/fixture
echo 'PASS moved remote RC head rejected'

# An existing, well-formed but unrelated production commit must not be
# accepted merely because the RC's remote HEAD and file allowlist match.
unrelated_base="$(printf 'unrelated production baseline\n' | git -C "$repo" commit-tree "$(git -C "$repo" rev-parse "${base}^{tree}")")"
write_policy "$unapproved" "$unrelated_base" release/fixture 1 '["src/approved.txt","src/unapproved.txt"]'
if ancestry_output="$(run_guard "$unapproved" "$unrelated_base" release/fixture 2>&1)"; then
  echo 'Expected unrelated production ancestry rejection' >&2
  exit 1
fi
grep -Fq 'PRODUCTION_BASE_NOT_ANCESTOR' <<< "$ancestry_output" || { echo 'Wrong ancestry rejection reason' >&2; exit 1; }
echo 'PASS existing but unrelated production baseline rejected'

git -C "$repo" switch -q --detach "$base"
git -C "$repo" switch -q -c release/migration-fixture
printf 'newer\n' > "$repo/src/approved.txt"
printf 'migration change\n' >> "$repo/prisma/migrations/20260101000000_init/migration.sql"
git -C "$repo" add prisma/migrations/20260101000000_init/migration.sql
git -C "$repo" add src/approved.txt
git -C "$repo" commit -q -m 'migration changed'
git -C "$repo" push -q origin HEAD:refs/heads/release/migration-fixture
migration_changed="$(git -C "$repo" rev-parse HEAD)"
write_policy "$migration_changed" "$base" release/migration-fixture 1 '["prisma/migrations/20260101000000_init/migration.sql","src/approved.txt"]'
expect_reject "$migration_changed" "$base" release/migration-fixture
echo 'PASS unexpected migration change rejected'

echo 'APPROVED_RELEASE_GUARD_TESTS=10/10 PASS'
