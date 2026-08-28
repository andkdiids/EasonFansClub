import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const deployScript = read('scripts/deploy-production-git.sh')
const deployWorkflow = read('.github/workflows/deploy.yml')

test('生产部署在切换 current 前强制执行 migration 和通知完整性门禁', () => {
  const buildStart = deployScript.indexOf('pnpm_run build')
  const migrationStart = deployScript.indexOf('pnpm_run prisma migrate deploy')
  const integrityStart = deployScript.indexOf('pnpm_run notification:integrity')
  const switchStep = deployScript.indexOf('log_step "7/8" "Atomically switch current and reload PM2"')
  const switchCall = deployScript.indexOf('atomic_switch "${release_dir}"', switchStep)
  const reloadCall = deployScript.indexOf('if ! reload_pm2 "${DEPLOY_SHA}"', switchStep)
  const healthStep = deployScript.indexOf('log_step "8/8" "Verify health and retain rollback releases"')
  const deployedShaWrite = deployScript.indexOf('mv -Tf -- "${deployed_sha_tmp}" "${release_dir}/.deployed-sha"')

  assert.ok(buildStart >= 0)
  assert.ok(migrationStart > buildStart)
  assert.ok(integrityStart > migrationStart)
  assert.ok(switchStep > integrityStart)
  assert.ok(switchCall > switchStep)
  assert.ok(reloadCall > switchCall)
  assert.ok(healthStep > reloadCall)
  assert.ok(deployedShaWrite > healthStep)
  assert.match(deployScript, /set -Eeuo pipefail/)
  assert.match(deployScript, /pnpm_run prisma migrate deploy\r?\n?pnpm_run notification:integrity/)
  assert.match(deployScript, /printf '%s\\n' "\$\{DEPLOY_SHA\}" > "\$\{deployed_sha_tmp\}"/)
  assert.doesNotMatch(deployScript.slice(0, switchStep), /printf '%s\\n' "\$\{DEPLOY_SHA\}" > "\$\{release_dir\}\/\.deployed-sha"/)
  assert.doesNotMatch(deployScript, /PRODUCTION_MIGRATION_MODE/)
})

test('迁移失败时部署脚本不会在迁移前切换 current 或 reload PM2', () => {
  const migrationLine = deployScript.match(/^[ \t]*pnpm_run prisma migrate deploy[ \t]*$/m)
  assert.ok(migrationLine)
  assert.doesNotMatch(deployScript.slice(0, migrationLine!.index), /atomic_switch "\$\{release_dir\}"/)
  assert.doesNotMatch(deployScript.slice(0, migrationLine!.index), /pm2 (reload|start)/)
  assert.match(deployWorkflow, /< scripts\/deploy-production-git\.sh/)
  assert.doesNotMatch(deployWorkflow, /bootstrap_release|\.bootstrap-release/)
  assert.match(deployWorkflow, /refusing pre-migration bootstrap/)
})

test('通知完整性检测是只读的，并在空 Notification.type 存在时失败', () => {
  const integrity = read('scripts/check-notification-integrity.ts')
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
  assert.match(integrity, /SELECT COUNT\(\*\)/)
  assert.match(integrity, /CAST\(\\`type\\` AS CHAR\)/)
  assert.match(integrity, /process\.exitCode = 1/)
  assert.doesNotMatch(integrity, /\b(INSERT|UPDATE|DELETE)\b/)
  assert.equal(packageJson.scripts?.['notification:integrity'], 'tsx scripts/check-notification-integrity.ts')
})
