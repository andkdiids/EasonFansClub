import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const safety = read('scripts/deploy-safety.sh')
const deploy = read('scripts/deploy-production-git.sh')
const ecosystem = read('ecosystem.config.js')
const worker = read('scripts/instagram-sync-worker.ts')

test('production release process allowlist contains only Web and the Instagram Worker', () => {
  const body = safety.slice(safety.indexOf('deploy_release_pm2_names()'), safety.indexOf('deploy_run_pm2_reload()'))
  assert.match(body, /\[ "\$1" = "easonfansclub" \] \|\| return 78/)
  assert.match(body, /printf '%s\\n' "\$1"/)
  assert.match(body, /printf '%s\\n' "instagram-sync-worker"/)
  assert.doesNotMatch(body, /reload all|all processes/i)
})

test('Worker restart requires its graceful-shutdown configuration and an eight-minute command bound', () => {
  assert.match(ecosystem, /kill_timeout:\s*6\s*\*\s*60\s*\*\s*1000/)
  assert.match(worker, /process\.once\('SIGTERM', requestStop\)/)
  assert.match(worker, /if \(stopping\) return Promise\.resolve\(\)/)
  assert.match(deploy, /Number\(matches\[0\]\.kill_timeout\) < 360_000/)
  assert.match(deploy, /pm2_action=restart/)
  assert.match(deploy, /pm2_timeout=8m/)
  assert.match(deploy, /deploy_run_pm2_reload "\$\{app_name\}" "\$\{pm2_timeout\}" pm2/)
})

test('full database deployment stops legacy Web writes and can restart the stopped app from the selected release', () => {
  assert.match(deploy, /LEGACY_WEB_APP_STOPPED=YES/)
  assert.match(deploy, /Stopping the legacy Web app so its unfenced Instagram admin routes cannot write during migration/)
  assert.match(deploy, /case "\$\{pm2_status\}" in[\s\S]*?stopped[\s\S]*?pm2_action=restart[\s\S]*?online[\s\S]*?pm2_action=reload/)
  assert.match(deploy, /legacy_web_stopped[\s\S]*?reload_pm2 "\$\{PM2_APP_NAME\}" "\$\{legacy_sha\}"[\s\S]*?check_web_health "\$\{previous_target\}" "\$\{legacy_sha\}"/)
})

test('post-switch and rollback health require actual PM2 release SHA and process cwd checks', () => {
  assert.match(deploy, /pm2_deploy_sha\}.*release_sha/)
  assert.match(deploy, /readlink "\/proc\/\$\{pm2_pid\}\/cwd"/)
  assert.match(deploy, /reload_release_processes "\$\{release_sha\}"/)
  assert.match(deploy, /reload_release_processes "\$\{DEPLOY_SHA\}"/)
  assert.match(deploy, /WEB_RELEASE_SHA=\$\{expected_sha\}/)
  assert.match(deploy, /WORKER_RELEASE_SHA=\$\{expected_sha\}/)
  assert.doesNotMatch(deploy, /pm2\s+(?:restart|reload)\s+all/)
})

test('maintenance helper failure reports liveness, exit status, and a redacted helper log before blocking deployment', () => {
  assert.match(deploy, /print_instagram_maintenance_helper_diagnostics\(\)[\s\S]*?INSTAGRAM_MAINTENANCE_HELPER_PID_STATE=EXITED[\s\S]*?wait "\$\{instagram_maintenance_hold_pid\}"[\s\S]*?INSTAGRAM_MAINTENANCE_HELPER_EXIT_STATUS=/)
  assert.ok(deploy.includes("sed -E 's#(mysql|postgresql|postgres)://[^[:space:]]+#\\1://[REDACTED]#gi'"))
  assert.match(deploy, /print_instagram_maintenance_helper_diagnostics\r?\n[ \t]*die "Instagram maintenance helper is no longer live/)
})
