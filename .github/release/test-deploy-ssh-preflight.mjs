import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
const configureStart = workflow.indexOf('      - name: Configure deployment SSH')
const checkStart = workflow.indexOf('      - name: Check server connection and directory permissions')
const deployStart = workflow.indexOf('      - name: Deploy exact commit from server Git')
const check = workflow.slice(checkStart, deployStart)
const configure = workflow.slice(configureStart, checkStart)

test('deployment preflight uses the verified strict OpenSSH identity', () => {
  assert.ok(configureStart >= 0 && checkStart > configureStart && deployStart > checkStart)
  assert.match(configure, /PINNED_HOST_KEY_SHA256: \$\{\{ vars\.PRODUCTION_SSH_HOST_KEY_SHA256 \}\}/)
  assert.match(configure, /ssh-keyscan[\s\S]*?ssh-keygen -lf[\s\S]*?\$\{PINNED_HOST_KEY_SHA256\}/)
  assert.match(configure, /install -m 600 "\$\{verified_file\}" "\$\{HOME\}\/\.ssh\/known_hosts"/)
  assert.doesNotMatch(configure, />> "\$\{HOME\}\/\.ssh\/known_hosts"/)

  assert.match(check, /run: \|/)
  assert.doesNotMatch(check, /uses: appleboy\/ssh-action/)
  assert.match(check, /StrictHostKeyChecking=yes/)
  assert.match(check, /UserKnownHostsFile="\$\{HOME\}\/\.ssh\/known_hosts"/)
  assert.match(check, /GlobalKnownHostsFile=\/dev\/null/)
  assert.match(check, /-i "\$\{RUNNER_TEMP\}\/easonfansclub_deploy_key"/)
  assert.match(check, /ssh -T "\$\{ssh_options\[@\]\}"/)
  assert.match(check, /printf -v remote_command 'APP_DIR=%q DEPLOY_SHA=%q bash -s'/)
  assert.match(check, /<<'REMOTE'[\s\S]*?REMOTE\s*$/)
  assert.match(check, /flock -n 9/)
  assert.match(check, /Production current must already be a symlink into releases/)
  assert.match(check, /git -C "\$\{APP_DIR\}\/repo" rev-parse/)
  assert.doesNotMatch(check, /StrictHostKeyChecking=(?:no|accept-new)|\b(?:pm2|prisma migrate|ln -s|rm -rf)\b/i)
})

test('deployment and guarded rollback retain strict host-key verification', () => {
  assert.doesNotMatch(workflow, /appleboy\/ssh-action/)
  assert.match(workflow, /Deploy exact commit from server Git[\s\S]*?StrictHostKeyChecking=yes/)
  assert.match(workflow, /Guarded rollback after deploy or public-health failure[\s\S]*?StrictHostKeyChecking=yes/)
  assert.match(workflow, /paths-ignore:[\s\S]*?- '\.github\/\*\*'/)
})
