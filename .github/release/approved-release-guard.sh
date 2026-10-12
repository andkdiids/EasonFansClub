#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'RELEASE_GUARD=REJECTED\nREASON=%s\n' "$1" >&2
  exit 1
}

if [ "$#" -ne 4 ] || [ "$1" != "validate" ]; then
  echo "Usage: $0 validate APPROVED_SHA EXPECTED_PRODUCTION_SHA APPROVED_RC_BRANCH" >&2
  exit 2
fi

approved_sha="$2"
expected_production_sha="$3"
approved_rc_branch="$4"

[[ "$approved_sha" =~ ^[0-9a-f]{40}$ ]] || fail "APPROVED_SHA_FORMAT"
[[ "$expected_production_sha" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_PRODUCTION_SHA_FORMAT"
[[ "$approved_rc_branch" =~ ^release/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "RC_BRANCH_FORMAT"

repo_dir="${RELEASE_REPO_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "$repo_dir" ] && [ -d "$repo_dir/.git" -o -f "$repo_dir/.git" ] || fail "REPOSITORY_UNAVAILABLE"
policy_file="${APPROVED_RELEASE_POLICY:-${repo_dir}/.github/release-policies/production-topic-activity-v612.json}"
[ -f "$policy_file" ] || fail "APPROVAL_POLICY_UNAVAILABLE"

node - "$policy_file" "$approved_sha" "$expected_production_sha" "$approved_rc_branch" "$repo_dir" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const [policyPath, approvedSha, expectedProductionSha, branch, repoDir] = process.argv.slice(2)
const reject = reason => {
  console.error('RELEASE_GUARD=REJECTED')
  console.error('REASON=' + reason)
  process.exit(1)
}

let policy
try { policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) } catch { reject('APPROVAL_POLICY_INVALID') }
if (policy.schema_version !== 1 || policy.approved_sha !== approvedSha ||
    policy.expected_production_sha !== expectedProductionSha || policy.approved_rc_branch !== branch ||
    policy.migration_policy !== 'unchanged' || !Array.isArray(policy.allowed_paths)) {
  reject('INPUT_DOES_NOT_MATCH_APPROVED_POLICY')
}

function git(args, options = {}) {
  return spawnSync('git', ['-C', repoDir, ...args], { encoding: 'buffer', ...options })
}
const remote = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/' + branch])
if (remote.status !== 0 || remote.error) reject('REMOTE_RC_UNAVAILABLE')
const remoteRows = remote.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean)
if (remoteRows.length !== 1 || remoteRows[0].split(/\s+/)[0] !== approvedSha) reject('REMOTE_RC_HEAD_MISMATCH')

const fetched = git(['fetch', '--no-tags', 'origin', '+refs/heads/' + branch + ':refs/remotes/origin/' + branch])
if (fetched.status !== 0 || fetched.error) reject('REMOTE_RC_FETCH_FAILED')
const remoteTracking = git(['rev-parse', 'refs/remotes/origin/' + branch])
if (remoteTracking.status !== 0 || remoteTracking.stdout.toString('utf8').trim() !== approvedSha) reject('FETCHED_RC_HEAD_MISMATCH')
for (const sha of [approvedSha, expectedProductionSha]) {
  const exists = git(['cat-file', '-e', sha + '^{commit}'])
  if (exists.status !== 0 || exists.error) reject('COMMIT_NOT_FOUND')
}
const ancestor = git(['merge-base', '--is-ancestor', expectedProductionSha, approvedSha])
if (ancestor.status !== 0 || ancestor.error) reject('PRODUCTION_BASE_NOT_ANCESTOR')

const changed = git(['diff', '--name-only', '-z', expectedProductionSha, approvedSha])
if (changed.status !== 0 || changed.error) reject('CHANGESET_UNAVAILABLE')
const actualPaths = changed.stdout.toString('utf8').split('\0').filter(Boolean).sort()
const allowedPaths = [...policy.allowed_paths].sort()
if (JSON.stringify(actualPaths) !== JSON.stringify(allowedPaths)) reject('UNAPPROVED_FILE_CHANGESET')

const migrationDiff = git(['diff', '--quiet', expectedProductionSha, approvedSha, '--', 'prisma/schema.prisma', 'prisma/migrations'])
if (migrationDiff.status !== 0 || migrationDiff.error) reject('MIGRATION_TREE_CHANGED')
const migrationTree = git(['ls-tree', '-r', '--name-only', '-z', approvedSha, '--', 'prisma/migrations'])
if (migrationTree.status !== 0 || migrationTree.error) reject('MIGRATION_TREE_UNAVAILABLE')
const migrationNames = new Set()
for (const entry of migrationTree.stdout.toString('utf8').split('\0').filter(Boolean)) {
  const match = entry.match(/^prisma\/migrations\/([A-Za-z0-9_-]+)\/migration\.sql$/)
  if (match) migrationNames.add(match[1])
}
if (migrationNames.size !== policy.expected_migration_count) reject('MIGRATION_COUNT_MISMATCH')

console.log('RELEASE_GUARD=PASS')
console.log('APPROVED_SHA=' + approvedSha)
console.log('EXPECTED_PRODUCTION_SHA=' + expectedProductionSha)
console.log('REMOTE_RC_HEAD=' + approvedSha)
console.log('ALLOWLISTED_PATH_COUNT=' + actualPaths.length)
console.log('MIGRATION_TREE=UNCHANGED')
console.log('MIGRATION_REPO_COUNT=' + migrationNames.size)
NODE
