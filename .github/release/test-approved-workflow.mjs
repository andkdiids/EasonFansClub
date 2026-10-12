import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/production-release-approved.yml', 'utf8')
const deployment = readFileSync('.github/workflows/deploy.yml', 'utf8')
const entry = readFileSync('.github/workflows/configure-production-entry.yml', 'utf8')
const nodeBlocks = [...workflow.matchAll(/node <<'NODE'\r?\n([\s\S]*?)^\s+NODE\r?$/gm)].map(match => match[1])
assert.equal(nodeBlocks.length, 3)
const environmentCheck = nodeBlocks[0].slice(0, nodeBlocks[0].lastIndexOf('main().catch')) + 'return main()'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const checkEnvironment = new AsyncFunction('fetch', 'process', 'console', environmentCheck)
const actor = { GITHUB_API_URL: 'https://api.github.invalid', GITHUB_REPOSITORY: 'test/repo', GITHUB_ACTOR: 'initiator', GITHUB_TRIGGERING_ACTOR: 'initiator' }
const valid = () => ({
  can_admins_bypass: true,
  protection_rules: [{ type: 'branch_policy' }],
  deployment_branch_policy: { custom_branch_policies: true },
})
const mainOnly = { branch_policies: [{ name: 'main', type: 'branch' }] }
const runEnvironment = (environment, policies = mainOnly, available = true) => checkEnvironment(
  async url => ({ ok: available, json: async () => url.endsWith('deployment-branch-policies') ? policies : environment }),
  { env: actor }, { log() {} },
)

test('dispatch only, minimum permissions, protected environment, exact checkout and six-argument deploy', () => {
  const triggers = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'))
  assert.match(triggers, /workflow_dispatch:/)
  assert.doesNotMatch(triggers, /push:|pull_request:|schedule:/)
  assert.match(workflow, /GITHUB_REF" == refs\/heads\/main/)
  assert.match(workflow, /environment:\s+name: Production/)
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.approved_sha \}\}/)
  assert.match(workflow, /"\$APP_DIR" "\$APP_PORT" "\$DEPLOY_SHA" easonfansclub "\$GITHUB_REPOSITORY" "\$EXPECTED_PRODUCTION_SHA"/)
  assert.doesNotMatch(workflow, /contents: write|actions: write|permissions: write-all|cancel-in-progress: true|queue: max|curl[^\n]*(?:--insecure| -k)/)
  assert.ok(workflow.indexOf('environment:') < workflow.indexOf('secrets.PRODUCTION_SSH_KEY'))
})

test('single maintainer without required reviewers or wait timer is accepted with main-only restriction', async () => {
  await runEnvironment(valid())
  assert.doesNotMatch(nodeBlocks[0], /can_admins_bypass|prevent_self_review|independentReviewer|ENVIRONMENT_APPROVAL=ENFORCED/)
  assert.match(nodeBlocks[0], /REQUIRED_REVIEWERS=NOT_REQUIRED_SINGLE_MAINTAINER/)
})

for (const [name, mutate] of [
  ['branch restriction absent', e => { e.deployment_branch_policy = null }],
  ['custom main policy disabled', e => { e.deployment_branch_policy.custom_branch_policies = false }],
]) {
  test('environment check fails closed: ' + name, async () => {
    const environment = valid()
    mutate(environment)
    await assert.rejects(runEnvironment(environment))
  })
}
test('tag named main is not an approved branch', async () => {
  await assert.rejects(runEnvironment(valid(), { branch_policies: [{ name: 'main', type: 'tag' }] }))
})
test('additional release branch cannot bypass main restriction', async () => {
  await assert.rejects(runEnvironment(valid(), { branch_policies: [...mainOnly.branch_policies, { name: 'release/*', type: 'branch' }] }))
})
test('unavailable environment API is rejected rather than assuming main-only protection', async () => {
  await assert.rejects(runEnvironment(valid(), mainOnly, false))
})

