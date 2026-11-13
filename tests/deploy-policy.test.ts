import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

test('production deployment has no manual backup attestation dependency', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const deployScript = read('scripts/deploy-production-git.sh')
  const serverRcWorkflow = read('.github/workflows/production-server-rc-v3.yml')
  const activeWorkflow = workflow.replace(/paths-ignore:[\s\S]*?\n  workflow_dispatch:/, 'workflow_dispatch:')
  const forbiddenGate = /production-backup-gate|BACKUP_GATE|BACKUP_ATTESTATION|risk_acceptance|restore_drill_waiver|DB_BACKUP_CONFIRMED|BACKUP_CONFIRMATION_SOURCE/i

  for (const [name, contents] of Object.entries({ workflow: activeWorkflow, deployScript, serverRcWorkflow })) {
    assert.doesNotMatch(contents, forbiddenGate, name + ' must not require or consume a backup/PITR/restore attestation')
  }

  assert.match(workflow, /db_mode:[\s\S]*?options:[\s\S]*?- full[\s\S]*?- skip-db[\s\S]*?default: full/)
  assert.match(workflow, /DEPLOY_DB_MODE: .*inputs\.db_mode/)
  assert.match(workflow, /DATABASE_DEPLOYMENT_MODE=FULL/)
  assert.match(workflow, /DATABASE_DEPLOYMENT_MODE=SKIP_DB/)
  assert.doesNotMatch(workflow, /BACKUP_VERIFIED=PASS|BACKUP_PITR_VERIFIED=PASS|RESTORE_DRILL_VERIFIED=PASS/i)

  const ignoredPaths = workflow.match(/paths-ignore:\s*([\s\S]*?)\n  workflow_dispatch:/)?.[1] ?? ''
  for (const path of [
    'tests/**',
    'scripts/production-backup-gate.mjs',
    'scripts/production-backup-gate.d.mts',
    'scripts/production-risk-attestation.mjs',
    'scripts/diagnose-production-attestation.mjs',
    'scripts/quarantine-invalid-production-attestation.mjs',
    'scripts/verify-production-quarantine-archive.mjs',
    'tests/production-backup-gate.test.ts',
    'tests/deploy-backup-gate.test.ts',
    'tests/production-risk-attestation.test.mjs',
    'tests/production-attestation-diagnostic.test.mjs',
    'tests/production-attestation-quarantine.test.mjs',
    'tests/production-attestation-quarantine-integrity.test.mjs',
    'tests/deploy-policy.test.ts',
  ]) assert.ok(ignoredPaths.includes("'" + path + "'"), path + ' must not trigger the default production deploy')
})

test('independent locked production SHA preflight and CAS remain mandatory', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const deployScript = read('scripts/deploy-production-git.sh')
  const preflightStart = workflow.indexOf('- name: Read the production SHA under the deployment lock')
  const deployStart = workflow.indexOf('- name: Deploy exact commit from server Git')
  const preflight = workflow.slice(preflightStart, deployStart)

  assert.ok(preflightStart >= 0 && deployStart > preflightStart)
  assert.match(preflight, /scripts\/production-sha-preflight\.sh/)
  assert.match(preflight, /production_sha=/)
  assert.match(workflow.slice(deployStart), /EXPECTED_PRODUCTION_SHA:/)
  assert.ok(deployScript.includes('flock -n 9 || die'))
  assert.ok(deployScript.includes('deploy_require_expected_production_sha'))
  assert.ok(deployScript.indexOf('flock -n 9 || die') < deployScript.indexOf('deploy_require_expected_production_sha'))
})

