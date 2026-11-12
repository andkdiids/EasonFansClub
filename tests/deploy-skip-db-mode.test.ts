import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isDbMaintenanceAllowed, isDeploymentDbMaintenanceHeld } from '@/lib/deployment-db-maintenance-hold'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'

test('部署脚本安全模式覆盖默认、skip-db、schema/migration 拒绝、未知参数和维护暂停文件', () => {
  const result = spawnSync(bash, ['tests/deploy-skip-db-mode.test.sh'], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /SERVER_SKIP_DB_MODE_TEST=PASS/)
})

test('候选进程只在持有 marker 时暂停数据库维护，缺少 marker 时恢复', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ecfc-db-maintenance-hold-'))
  try {
    const marker = path.join(root, 'hold')
    assert.equal(isDeploymentDbMaintenanceHeld(marker), false)
    assert.equal(isDbMaintenanceAllowed(() => isDeploymentDbMaintenanceHeld(marker)), true)

    writeFileSync(marker, 'release-sha\n')
    assert.equal(isDeploymentDbMaintenanceHeld(marker), true)
    assert.equal(isDbMaintenanceAllowed(() => isDeploymentDbMaintenanceHeld(marker)), false)

    rmSync(marker)
    assert.equal(isDeploymentDbMaintenanceHeld(marker), false)
    assert.equal(isDbMaintenanceAllowed(() => isDeploymentDbMaintenanceHeld(marker)), true)

    const notDirectory = path.join(root, 'regular-file', 'hold')
    writeFileSync(path.dirname(notDirectory), 'not a directory')
    assert.equal(isDeploymentDbMaintenanceHeld(notDirectory), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('skip-db 明确不执行部署阶段数据库命令，默认完整迁移顺序保持不变', () => {
  const deploy = readFileSync('scripts/deploy-production-git.sh', 'utf8').replaceAll('\r\n', '\n')
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8').replaceAll('\r\n', '\n')
  const skipStart = deploy.indexOf('if [ "${db_mode}" = skip-db ]; then\n  log_step "6/8"')
  const fullStart = deploy.indexOf('\nelse\n  log_step "5/8" "Stop legacy Web/Worker processes and establish the cross-instance maintenance drain"', skipStart)
  const fullEnd = deploy.indexOf('\nfi\n}\n\natomic_switch()', fullStart)
  const migration = deploy.indexOf('pnpm_run prisma migrate deploy', fullStart)
  const integrity = deploy.indexOf('pnpm_run notification:integrity', migration)
  const status = deploy.indexOf('pnpm_with_timeout 2m prisma migrate status', integrity)
  const switchStep = deploy.indexOf('log_step "7/8" "Atomically switch current and reload PM2"', fullEnd)

  assert.ok(skipStart >= 0)
  assert.ok(fullStart > skipStart)
  assert.ok(fullEnd > fullStart)
  assert.ok(migration > fullStart && integrity > migration && status > integrity && switchStep > status)
  const skippedBranch = deploy.slice(skipStart, fullStart)
  assert.match(skippedBranch, /DATABASE MIGRATION: SKIPPED/)
  assert.match(skippedBranch, /DATABASE WRITE MAINTENANCE: SKIPPED/)
  assert.match(skippedBranch, /PRISMA_MIGRATE_DEPLOY_EXECUTED=NO/)
  assert.match(skippedBranch, /NOTIFICATION_INTEGRITY_EXECUTED=NO/)
  assert.match(skippedBranch, /OTHER_DB_MAINTENANCE_EXECUTED=NO/)
  assert.doesNotMatch(skippedBranch, /pnpm_(?:run|with_timeout).*?(?:migrate|integrity)|node scripts\/check-topic-lottery-maintenance/)
  assert.doesNotMatch(skippedBranch, /BACKUP_GATE|backup_gate|production-backup-gate|instagram-maintenance|pm2 stop instagram-sync-worker/,
    'skip-db must avoid backup proof and full-mode Worker/database maintenance phases')
  const fullDbBranch = deploy.slice(fullStart, fullEnd)
  const legacyWebStop = fullDbBranch.indexOf('stop_legacy_web_app')
  const legacyStop = fullDbBranch.indexOf('stop_legacy_instagram_worker')
  const maintenanceDrain = fullDbBranch.indexOf('start_instagram_maintenance_drain')
  const migrate = fullDbBranch.indexOf('pnpm_run prisma migrate deploy')
  assert.ok(legacyWebStop >= 0 && legacyStop > legacyWebStop && maintenanceDrain > legacyStop && migrate > maintenanceDrain,
    'full mode must stop legacy Web writes and Worker tasks, then drain shared admissions before migration')
  assert.match(deploy, /pm2 stop "\$\{PM2_APP_NAME\}"/)
  assert.match(deploy, /scripts\/instagram-maintenance-hold\.ts 1800000 --allow-legacy-lease-schema/)
  assert.match(deploy, /LEGACY_INSTAGRAM_WORKER_STOPPED=YES/)
  assert.match(deploy, /pm2 stop instagram-sync-worker/)
  assert.match(deploy, /\.filter\(entry => entry\.name === "instagram-sync-worker"\)/)
  assert.match(deploy, /for worker_pid in \$\{legacy_worker_pm2_pids\}/)
  assert.match(deploy, /kill -0 "\$\{worker_pid\}"/)
  assert.match(deploy, /assert_instagram_maintenance_drain_live\n  database_migration_started=true\n  pnpm_run prisma migrate deploy\n  pnpm_run exec tsx scripts\/check-instagram-lease-generation-migration\.ts after\n  assert_instagram_maintenance_drain_live/)
  assert.match(deploy, /if \[ "\$\{instagram_maintenance_hold_ready\}" = true \][\s\S]*?safe_previous_release_verified/)
  assert.match(deploy, /database_migration_started=true[\s\S]*?pnpm_run prisma migrate deploy[\s\S]*?database_migration_completed=true/)
  assert.match(deploy, /abandon_instagram_maintenance_drain\(\)/)
  assert.match(deploy, /INSTAGRAM_MAINTENANCE_HOLD_RETAINED=YES/)
  assert.match(deploy, /check_web_health/)
  const helper = readFileSync('scripts/instagram-maintenance-hold.ts', 'utf8').replaceAll('\r\n', '\n')
  assert.match(helper, /const target = ANYWHERE_DOOR_TARGET/)
  assert.match(helper, /withInstagramMaintenanceDrain\(prisma, target/)
  assert.match(helper, /INSTAGRAM_MAINTENANCE_DRAIN_READY=YES/)
  assert.match(helper, /INSTAGRAM_MAINTENANCE_HOLD_RELEASED=YES/)
  assert.match(workflow, /db_mode:[\s\S]*?options:[\s\S]*?- full[\s\S]*?- skip-db[\s\S]*?default: full/)
  assert.match(workflow, /deploy_arguments\+=\(--skip-db\)/)
  assert.match(workflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/)
  const approvedRelease = readFileSync('.github/workflows/production-release-approved.yml', 'utf8').replaceAll('\r\n', '\n')
  assert.doesNotMatch(approvedRelease, /uses: actions\/checkout@v\d/)
  assert.equal((approvedRelease.match(/uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/g) ?? []).length, 3)
  assert.match(deploy, /deploy_parse_db_mode_arg "\$\{@:7\}"/)
  const pushPathsIgnore = workflow.match(/on:[\s\S]*?push:[\s\S]*?paths-ignore:([\s\S]*?)workflow_dispatch:/)?.[1] ?? ''
  assert.ok(pushPathsIgnore.includes("'.github/**'"), 'workflow-only changes must not trigger the default deployment')
  for (const path of [
    'app/api/material-redemptions/route.ts',
    'app/api/friends/list/route.ts',
    'docs/android-beta21-rc11-release-runbook.md',
    'middleware.ts',
    'scripts/android-rc11-cos-publish.d.mts',
    'scripts/android-rc11-cos-publish.mjs',
    'scripts/assert-native-bearer-rollback-result.d.mts',
    'scripts/assert-native-bearer-rollback-result.mjs',
    'scripts/assert-release-main.d.mts',
    'scripts/assert-release-main.mjs',
    'scripts/rollback-production-git.sh',
    'tests/android-rc11-publish-infrastructure.test.ts',
    'app/api/posts/*/schedule/route.ts',
    'scripts/android-rc14-release.json',
    'scripts/android-rc14-release.mjs',
    'tests/android-rc14-release.test.mjs',
    'tests/android-rc14-staging.test.mjs',
    'tests/post-scheduling.test.ts',
    'tests/deploy-skip-db-mode.test.ts',
    'tests/middleware-auth.test.ts',
    'tests/mobile-bearer-route-integration.test.ts',
    'tests/profile-background-mobile-lookup.test.ts',
  ]) {
    assert.ok(pushPathsIgnore.includes(`'${path}'`), `${path} merge must not trigger the default full-DB push deployment`)
  }
})
