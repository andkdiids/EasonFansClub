import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'

test('lottery maintenance file guard is fail-closed without touching a database', async t => {
  const { checkLotteryMaintenance, lotteryPhases } = await import('../scripts/check-topic-lottery-maintenance.mjs')
  const fixture=mkdtempSync(path.join(os.tmpdir(),'ecfc-lottery-approval-'))
  const previousRoot=path.join(fixture,'previous'),candidateRoot=path.join(fixture,'candidate'),approvalFile=path.join(fixture,'approval.json')
  const deploySha='a'.repeat(40),expectedSha='b'.repeat(40),now=Date.parse('2026-10-13T10:00:00.000Z')
  const args={previousRoot,candidateRoot,deploySha,expectedSha,approvalFile,now}
  const install=(root:string,sql:string)=>{for(const name of lotteryPhases){const folder=path.join(root,'prisma','migrations',name);mkdirSync(folder,{recursive:true});writeFileSync(path.join(folder,'migration.sql'),sql)}}
  const checksum=createHash('sha256').update('SELECT 1;\n').digest('hex')
  const approved={version:1,deploySha,expectedProductionSha:expectedSha,phaseChecksums:Object.fromEntries(lotteryPhases.map((name:string)=>[name,checksum])),startsAt:'2026-10-13T09:00:00.000Z',endsAt:'2026-10-13T11:00:00.000Z',migrationTimeoutSeconds:120,recoveryBudgetSeconds:60,mdlWaitSeconds:5,
    maintenanceApproved:true,writersQuiesced:true,checksRemainEnabled:true,partialDDLRecoveryAcknowledged:true,originalDraftNeverAppliedToSharedDatabase:true,capacityVerified:true,serverCancellationVerified:true,
    schemaLedgerEvidence:'qa-schema',capacityEvidence:'qa-capacity',writerFenceEvidence:'qa-writers',cancellationEvidence:'qa-cancel',backupRestoreEvidence:'qa-backup',sharedHistoryEvidence:'qa-history',maintenanceApprovalEvidence:'qa-approval'}
  const save=(value:unknown)=>writeFileSync(approvalFile,JSON.stringify(value),{mode:0o600})
  try {
    await t.test('nonlottery release retains existing timeout',()=>assert.equal(checkLotteryMaintenance(args),1200))
    install(candidateRoot,'SELECT 1;\n')
    await t.test('new phases require explicit approval, never defaults',()=>assert.throws(()=>checkLotteryMaintenance({...args,approvalFile:undefined}),/APPROVAL_REQUIRED/))
    save(approved)
    await t.test('exact hashes/SHA/evidence/window grant only approved timeout',()=>assert.equal(checkLotteryMaintenance(args),120))
    for(const field of ['writersQuiesced','checksRemainEnabled','partialDDLRecoveryAcknowledged','originalDraftNeverAppliedToSharedDatabase','serverCancellationVerified']) {
      await t.test(`missing confirmation ${field} refuses`,()=>{save({...approved,[field]:false});assert.throws(()=>checkLotteryMaintenance(args),/CONFIRMATIONS_MISSING/)})
    }
    await t.test('wrong SHA refuses',()=>{save({...approved,deploySha:expectedSha});assert.throws(()=>checkLotteryMaintenance(args),/SHA_MISMATCH/)})
    await t.test('wrong phase checksum refuses',()=>{save({...approved,phaseChecksums:{}});assert.throws(()=>checkLotteryMaintenance(args),/HASH_MISMATCH/)})
    await t.test('missing evidence refuses',()=>{save({...approved,capacityEvidence:''});assert.throws(()=>checkLotteryMaintenance(args),/EVIDENCE_MISSING/)})
    await t.test('future/expired/insufficient window refuses',()=>{save(approved);for(const time of [now-7200000,now+7200000,Date.parse(approved.endsAt)-1000])assert.throws(()=>checkLotteryMaintenance({...args,now:time}),/WINDOW_NOT_USABLE/)})
    await t.test('wrong MDL budget refuses',()=>{save({...approved,mdlWaitSeconds:10});assert.throws(()=>checkLotteryMaintenance(args),/BUDGET_INVALID/)})
    await t.test('already released identical phases need no new maintenance approval',()=>{install(previousRoot,'SELECT 1;\r\n');assert.equal(checkLotteryMaintenance({...args,approvalFile:undefined}),1200)})
    await t.test('released phase history cannot be overwritten by approval',()=>{install(previousRoot,'SELECT 2;\n');save(approved);assert.throws(()=>checkLotteryMaintenance(args),/HISTORY_CHANGED/)})
    await t.test('incomplete candidate phases refuse',()=>{rmSync(path.join(candidateRoot,'prisma','migrations',lotteryPhases[0],'migration.sql'));assert.throws(()=>checkLotteryMaintenance(args),/PHASE_SET_INCOMPLETE/)})
  } finally {
    // Only remove this test's freshly-created, resolved temp directory.
    assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir())+path.sep+'ecfc-lottery-approval-'))
    rmSync(fixture,{recursive:true,force:true})
  }
})

test('maintenance guard precedes all migration writes without replacing release safety',()=>{
  const source=readFileSync('scripts/deploy-production-git.sh','utf8')
  // Script SHAs are positional shell variables, not necessarily inherited env.
  assert.match(source,/DEPLOY_SHA="\$\{DEPLOY_SHA\}" EXPECTED_PRODUCTION_SHA="\$\{EXPECTED_PRODUCTION_SHA\}" node scripts\/check-topic-lottery-maintenance\.mjs/)
  assert.ok(source.indexOf('node scripts/check-topic-lottery-maintenance.mjs')<source.indexOf('pnpm_run prisma migrate deploy'))
  assert.match(source,/pnpm_run prisma migrate deploy\r?\npnpm_run notification:integrity/)
  assert.match(source,/pnpm_with_timeout "\$\{lottery_migration_timeout_seconds\}s"/)
  const gate=readFileSync('scripts/check-topic-lottery-maintenance.mjs','utf8')
  assert.doesNotMatch(gate,/import .*?(?:@prisma|mysql|child_process|node:net|node:http)/)
  assert.doesNotMatch(gate,/foreign_key_checks\s*=\s*0|MYSQL_PWD|DATABASE_URL/)
})