test('full mode keeps migration ledger and Instagram drain protections; skip-db omits migration phases', () => {
  const deployScript = read('scripts/deploy-production-git.sh')
  const modeStart = 'if [ "' + String.fromCharCode(36) + '{db_mode}" = skip-db ]; then\n'
  const buildIndex = deployScript.indexOf('pnpm_run build')
  const skipStart = deployScript.indexOf(modeStart, buildIndex)
  const fullStart = deployScript.indexOf('\nelse\n  log_step "5/8" "Stop legacy Web/Worker processes and establish the cross-instance maintenance drain"', skipStart)
  const fullEnd = deployScript.indexOf('\nfi\n}\n\natomic_switch()', fullStart)

  assert.ok(skipStart >= 0 && fullStart > skipStart && fullEnd > fullStart)
  const skipDbBranch = deployScript.slice(skipStart, fullStart)
  const fullDbBranch = deployScript.slice(fullStart, fullEnd)
  assert.match(skipDbBranch, /DATABASE MIGRATION: SKIPPED/)
  assert.match(skipDbBranch, /PRISMA_MIGRATE_DEPLOY_EXECUTED=NO/)
  assert.doesNotMatch(skipDbBranch, /^\s*(?:pnpm_(?:run|with_timeout)|node scripts\/check-topic-lottery-maintenance)/m)
  assert.match(fullDbBranch, /start_instagram_maintenance_drain/)
  assert.match(fullDbBranch, /pnpm_with_timeout 1m migration:check:mysql/)
  assert.match(fullDbBranch, /check-topic-lottery-maintenance\.mjs/)
  assert.match(fullDbBranch, /pnpm_run prisma migrate deploy/)
  assert.match(fullDbBranch, /check-instagram-lease-generation-migration\.ts after/)
  assert.match(fullDbBranch, /prisma migrate status/)
  assert.ok(fullDbBranch.indexOf('start_instagram_maintenance_drain') < fullDbBranch.indexOf('pnpm_run prisma migrate deploy'))
  assert.match(deployScript, /INSTAGRAM_MAINTENANCE_HOLD_RETAINED=YES/)
  assert.match(deployScript, /assert_instagram_maintenance_drain_live/)
})

test('failed release rollback and readonly migration diagnosis remain intact', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const deployScript = read('scripts/deploy-production-git.sh')
  const migrationDiagnostic = read('.github/workflows/production-migration-status.yml')

  assert.match(workflow, /Guarded rollback after deploy or public-health failure/)
  assert.match(workflow, /Verify public SHA after guarded rollback/)
  assert.match(deployScript, /rollback_release\(\)/)
  assert.match(deployScript, /Health check failed and automatic rollback also failed/)
  assert.match(migrationDiagnostic, /READONLY_MODE=YES/)
  assert.match(migrationDiagnostic, /emit\('BACKUP_PITR_VERIFIED', 'NO'\)/)
  assert.match(migrationDiagnostic, /emit\('RESTORE_DRILL_VERIFIED', 'NO'\)/)
  assert.doesNotMatch(migrationDiagnostic, /emit\('(BACKUP_PITR_VERIFIED|RESTORE_DRILL_VERIFIED)', 'PASS'\)/)
  assert.doesNotMatch(migrationDiagnostic, /migrate deploy|db push|INSERT INTO|DELETE FROM|DROP TABLE|ALTER TABLE/)
})

test('production writers remain serialized without backup-attestation workflow', () => {
  const serializedWriters = [
    '.github/workflows/deploy.yml',
    '.github/workflows/configure-android-version.yml',
    '.github/workflows/rollback-android-version.yml',
    '.github/workflows/rollback-android-version-to-code31.yml',
    '.github/workflows/rollback-android-version-to-code32.yml',
    '.github/workflows/rollback-android-version-to-code33.yml',
    '.github/workflows/rollback-native-bearer-server.yml',
    '.github/workflows/production-release-approved.yml',
    '.github/workflows/production-server-rc-v3.yml',
    '.github/workflows/publish-android-rc11.yml',
  ]
  for (const path of serializedWriters) {
    const contents = read(path)
    assert.match(contents, /group: production-deploy/, path + ' must share the production deployment lock')
    assert.match(contents, /cancel-in-progress:\s*false/, path + ' must not cancel an active production operation')
  }
  const entryConfig = read('.github/workflows/configure-production-entry.yml')
  assert.match(entryConfig, /group: production-entry/)
  assert.doesNotMatch(entryConfig, /deploy-production-git\.sh|rollback-production-git\.sh|\.deployed-sha/)
})
