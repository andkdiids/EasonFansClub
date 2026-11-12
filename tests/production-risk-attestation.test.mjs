import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  ATTESTATION_TTL_MS,
  MAX_APPROVAL_AGE_MS,
  RISK_STATEMENT,
  buildRiskAcceptancePayload,
  createPayloadFromGitHub,
} from '../scripts/production-risk-attestation.mjs'

const wranglerRequire = createRequire(createRequire(import.meta.url).resolve('wrangler'))
const { parse: parseYaml } = wranglerRequire('yaml')

const SHA = 'c'.repeat(40)
const NOW = Date.parse('2026-11-09T12:00:00Z')
const COMMENT_ID = '6736686769'

function validComment(overrides = {}) {
  return {
    id: Number(COMMENT_ID),
    user: { login: 'andkdiids' },
    author_association: 'OWNER',
    created_at: new Date(NOW - 5 * 60_000).toISOString(),
    updated_at: new Date(NOW - 5 * 60_000).toISOString(),
    issue_url: 'https://api.github.com/repos/andkdiids/EasonFansClub/issues/88',
    body: `本人明确批准针对以下 SHA 的一次性 Web 生产部署风险接受：\n${SHA}\n\nCynosDB 自动备份和 PITR 尚未经过独立验证，隔离环境恢复演练未完成，严重故障可能导致数据永久丢失。`,
    ...overrides,
  }
}

function validPr(overrides = {}) {
  return { number: 88, merged: true, merge_commit_sha: SHA, ...overrides }
}

function build(comment = validComment(), pr = validPr(), overrides = {}) {
  return buildRiskAcceptancePayload(comment, pr, {
    requestedCommentId: COMMENT_ID,
    deploySha: SHA,
    workflowRunId: '41899999999',
    now: NOW,
    attestationId: '550e8400-e29b-41d4-a716-446655440000',
    ...overrides,
  })
}

test('builds a SHA-bound v3 payload from an unedited OWNER approval with its real created_at', () => {
  const comment = validComment()
  const payload = build(comment)
  assert.equal(payload.schemaVersion, 3)
  assert.equal(payload.targetReleaseSha, SHA)
  assert.equal(payload.riskAcceptance.approvedBy, 'andkdiids')
  assert.equal(payload.riskAcceptance.approvedAt, comment.created_at)
  assert.equal(payload.riskAcceptance.approvalCommentId, COMMENT_ID)
  assert.equal(payload.riskAcceptance.approvalAuthorAssociation, 'OWNER')
  assert.equal(payload.riskAcceptance.releaseId, SHA)
  assert.equal(payload.riskAcceptance.riskStatement, RISK_STATEMENT)
  assert.equal(Date.parse(payload.expiresAt) - NOW, ATTESTATION_TTL_MS)
  assert.ok(NOW - Date.parse(comment.created_at) < MAX_APPROVAL_AGE_MS)
})

test('rejects missing, mismatched, edited, stale, unauthorized, or insufficient approval evidence', () => {
  const cases = [
    [validComment({ body: 'no approval' }), validPr(), {}, /APPROVAL_SHA_NOT_IN_COMMENT/],
    [validComment(), validPr({ merge_commit_sha: 'd'.repeat(40) }), {}, /APPROVAL_PR_SHA_MISMATCH/],
    [validComment({ updated_at: new Date(NOW).toISOString() }), validPr(), {}, /APPROVAL_COMMENT_WAS_EDITED/],
    [validComment({ user: { login: 'someone-else' } }), validPr(), {}, /APPROVAL_AUTHOR_NOT_AUTHORIZED/],
    [validComment({ author_association: 'MEMBER' }), validPr(), {}, /APPROVAL_AUTHOR_ASSOCIATION_INVALID/],
    [validComment({ created_at: new Date(NOW - MAX_APPROVAL_AGE_MS - 1).toISOString(), updated_at: new Date(NOW - MAX_APPROVAL_AGE_MS - 1).toISOString() }), validPr(), {}, /APPROVAL_EXPIRED/],
    [validComment({ body: `明确批准一次性 ${SHA} CynosDB 备份 PITR 已验证，恢复演练未完成，可能永久丢失` }), validPr(), {}, /APPROVAL_BACKUP_UNVERIFIED_RISK_MISSING/],
    [validComment(), validPr({ merged: false }), {}, /APPROVAL_PR_NOT_MERGED/],
    [validComment(), validPr({ merge_commit_sha: 'd'.repeat(40) }), { deploySha: 'd'.repeat(40) }, /APPROVAL_SHA_NOT_IN_COMMENT/],
  ]
  for (const [comment, pr, overrides, expected] of cases) {
    assert.throws(() => build(comment, pr, overrides), expected)
  }
})