const dispatch = workflow.match(/id: inputs[\s\S]*?run: \|\r?\n([\s\S]*?)(?=^ {6}- name:)/m)?.[1].replace(/^ {10}/gm, '')
assert.ok(dispatch)
for (const [label, overrides, success] of [
  ['manual dispatch from main', {}, true],
  ['push is rejected', { GITHUB_EVENT_NAME: 'push' }, false],
  ['pull request is rejected', { GITHUB_EVENT_NAME: 'pull_request' }, false],
  ['dispatch from RC is rejected', { GITHUB_REF: 'refs/heads/release/topic-activity-v612-locked-sha' }, false],
  ['short SHA is rejected', { APPROVED_SHA: '47396d19' }, false],
  ['malformed baseline is rejected', { EXPECTED_PRODUCTION_SHA: 'main' }, false],
  ['invalid branch input is rejected', { APPROVED_RC_BRANCH: 'release/../main' }, false],
]) {
  test('dispatch guard executes: ' + label, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ecfc-manual-dispatch-'))
    const output = path.join(root, 'output').replaceAll('\\', '/')
    try {
      const result = spawnSync(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash', ['-c', dispatch], {
        encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
          APPROVED_SHA: '47396d19842755491e9634605a7d535c163b4495', EXPECTED_PRODUCTION_SHA: '635ae4a0e1d8eae9d93420517a17f4b29794896f',
          APPROVED_RC_BRANCH: 'release/topic-activity-v612-locked-sha', GITHUB_OUTPUT: output, ...overrides },
      })
      if (success) {
        assert.equal(result.status, 0, result.stderr)
        assert.match(readFileSync(output, 'utf8'), /approved_sha=47396d19842755491e9634605a7d535c163b4495/)
      } else {
        assert.notEqual(result.status, 0)
        assert.match(result.stdout + result.stderr, /::error::/)
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test('server preflight checks rollback completeness, migration status and lock before deploy', () => {
  assert.match(workflow, /flock -s -n 8 \|\| fail DEPLOYMENT_IN_PROGRESS/)
  assert.match(workflow, /package\.json ecosystem\.config\.js \.next\/BUILD_ID \.env/)
  assert.match(workflow, /ROLLBACK_RELEASE_INCOMPLETE/)
  assert.match(workflow, /LIVE_SHA_MISMATCH/)
  assert.match(workflow, /DATABASE_MIGRATION_COUNTS_NOT_CLEAN/)
  assert.match(workflow, /MIGRATION_DIVERGENCE/)
  const preflight = workflow.indexOf('id: live_preflight')
  const deploy = workflow.indexOf('id: deploy')
  assert.ok(preflight > 0 && deploy > preflight)
  assert.match(workflow, /candidate\/scripts\/rollback-production-git\.sh/)
  assert.doesNotMatch(workflow, /pm2 (?:reload|restart) (?:all|instagram-sync-worker)/)
})
test('remote workflow path with @ref suffix is still recognized as a deployment', () => {
  assert.equal('.github/workflows/deploy.yml@refs/heads/main'.split('@', 1)[0], '.github/workflows/deploy.yml')
  assert.equal((workflow.match(/String\(run\.path \|\| ''\)\.split\('@', 1\)\[0\]/g) || []).length, 2)
})
test('installation closes both existing push write paths, without relying solely on commit markers', () => {
  assert.match(deployment, /paths-ignore:\s+- ['"]\.github\/\*\*['"]/)
  const entryEvents = entry.slice(entry.indexOf('on:'), entry.indexOf('permissions:'))
  assert.match(entryEvents, /workflow_dispatch:/)
  assert.doesNotMatch(entryEvents, /push:|schedule:|workflow_run:|repository_dispatch:/)
  const stage1 = ['.github/workflows/deploy.yml', '.github/workflows/configure-production-entry.yml']
  const stage2 = ['.github/workflows/production-release-approved.yml', '.github/release/approved-release-guard.sh', '.github/release/test-approved-release-guard.sh', '.github/release/test-approved-workflow.mjs', '.github/release-policies/production-topic-activity-v612.json']
  for (const files of [stage1, stage2]) {
    assert.ok(files.every(file => file.startsWith('.github/')))
    assert.equal(files.some(file => !file.startsWith('.github/')), false, 'main application deployment is path-filtered')
    assert.equal(entryEvents.includes('push:'), false, 'entry configuration cannot auto-run')
  }
})

test('main installation trigger matrix rejects mixed application/documentation commits', () => {
  assert.match(deployment, /paths-ignore:\s+- ['"]\.github\/\*\*['"]/)
  const runsApplicationPush = (branch, files) => branch === 'main' && files.some(file => !file.startsWith('.github/'))
  for (const [label, branch, files, expected] of [
    ['stage 1 control-only', 'main', ['.github/workflows/deploy.yml', '.github/workflows/configure-production-entry.yml'], false],
    ['stage 2 control-only', 'main', ['.github/workflows/production-release-approved.yml', '.github/release-policies/production-topic-activity-v612.json'], false],
    ['control update', 'main', ['.github/release/test-approved-workflow.mjs'], false],
    ['documentation mixed in must stop installation', 'main', ['.github/workflows/production-release-approved.yml', 'docs/safe-sha-release-main-installation.md'], true],
    ['application mixed in must stop installation', 'main', ['.github/workflows/production-release-approved.yml', 'app/page.tsx'], true],
    ['RC branch does not auto-deploy', 'release/topic-activity-v612-locked-sha', ['app/page.tsx'], false],
  ]) assert.equal(runsApplicationPush(branch, files), expected, label)
})

test('actual installation job expression skips infra-only push even if path filtering falls back', () => {
  const expression = deployment.match(/    if: >-\r?\n((?: {6}[^\r\n]*\r?\n)+)/)?.[1].trim()
  assert.ok(expression)
  const evaluate = new Function('github', 'contains', 'return (' + expression + ')')
  const contains = (haystack, needle) => String(haystack || '').toLowerCase().includes(String(needle).toLowerCase())
  const github = (event, ref, message) => ({ event_name: event, ref, event: { head_commit: { message } } })
  const installationMessage = '[infra-only] chore: prepare safe release workflow installation [skip actions]'
  assert.equal(evaluate(github('push', 'refs/heads/main', installationMessage), contains), false)
  assert.equal(evaluate(github('push', 'refs/heads/main', 'ordinary application commit'), contains), true)
  assert.equal(evaluate(github('workflow_dispatch', 'refs/heads/main', installationMessage), contains), true,
    'manual dispatch is not stopped by commit markers, so installation must not dispatch')
  assert.equal(evaluate(github('workflow_dispatch', 'refs/heads/release/topic-activity-v612-locked-sha', ''), contains), false)
})

const rollbackGate = workflow.slice(workflow.indexOf('          for required_file in package.json'), workflow.indexOf('          pm2_json='))
assert.ok(rollbackGate.includes('ROLLBACK_RELEASE_INCOMPLETE'))
for (const missing of [null, '.next/BUILD_ID', '.env', 'ecosystem.config.js', 'node_modules']) {
  test('rollback completeness guard executes: ' + (missing || 'complete baseline'), () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ecfc-rollback-layout-'))
    try {
      mkdirSync(path.join(root, '.next'))
      if (missing !== 'node_modules') mkdirSync(path.join(root, 'node_modules'))
      for (const file of ['package.json', 'ecosystem.config.js', '.next/BUILD_ID', '.env']) {
        if (file !== missing) writeFileSync(path.join(root, file), 'test-fixture\n')
      }
      const result = spawnSync(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash', ['-c',
        'set -euo pipefail; fail() { echo "$1" >&2; exit 1; }; current_target="$FIXTURE_RELEASE"; live_sha="$FIXTURE_SHA";\n' + rollbackGate], {
        encoding: 'utf8', env: { ...process.env, FIXTURE_RELEASE: root.replaceAll('\\', '/'), FIXTURE_SHA: '635ae4a0e1d8eae9d93420517a17f4b29794896f' },
      })
      if (missing) {
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /ROLLBACK_(?:RELEASE_INCOMPLETE|DEPENDENCIES_UNAVAILABLE)/)
      } else {
        assert.equal(result.status, 0, result.stderr)
        assert.match(result.stdout, /ROLLBACK_SHA=635ae4a0e1d8eae9d93420517a17f4b29794896f/)
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
test('all embedded runner Bash and JavaScript blocks are syntactically valid', () => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
  let count = 0
  for (const source of [workflow, deployment]) {
    const lines = source.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const start = lines[i].match(/^(\s+)(?:run|script): \|\s*$/)
      if (!start) continue
      const indent = start[1].length + 2
      const body = []
      while (++i < lines.length && (!lines[i].trim() || lines[i].startsWith(' '.repeat(indent)))) body.push(lines[i].slice(indent))
      i--
      const parsed = spawnSync(bash, ['-n'], { input: body.join('\n'), encoding: 'utf8' })
      assert.equal(parsed.status, 0, parsed.stderr)
      count++
    }
  }
  assert.ok(count >= 17, 'expected every embedded run/script block')
  for (const block of nodeBlocks) new Function(block)
})
