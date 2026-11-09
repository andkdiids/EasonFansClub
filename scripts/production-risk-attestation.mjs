#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

export const RISK_APPROVER_LOGIN = 'andkdiids'
export const RISK_APPROVER_ASSOCIATION = 'OWNER'
export const MAX_APPROVAL_AGE_MS = 8 * 60 * 60 * 1000
export const ATTESTATION_TTL_MS = 30 * 60 * 1000
export const RISK_STATEMENT = 'No independent verification of CynosDB backup/PITR was obtained and no isolated restore drill was completed; a serious production failure could cause permanent data loss. Risk accepted for this exact release only.'

const SHA40 = /^[0-9a-f]{40}$/
const NUMERIC_ID = /^[1-9][0-9]{0,19}$/

function invalid(reason) {
  throw new Error(reason)
}

function requireTimestamp(value, reason) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(reason)
  return Date.parse(value)
}

function assertRiskLanguage(body, deploySha) {
  const normalized = body.replace(/\s+/g, ' ')
  if (!normalized.includes(deploySha)) invalid('APPROVAL_SHA_NOT_IN_COMMENT')
  if (!normalized.includes('明确批准') || !normalized.includes('一次性')) invalid('APPROVAL_NOT_EXPLICIT_ONE_TIME')
  if (!normalized.includes('CynosDB') || !normalized.includes('PITR') || !normalized.includes('备份')) {
    invalid('APPROVAL_BACKUP_RISK_MISSING')
  }
  if (!/(?:未|尚未).{0,24}(?:独立验证|独立核验|独立核实)/.test(normalized)) {
    invalid('APPROVAL_BACKUP_UNVERIFIED_RISK_MISSING')
  }
  if (!/恢复演练.{0,24}(?:未完成|尚未完成|未进行|尚未进行|没有完成)/.test(normalized)) {
    invalid('APPROVAL_RESTORE_DRILL_RISK_MISSING')
  }
  if (!/(?:永久.{0,8}(?:丢失|损失)|数据无法恢复)/.test(normalized)) {
    invalid('APPROVAL_PERMANENT_DATA_LOSS_RISK_MISSING')
  }
}

function issueNumberFromApiUrl(issueUrl) {
  const expectedPrefix = 'https://api.github.com/repos/andkdiids/EasonFansClub/issues/'
  if (typeof issueUrl !== 'string' || !issueUrl.startsWith(expectedPrefix)) invalid('APPROVAL_NOT_IN_REPOSITORY_PR')
  const suffix = issueUrl.slice(expectedPrefix.length)
  if (!/^\d+$/.test(suffix)) invalid('APPROVAL_NOT_IN_REPOSITORY_PR')
  return suffix
}

