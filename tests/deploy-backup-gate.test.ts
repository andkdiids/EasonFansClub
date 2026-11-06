import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

/**
 * Guards the production-workflow behaviour change: a deployment may only start
 * after a human-verified, recoverable CynosDB backup attestation for the exact
 * release SHA. This is deliberately a separate test file so the behaviour
 * change stays auditable on its own.
 */
test('backup attestation gate precedes migration, atomic switch and skip-db', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const script = read('scripts/deploy-production-git.sh')
  const gate = read('scripts/production-backup-gate.mjs')

  const gateStep = workflow.indexOf('- name: Require a verified recoverable production database backup')
  const deployStep = workflow.indexOf('- name: Deploy exact commit from server Git')
  assert.ok(gateStep >= 0, 'the backup gate step must exist')
  assert.ok(deployStep > gateStep, 'the backup gate must run before the deploy step')

  const gateBlock = workflow.slice(gateStep, deployStep)
  assert.doesNotMatch(gateBlock, /continue-on-error/, 'a failed gate must never be swallowed')
  assert.doesNotMatch(gateBlock, /^\s*if:\s/m, 'the gate must be unconditional')
  assert.match(gateBlock, /BACKUP_GATE=VERIFIED/)
  assert.match(gateBlock, /verified_sha=/)
  assert.match(gateBlock, /node --input-type=module/)
  assert.match(gateBlock, /< scripts\/production-backup-gate\.mjs/)
  assert.match(workflow, /skip-db is not an escape hatch/)
  assert.doesNotMatch(gateBlock, /deploy_db_mode|DEPLOY_DB_MODE|db_mode/,
    'the gate must not be conditional on the database mode')

  // The approved SHA must be forwarded into the server-side deployment script
  // and checked there for BOTH database modes, before any migration write.
  assert.match(workflow, /BACKUP_GATE_VERIFIED_SHA=/)
  const shaCheck = script.indexOf('BACKUP_GATE_VERIFIED_SHA:-')
  const migrateDeploy = script.indexOf('pnpm_run prisma migrate deploy')
  const atomicSwitch = script.indexOf('atomic_switch()')
  // There is an earlier db_mode branch in the preflight section; pin the one
  // that actually guards the migration phase.
  const dbModeBranch = script.lastIndexOf('if [ "${db_mode}" = skip-db ]; then', migrateDeploy)
  assert.ok(shaCheck >= 0, 'the deployment script must require the gate verdict')
  assert.ok(dbModeBranch > shaCheck, 'the gate must also apply to skip-db')
  assert.ok(migrateDeploy > shaCheck, 'the gate must precede prisma migrate deploy')
  assert.ok(atomicSwitch > shaCheck, 'the gate must precede the atomic switch')

  // The gate itself is strictly read-only and never fabricates a verified
  // backup from an UNKNOWN cloud-console state.
  assert.doesNotMatch(gate, /\$executeRaw|\$queryRaw|db push|INSERT INTO|DELETE FROM|DROP TABLE|ALTER TABLE/)
  assert.match(gate, /BACKUP_GATE=REJECTED/)
  assert.match(gate, /BACKUP_PITR_VERIFIED=NO/)
  assert.match(gate, /RESTORE_DRILL_VERIFIED=NO/)
  assert.match(gate, /RESTORE_DRILL_NOT_VERIFIED/)

  // The one-off drill waiver is OPT-IN: a push event always stays on the
  // strict schemaVersion=1 path, and an explicitly approved dispatch must
  // still report that the drill was NOT verified.
  assert.match(workflow, /inputs\.restore_drill_waiver \|\| 'none'/)
  assert.match(gateBlock, /RESTORE_DRILL_WAIVER_MODE/)
  assert.match(gateBlock, /--waiver-mode %q/)
  assert.match(gateBlock, /RESTORE_DRILL_WAIVED=YES/)
  assert.match(gateBlock, /RESTORE_DRILL_VERIFIED=NO/)
  assert.match(gate, /RESTORE_DRILL_WAIVED=YES/)
  assert.match(gate, /WAIVER_NOT_ENABLED/)
  assert.match(gate, /WAIVER_RELEASE_ID_MISMATCH/)
  assert.match(gate, /RESTORE_DRILL_RECORD_FORBIDDEN_IN_WAIVER/)
  assert.doesNotMatch(workflow, /restore_drill_waiver:[\s\S]{0,300}?default: approved/)
})

test('the read-only diagnostic never blocks on a not-yet-deployed candidate SHA', () => {
  const diagnostic = read('.github/workflows/production-migration-status.yml')

  assert.match(diagnostic, /DIAGNOSTIC_SCOPE=CANDIDATE_MIGRATION_TREE_VS_LIVE_DATABASE/)
  assert.match(diagnostic, /CANDIDATE_SHA=/)
  assert.match(diagnostic, /LIVE_RELEASE_SHA=/)
  assert.match(diagnostic, /READONLY_MODE=YES/)
  assert.match(diagnostic, /CANDIDATE_DEPLOYED=NO/)
  assert.match(diagnostic, /BACKUP_PITR_VERIFIED', 'NO'/)
  assert.match(diagnostic, /MIGRATION_DIVERGENCE_COUNT/)
  assert.doesNotMatch(diagnostic, /fail "LIVE_RELEASE_MISMATCH"/,
    'a candidate that is not deployed must not abort the ledger read')

  const mismatchBlock = diagnostic.slice(
    diagnostic.indexOf('LIVE_RELEASE_MATCH=NO'),
    diagnostic.indexOf('shared_env_real='),
  )
  assert.doesNotMatch(mismatchBlock, /exit 1|fail /,
    'the mismatch branch must continue into the database diagnostic')

  // Still strictly read-only.
  assert.doesNotMatch(diagnostic, /migrate deploy|db push|INSERT INTO|DELETE FROM|DROP TABLE|ALTER TABLE/)
  assert.doesNotMatch(diagnostic, /continue-on-error/)
})
