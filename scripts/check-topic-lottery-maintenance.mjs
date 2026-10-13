// File-only deployment guard. Never connects to a database or reads .env.
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const lotteryPhases = [
  '20261013120000_add_topic_activity_v2_lottery',
  '20261013121000_add_topic_lottery_winner_slot_column',
  '20261013122000_add_topic_lottery_winner_slot_index',
  '20261013123000_add_topic_lottery_winner_slot_fk',
]
const fail = code => { throw new Error(code) }
const hash = sql => createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')
function phases(root) {
  return Object.fromEntries(lotteryPhases.map(name => {
    const file = path.join(root,'prisma','migrations',name,'migration.sql')
    try {
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail('LOTTERY_MIGRATION_FILE_UNSAFE')
      return [name,hash(readFileSync(file,'utf8'))]
    } catch (error) {
      if (error.code === 'ENOENT') return [name,null]
      fail('LOTTERY_MIGRATION_FILE_UNSAFE')
    }
  }))
}
const evidenceNames = ['schemaLedgerEvidence','capacityEvidence','writerFenceEvidence','cancellationEvidence','backupRestoreEvidence','sharedHistoryEvidence','maintenanceApprovalEvidence']
const confirmations = ['maintenanceApproved','writersQuiesced','checksRemainEnabled','partialDDLRecoveryAcknowledged','originalDraftNeverAppliedToSharedDatabase','capacityVerified','serverCancellationVerified']
function utcTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('LOTTERY_APPROVAL_WINDOW_INVALID')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail('LOTTERY_APPROVAL_WINDOW_INVALID')
  return timestamp
}

export function checkLotteryMaintenance({ previousRoot, candidateRoot, deploySha, expectedSha, approvalFile, now = Date.now() }) {
  if (![deploySha,expectedSha].every(value=>/^[0-9a-f]{40}$/.test(value || ''))) fail('LOTTERY_APPROVAL_SHA_INVALID')
  const before = phases(previousRoot), after = phases(candidateRoot)
  if (lotteryPhases.every(name=>before[name]===null && after[name]===null)) return 1200
  if (lotteryPhases.some(name=>after[name]===null)) fail('LOTTERY_PHASE_SET_INCOMPLETE')
  if (lotteryPhases.some(name=>before[name]!==null && before[name]!==after[name])) fail('LOTTERY_SHARED_MIGRATION_HISTORY_CHANGED')
  if (lotteryPhases.every(name=>before[name]===after[name])) return 1200
  if (!approvalFile) fail('LOTTERY_MAINTENANCE_APPROVAL_REQUIRED')
  let approval
  try {
    const stat = lstatSync(approvalFile)
    if (!path.isAbsolute(approvalFile) || !approvalFile.endsWith('.json') || !stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || (process.platform !== 'win32' && (stat.mode & 0o022))) fail('INVALID')
    approval = JSON.parse(readFileSync(approvalFile,'utf8'))
  } catch { fail('LOTTERY_APPROVAL_FILE_INVALID') }
  if (!approval || approval.version!==1 || approval.deploySha!==deploySha || approval.expectedProductionSha!==expectedSha) fail('LOTTERY_APPROVAL_SHA_MISMATCH')
  if (!approval.phaseChecksums || Object.keys(approval.phaseChecksums).length!==lotteryPhases.length || lotteryPhases.some(name=>approval.phaseChecksums[name]!==after[name])) fail('LOTTERY_APPROVAL_PHASE_HASH_MISMATCH')
  if (confirmations.some(name=>approval[name]!==true)) fail('LOTTERY_APPROVAL_CONFIRMATIONS_MISSING')
  if (evidenceNames.some(name=>typeof approval[name]!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(approval[name]))) fail('LOTTERY_APPROVAL_EVIDENCE_MISSING')
  if (approval.mdlWaitSeconds!==5 || !Number.isInteger(approval.migrationTimeoutSeconds) || approval.migrationTimeoutSeconds<1 || approval.migrationTimeoutSeconds>1200 || !Number.isInteger(approval.recoveryBudgetSeconds) || approval.recoveryBudgetSeconds<30 || approval.recoveryBudgetSeconds>3600) fail('LOTTERY_APPROVAL_BUDGET_INVALID')
  const startsAt=utcTime(approval.startsAt), endsAt=utcTime(approval.endsAt)
  if (startsAt>now || endsAt<=startsAt || endsAt-now<(approval.migrationTimeoutSeconds+approval.recoveryBudgetSeconds)*1000) fail('LOTTERY_APPROVAL_WINDOW_NOT_USABLE')
  return approval.migrationTimeoutSeconds
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const seconds=checkLotteryMaintenance({previousRoot:process.argv[2],candidateRoot:process.argv[3],deploySha:process.env.DEPLOY_SHA,expectedSha:process.env.EXPECTED_PRODUCTION_SHA,approvalFile:process.env.TOPIC_LOTTERY_MIGRATION_APPROVAL_FILE})
    process.stdout.write(`${seconds}\n`)
  } catch(error) {
    const code=/^LOTTERY_[A-Z_]+$/.test(error.message || '') ? error.message : 'LOTTERY_MAINTENANCE_GUARD_UNAVAILABLE'
    process.stderr.write(`${code}\n`); process.exitCode=1
  }
}
