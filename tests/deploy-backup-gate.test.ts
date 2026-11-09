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

test('risk acceptance (schemaVersion=3) is opt-in, asserts nothing verified, and cannot fabricate a backup', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const gate = read('scripts/production-backup-gate.mjs')
  const gateStep = workflow.indexOf('- name: Require a verified recoverable production database backup')
  const deployStep = workflow.indexOf('- name: Deploy exact commit from server Git')
  const gateBlock = workflow.slice(gateStep, deployStep)

  // Opt-in only: a push event must stay on the strict path.
  assert.match(workflow, /inputs\.risk_acceptance \|\| 'none'/)
  assert.match(workflow, /RISK_ACCEPTANCE_MODE=/)
  assert.match(gateBlock, /--risk-acceptance-mode %q/)
  assert.doesNotMatch(workflow, /risk_acceptance:[\s\S]{0,300}?default: approved/)

  // When approved, the gate must report that nothing was verified and must not
  // carry a backup id (anti-fabrication).
  const riskBlock = workflow.slice(
    workflow.indexOf('RISK_ACCEPTANCE_MODE=APPROVED'),
    workflow.indexOf('BACKUP_GATE_STEP=PASS'),
  )
  assert.match(riskBlock, /RISK_ACCEPTED=YES/)
  assert.match(riskBlock, /BACKUP_VERIFIED=NO/)
  assert.match(riskBlock, /BACKUP_PITR_VERIFIED=NO/)
  assert.match(riskBlock, /must not assert a backup id/)

  // The gate itself rejects any fabricated backup/PITR/drill fact in v3.
  assert.match(gate, /RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP/)
  assert.match(gate, /RISK_ACCEPTANCE_NOT_ENABLED/)
  assert.match(gate, /RISK_ACCEPTANCE_RELEASE_ID_MISMATCH/)
})

test('schema v3 is consumed only after the final locked SHA compare-and-swap, with no automatic push deployment', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const gate = read('scripts/production-backup-gate.mjs')
  const script = read('scripts/deploy-production-git.sh')
  const ignore = workflow.match(/paths-ignore:\s*([\s\S]*?)\n\s+workflow_dispatch:/)?.[1] ?? ''
  const gateStart = workflow.indexOf('- name: Require a verified recoverable production database backup')
  const deployStart = workflow.indexOf('- name: Deploy exact commit from server Git')
  const deployEnd = workflow.indexOf('- name: Verify public website', deployStart)
  const gateBlock = workflow.slice(gateStart, deployStart)
  const deployBlock = workflow.slice(deployStart, deployEnd)

  assert.match(gateBlock, /--cli verify/)
  assert.doesNotMatch(gateBlock, /--cli consume|RISK_ACCEPTANCE_CONSUMED/)
  assert.match(gateBlock, /BACKUP_GATE_SCHEMA_VERSION=3/)
  assert.match(gateBlock, /BACKUP_ATTESTATION_TARGET_SHA=/)
  assert.match(deployBlock, /BACKUP_GATE_RUN_ID: \$\{\{ github\.run_id \}\}/)
  assert.match(deployBlock, /EXPECTED_PRODUCTION_SHA: \$\{\{ steps\.backup_gate\.outputs\.production_sha \}\}/)
  assert.doesNotMatch(deployBlock, /expected_production_sha="\$\(/)
  assert.match(deployBlock, /BACKUP_GATE_RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/)
  assert.match(deployBlock, /BACKUP_GATE_ATTESTATION_FILE=/)
  assert.match(deployBlock, /BACKUP_GATE_RISK_ACCEPTANCE_MODE=/)
  assert.match(deployBlock, /BACKUP_GATE_RUN_ID=\$\{BACKUP_GATE_RUN_ID:-\}/)

  const preflightLock = gateBlock.indexOf('flock -n 9')
  const capturedSha = gateBlock.indexOf('BACKUP_GATE_PRODUCTION_SHA=')
  const lock = script.indexOf('flock -n 9 || die')
  const lockedShaCas = script.indexOf('previous_target="$(deploy_require_expected_production_sha')
  const gateSha = script.indexOf('BACKUP_GATE_VERIFIED_SHA_CHECK=PASS')
  const consume = script.indexOf('--cli consume')
  const migration = script.indexOf('pnpm_run prisma migrate deploy')
  const switchCall = script.indexOf('atomic_switch "${release_dir}"')
  assert.ok(preflightLock >= 0 && preflightLock < capturedSha, 'preflight baseline must be captured under the server lock')
  assert.ok(lock >= 0 && lock < lockedShaCas, 'server lock must precede the live-SHA CAS')
  assert.ok(lockedShaCas < gateSha && gateSha < consume, 'consume only after the locked CAS and preflight verdict')
  assert.ok(consume < migration && consume < switchCall, 'consume before any migration or atomic switch')
  assert.match(script, /BACKUP_GATE_RISK_ACCEPTANCE_MODE/)
  assert.match(script, /BACKUP_GATE_RUN_ATTEMPT/)
  assert.match(script, /RISK_ACCEPTANCE_CONSUMED_RUN_ID=/)
  assert.match(script, /RISK_ACCEPTANCE_CONSUMED_RUN_ATTEMPT=/)
  assert.match(script, /RISK_ACCEPTANCE_ATTESTATION_ID=/)
  assert.match(gate, /RISK_ACCEPTANCE_ALREADY_CONSUMED/)
  assert.match(gate, /createExclusiveAtomic/)
  assert.match(gate, /linkSync\(temporaryPath, filePath\)/)
  assert.match(gate, /REAPPROVED_AFTER_CONSUMPTION/)
  assert.match(gate, /Never roll back or delete the old proof\/consumption records automatically/)

  const releaseControlPaths = [
    'scripts/production-backup-gate.mjs',
    'scripts/production-backup-gate.d.mts',
    'scripts/production-risk-attestation.mjs',
    'scripts/diagnose-production-attestation.mjs',
    'scripts/quarantine-invalid-production-attestation.mjs',
    'scripts/deploy-production-git.sh',
    'tests/production-backup-gate.test.ts',
    'tests/production-risk-attestation.test.mjs',
    'tests/production-attestation-diagnostic.test.mjs',
    'tests/production-attestation-quarantine.test.mjs',
    'tests/deploy-backup-gate.test.ts',
    'tests/topic-v2-main-integration.test.ts',
  ]
  for (const path of releaseControlPaths) assert.ok(ignore.includes(path), `default push deployment must ignore ${path}`)

  const serializedWriters = [
    '.github/workflows/deploy.yml',
    '.github/workflows/configure-android-version.yml',
    '.github/workflows/rollback-android-version.yml',
    '.github/workflows/rollback-android-version-to-code31.yml',
    '.github/workflows/rollback-android-version-to-code32.yml',
    '.github/workflows/rollback-native-bearer-server.yml',
    '.github/workflows/production-release-approved.yml',
    '.github/workflows/production-server-rc-v3.yml',
    '.github/workflows/issue-production-risk-acceptance.yml',
    '.github/workflows/publish-android-rc11.yml',
  ]
  for (const path of serializedWriters) {
    const source = read(path)
    assert.match(source, /group: production-deploy/, `${path} must share the production lock group`)
    assert.match(source, /cancel-in-progress:\s*false/, `${path} must not cancel an active operation`)
  }
  const entryConfig = read('.github/workflows/configure-production-entry.yml')
  assert.match(entryConfig, /group: production-entry/)
  assert.doesNotMatch(entryConfig, /deploy-production-git\.sh|rollback-production-git\.sh|\.deployed-sha/)
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
