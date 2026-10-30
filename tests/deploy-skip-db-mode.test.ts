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
  const fullStart = deploy.indexOf('\nelse\n  log_step "6/8" "Apply migrations and verify database state before current switch"', skipStart)
  const fullEnd = deploy.indexOf('\nfi\n\natomic_switch()', fullStart)
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
  assert.match(workflow, /db_mode:[\s\S]*?options:[\s\S]*?- full[\s\S]*?- skip-db[\s\S]*?default: full/)
  assert.match(workflow, /deploy_arguments\+=\(--skip-db\)/)
  assert.match(deploy, /deploy_parse_db_mode_arg "\$\{@:7\}"/)
})