/** Validate live GitHub comment and merged PR data and create a short-lived v3 payload. */
export function buildRiskAcceptancePayload(comment, pullRequest, {
  requestedCommentId,
  deploySha,
  workflowRunId,
  now = Date.now(),
  attestationId = randomUUID(),
} = {}) {
  if (!SHA40.test(String(deploySha ?? ''))) invalid('DEPLOY_SHA_INVALID')
  if (!NUMERIC_ID.test(String(requestedCommentId ?? ''))) invalid('APPROVAL_COMMENT_ID_INVALID')
  if (!NUMERIC_ID.test(String(workflowRunId ?? ''))) invalid('ISSUANCE_RUN_ID_INVALID')
  if (String(comment?.id) !== String(requestedCommentId)) invalid('APPROVAL_COMMENT_ID_MISMATCH')
  if (comment?.user?.login !== RISK_APPROVER_LOGIN) invalid('APPROVAL_AUTHOR_NOT_AUTHORIZED')
  if (comment?.author_association !== RISK_APPROVER_ASSOCIATION) invalid('APPROVAL_AUTHOR_ASSOCIATION_INVALID')
  if (comment?.updated_at !== comment?.created_at) invalid('APPROVAL_COMMENT_WAS_EDITED')
  if (typeof comment?.body !== 'string' || comment.body.length > 50_000) invalid('APPROVAL_COMMENT_BODY_INVALID')

  const prNumber = issueNumberFromApiUrl(comment.issue_url)
  if (String(pullRequest?.number) !== prNumber || pullRequest?.merged !== true) invalid('APPROVAL_PR_NOT_MERGED')
  if (String(pullRequest?.merge_commit_sha ?? '').toLowerCase() !== deploySha) invalid('APPROVAL_PR_SHA_MISMATCH')
  assertRiskLanguage(comment.body, deploySha)

  const approvedAtMs = requireTimestamp(comment.created_at, 'APPROVAL_CREATED_AT_INVALID')
  if (approvedAtMs > now) invalid('APPROVAL_CREATED_AT_IN_FUTURE')
  if (now - approvedAtMs > MAX_APPROVAL_AGE_MS) invalid('APPROVAL_EXPIRED')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attestationId)) {
    invalid('ATTESTATION_ID_INVALID')
  }

  const expiresAt = new Date(now + ATTESTATION_TTL_MS).toISOString()
  return {
    schemaVersion: 3,
    attestationId,
    issuedByWorkflowRunId: String(workflowRunId),
    targetReleaseSha: deploySha,
    expiresAt,
    riskAcceptance: {
      approvedBy: RISK_APPROVER_LOGIN,
      approvedAt: comment.created_at,
      approvalCommentId: String(comment.id),
      approvalAuthorAssociation: comment.author_association,
      riskStatement: RISK_STATEMENT,
      releaseId: deploySha,
      noIndependentBackupVerification: true,
      noRestoreDrill: true,
    },
  }
}

async function githubGet(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
  })
  if (!response.ok) invalid(`GITHUB_API_HTTP_${response.status}`)
  return response.json()
}

export async function createPayloadFromGitHub({
  apiUrl = 'https://api.github.com',
  repository,
  token,
  commentId,
  deploySha,
  workflowRunId,
  now = Date.now(),
}) {
  if (repository !== 'andkdiids/EasonFansClub') invalid('REPOSITORY_NOT_ALLOWED')
  if (!NUMERIC_ID.test(String(commentId ?? ''))) invalid('APPROVAL_COMMENT_ID_INVALID')
  if (!SHA40.test(String(deploySha ?? ''))) invalid('DEPLOY_SHA_INVALID')
  if (!NUMERIC_ID.test(String(workflowRunId ?? ''))) invalid('ISSUANCE_RUN_ID_INVALID')
  if (typeof token !== 'string' || token.length === 0) invalid('GITHUB_TOKEN_MISSING')
  if (apiUrl !== 'https://api.github.com') invalid('GITHUB_API_URL_NOT_ALLOWED')
  const base = `${apiUrl}/repos/${repository}`
  const comment = await githubGet(`${base}/issues/comments/${encodeURIComponent(String(commentId))}`, token)
  const prNumber = issueNumberFromApiUrl(comment.issue_url)
  const pullRequest = await githubGet(`${base}/pulls/${prNumber}`, token)
  return buildRiskAcceptancePayload(comment, pullRequest, {
    requestedCommentId: String(commentId),
    deploySha,
    workflowRunId: String(workflowRunId),
    now,
  })
}

async function main() {
  if (process.argv[2] !== '--cli' || process.argv[3] !== 'create-payload') invalid('CLI_COMMAND_INVALID')
  const payload = await createPayloadFromGitHub({
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    commentId: process.env.APPROVAL_COMMENT_ID,
    deploySha: process.env.DEPLOY_SHA,
    workflowRunId: process.env.GITHUB_RUN_ID,
  })
  process.stdout.write(`${Buffer.from(JSON.stringify(payload)).toString('base64')}\n`)
}

if (process.argv.includes('--cli')) {
  Promise.resolve().then(main).catch((error) => {
    // Never print API responses, comment bodies, request headers or credentials.
    const code = /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'APPROVAL_VALIDATION_FAILED'
    console.error(`RISK_ACCEPTANCE_ISSUE=REJECTED reason=${code}`)
    process.exitCode = 1
  })
}