test('GitHub lookup uses fixed repository endpoints and does not disclose token or response body', async () => {
  const originalFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), authorization: init.headers.Authorization })
    const value = String(url).endsWith(`/issues/comments/${COMMENT_ID}`) ? validComment() : validPr()
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const payload = await createPayloadFromGitHub({
      repository: 'andkdiids/EasonFansClub',
      token: 'test-token-do-not-log',
      commentId: COMMENT_ID,
      deploySha: SHA,
      workflowRunId: '41899999999',
      now: NOW,
    })
    assert.equal(payload.targetReleaseSha, SHA)
    assert.equal(seen.length, 2)
    assert.ok(seen.every(item => item.authorization === 'Bearer test-token-do-not-log'))
    assert.ok(seen[0].url.endsWith(`/issues/comments/${COMMENT_ID}`))
    assert.ok(seen[1].url.endsWith('/pulls/88'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('refuses arbitrary repository, API host, missing credentials, and non-PR comments', async () => {
  await assert.rejects(createPayloadFromGitHub({ repository: 'other/repo', token: 'x', commentId: COMMENT_ID, deploySha: SHA, workflowRunId: '1' }), /REPOSITORY_NOT_ALLOWED/)
  await assert.rejects(createPayloadFromGitHub({ repository: 'andkdiids/EasonFansClub', apiUrl: 'https://attacker.invalid', token: 'x', commentId: COMMENT_ID, deploySha: SHA, workflowRunId: '1' }), /GITHUB_API_URL_NOT_ALLOWED/)
  assert.throws(() => build(validComment({ issue_url: 'https://api.github.com/repos/elsewhere/repo/issues/88' })), /APPROVAL_NOT_IN_REPOSITORY_PR/)
})

test('signer workflow is main-only, Production protected, least-privileged, locked, and has no arbitrary remote inputs', () => {
  const workflowPath = path.resolve('.github/workflows/issue-production-risk-acceptance.yml')
  const source = readFileSync(workflowPath, 'utf8')
  const workflow = parseYaml(source)
  assert.ok(workflow?.on?.workflow_dispatch?.inputs?.approval_comment_id)
  assert.deepEqual(workflow.permissions, { contents: 'read', issues: 'read', 'pull-requests': 'read' })
  assert.equal(workflow.concurrency.group, 'production-deploy')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs['issue-risk-acceptance'].environment, 'Production')
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/)
  assert.doesNotMatch(source, /inputs\.(?:host|path|command|approved_at|deploy_sha)/i)
  assert.match(source, /StrictHostKeyChecking=yes/)
  assert.match(source, /production-backup-gate\.mjs/)

  const deploy = readFileSync(path.resolve('.github/workflows/deploy.yml'), 'utf8')
  const deployScript = readFileSync(path.resolve('scripts/deploy-production-git.sh'), 'utf8')
  assert.ok(parseYaml(deploy))
  assert.match(deploy, /--cli verify/)
  assert.doesNotMatch(deploy, /--cli consume/, 'the early workflow gate must not consume the proof')
  assert.ok(deploy.includes('EXPECTED_PRODUCTION_SHA: ${{ steps.production_sha_preflight.outputs.production_sha }}'))
  assert.match(deploy, /scripts\/production-sha-preflight\.sh/)
  assert.ok(deploy.includes('BACKUP_GATE_RUN_ID: ${{ github.run_id }}'))
  assert.ok(deploy.includes('BACKUP_GATE_RUN_ATTEMPT: ${{ github.run_attempt }}'))
  assert.match(deploy, /production-deploy/)
  assert.match(deploy, /scripts\/production-backup-gate\.mjs/)
  assert.match(deploy, /tests\/production-risk-attestation\.test\.mjs/)

  const lock = deployScript.indexOf('flock -n 9 || die')
  const lockedShaCas = deployScript.indexOf('previous_target="$(deploy_require_expected_production_sha')
  const gateVerdict = deployScript.indexOf('BACKUP_GATE_VERIFIED_SHA_CHECK=PASS')
  const consume = deployScript.indexOf('--cli consume')
  const migration = deployScript.indexOf('pnpm_run prisma migrate deploy')
  const switchCall = deployScript.indexOf('atomic_switch "${release_dir}"')
  assert.ok(lock >= 0 && lock < lockedShaCas, 'the deploy script must lock before checking the production SHA')
  assert.ok(lockedShaCas < gateVerdict && gateVerdict < consume, 'the proof is consumed only after the locked SHA check and preflight verdict')
  assert.ok(consume < migration && consume < switchCall, 'proof consumption must precede every migration and current switch')
  assert.ok(deployScript.includes('--run-id "${backup_gate_run_id}"'))
  assert.ok(deployScript.includes('--run-attempt "${backup_gate_run_attempt}"'))
  assert.ok(deployScript.includes('RISK_ACCEPTANCE_CONSUMED_RUN_ID=${backup_gate_run_id}'))
  assert.ok(deployScript.includes('RISK_ACCEPTANCE_CONSUMED_RUN_ATTEMPT=${backup_gate_run_attempt}'))
  assert.match(deployScript, /RISK_ACCEPTANCE_CONSUMED=YES/)
})
