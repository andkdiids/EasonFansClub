import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { configureAndroidVersionEnv, type AndroidReleaseMetadata } from '../scripts/update-android-version-env.mjs'

const expectedProductionSha = '38a0ea45dd2d5c208326cf7fe77ff63a1895f702'
const metadata: AndroidReleaseMetadata = {
  ANDROID_VERSION_NAME: '1.0.0-beta.20',
  ANDROID_VERSION_CODE: 20,
  ANDROID_MINIMUM_VERSION_CODE: 19,
  ANDROID_FORCE_UPDATE: false,
  ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.20-b4da126.apk',
  ANDROID_APK_SHA256: 'F5E17C2B41546AF42FB943EF6B6040A55DFB31C9E67EE5849EDCAB0B3102F030',
  ANDROID_APK_SIZE: 180259847,
  ANDROID_RELEASE_NOTES: JSON.stringify([
    '新增 Android App 内检查更新功能',
    '优化每日处方头像、昵称与 UID 布局',
    '天使的礼物支持主题切换、五连抽/十连抽及勋章柜体验优化',
    '稳定性优化',
  ]),
  ANDROID_PUBLISHED_AT: '2026-10-30T00:00:00.000Z',
}

function fixture(t: test.TestContext, envContents = '# retained settings\nDATABASE_URL=do-not-print-this\nANDROID_VERSION_CODE=19\nANDROID_FORCE_UPDATE=false\n') {
  const appDir = mkdtempSync(path.join(os.tmpdir(), 'ecfc-android-metadata-'))
  t.after(() => rmSync(appDir, { recursive: true, force: true }))
  const releaseDir = path.join(appDir, 'releases', expectedProductionSha)
  const sharedDir = path.join(appDir, 'shared')
  mkdirSync(releaseDir, { recursive: true })
  mkdirSync(sharedDir)
  writeFileSync(path.join(releaseDir, '.deployed-sha'), `${expectedProductionSha}\n`)
  writeFileSync(path.join(sharedDir, '.env'), envContents, { mode: 0o640 })
  if (process.platform !== 'win32') chmodSync(path.join(sharedDir, '.env'), 0o640)
  symlinkSync(releaseDir, path.join(appDir, 'current'), process.platform === 'win32' ? 'junction' : 'dir')
  return { appDir, envPath: path.join(sharedDir, '.env'), sharedDir }
}

test('updates only allowlisted Android metadata and creates a protected verified backup', (t) => {
  const { appDir, envPath, sharedDir } = fixture(t)
  const before = readFileSync(envPath, 'utf8')
  const result = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata, now: new Date('2026-10-30T00:00:00Z') })
  const after = readFileSync(envPath, 'utf8')
  assert.match(after, /DATABASE_URL=do-not-print-this/)
  assert.match(after, /ANDROID_VERSION_CODE="20"/)
  assert.match(after, /ANDROID_APK_SIZE="180259847"/)
  assert.equal((after.match(/^ANDROID_[A-Z0-9_]+=/gm) ?? []).length, 9)
  assert.equal(result.changedKeys.length, 9)
  assert.equal(readFileSync(result.backupPath, 'utf8'), before)
  assert.equal(result.backupPath.includes(path.join(sharedDir, '.env-backups')), true)
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(path.dirname(result.backupPath)).mode & 0o777, 0o700)
    assert.equal(lstatSync(result.backupPath).mode & 0o777, 0o600)
  }
})

test('production SHA mismatch fails before creating a backup or changing env', (t) => {
  const { appDir, envPath, sharedDir } = fixture(t)
  const before = readFileSync(envPath, 'utf8')
  assert.throws(() => configureAndroidVersionEnv({ appDir, expectedProductionSha: 'a'.repeat(40), metadata }), /PRODUCTION_SHA_MISMATCH/)
  assert.equal(readFileSync(envPath, 'utf8'), before)
  assert.equal(lstatSync(sharedDir).isDirectory(), true)
  assert.equal(existsSync(path.join(sharedDir, '.env-backups')), false)
})

test('duplicate metadata keys and invalid release size fail closed', (t) => {
  const duplicate = fixture(t, 'ANDROID_VERSION_CODE=19\nANDROID_VERSION_CODE=18\n')
  assert.throws(() => configureAndroidVersionEnv({ appDir: duplicate.appDir, expectedProductionSha, metadata }), /DUPLICATE_ENV_KEY:ANDROID_VERSION_CODE/)
  const bad = fixture(t)
  assert.throws(() => configureAndroidVersionEnv({
    appDir: bad.appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_APK_SIZE: 0 },
  }), /INVALID_APK_SIZE/)
})

test('the production CLI enforces the fixed production target and never echoes env values', () => {
  const envPath = path.resolve('scripts/update-android-version-env.mjs')
  const result = spawnSync(process.execPath, [envPath], {
    encoding: 'utf8',
    env: { ...process.env, APP_DIR: os.tmpdir(), EXPECTED_PRODUCTION_SHA: expectedProductionSha,
      ANDROID_RELEASE_METADATA_B64: Buffer.from(JSON.stringify(metadata)).toString('base64') },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ANDROID_METADATA_UPDATE_FAILED=UNEXPECTED_PRODUCTION_APP_DIR/)
  assert.doesNotMatch(result.stdout + result.stderr, /DATABASE_URL|do-not-print-this/)
})

test('the production metadata workflow is manual, host-pinned, app-config-only, and validates COS before writing', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/configure-android-version.yml'), 'utf8')
  const deployWorkflow = readFileSync(path.resolve('.github/workflows/deploy.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /environment: Production/)
  assert.match(workflow, /vars\.PRODUCTION_SSH_HOST_KEY_SHA256/)
  assert.ok(workflow.indexOf('Verify final APK stored in COS') < workflow.indexOf('Update only Android version variables'))
  assert.match(workflow, /node --input-type=module -/)
  assert.doesNotMatch(workflow, /prisma migrate|DATABASE_URL|notification:integrity|npm run seed/i)
  for (const file of [
    'lib/app-version.ts',
    'tests/app-version.test.ts',
    'tests/update-android-version-env.test.ts',
    'docs/app-version-api.md',
    'scripts/update-android-version-env.mjs',
    'scripts/update-android-version-env.d.mts',
  ]) {
    assert.ok(deployWorkflow.includes(`      - '${file}'`), `${file} must not start the default full database deployment`)
  }
})
