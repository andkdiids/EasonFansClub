import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { configureAndroidVersionEnv, type AndroidReleaseMetadata } from '../scripts/update-android-version-env.mjs'
import { parseAppVersionConfig } from '../lib/app-version'

const expectedProductionSha = '38a0ea45dd2d5c208326cf7fe77ff63a1895f702'
const metadata: AndroidReleaseMetadata = {
  ANDROID_VERSION_NAME: '1.0.0-beta.21',
  ANDROID_VERSION_CODE: 22,
  ANDROID_MINIMUM_VERSION_CODE: 19,
  ANDROID_FORCE_UPDATE: false,
  ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc2-20261030-172352.apk',
  ANDROID_APK_SHA256: '463E70B7A3652498EE6286D56F9B306A3222D30905C73C22B59EA61F3113282B',
  ANDROID_APK_SIZE: 180836567,
  ANDROID_RELEASE_NOTES: JSON.stringify([
    '分享升级为图片卡片并加入二维码',
    '帖子、勋章、个人主页、活动、话题活动与 Salon 支持图片分享',
    '每日处方支持全屏查看、缩放、保存和分享',
    '处方架分享入口调整至右上角',
    '更新下载支持后台下载与进度恢复',
    'Beta.21 RC2 内测版本',
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
  assert.match(after, /ANDROID_VERSION_CODE='22'/)
  assert.match(after, /ANDROID_APK_SIZE='180836567'/)
  assert.equal((after.match(/^ANDROID_[A-Z0-9_]+=/gm) ?? []).length, 9)
  assert.equal(result.changedKeys.length, 9)
  assert.equal(readFileSync(result.backupPath, 'utf8'), before)
  assert.equal(result.backupPath.includes(path.join(sharedDir, '.env-backups')), true)
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(path.dirname(result.backupPath)).mode & 0o777, 0o700)
    assert.equal(lstatSync(result.backupPath).mode & 0o777, 0o600)
  }
})

test('dotenv round-trips JSON release notes with quotes, apostrophes, hashes, and preserves the public config', (t) => {
  const { appDir, envPath } = fixture(t)
  const specialNotes = [
    "版本说明含 apostrophe's # tag",
    '双引号 " 与反斜线 \\ 保留',
    '换行符安全编码',
    '普通中文说明',
    '附加说明',
    'Beta.21 RC2 内测版本',
  ]
  const result = configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_RELEASE_NOTES: JSON.stringify(specialNotes) },
  })
  const parsedEnv = dotenv.parse(readFileSync(envPath, 'utf8'))
  const config = parseAppVersionConfig({
    ...parsedEnv,
    TENCENT_COS_SECRET_ID: 'test-id',
    TENCENT_COS_SECRET_KEY: 'test-key',
    TENCENT_COS_BUCKET: 'test-bucket',
    TENCENT_COS_REGION: 'test-region',
  })

  assert.ok(config)
  assert.deepEqual(config.releaseNotes, specialNotes)
  assert.equal(config.size, metadata.ANDROID_APK_SIZE)
  assert.equal(result.changedKeys.includes('ANDROID_RELEASE_NOTES'), true)
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

test('Beta.21 RC2 metadata is pinned to the verified candidate artifact', (t) => {
  const { appDir } = fixture(t)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_VERSION_NAME: '1.0.0-beta.20' },
  }), /INVALID_VERSION_NAME/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_APK_SHA256: 'ab'.repeat(32) },
  }), /INVALID_APK_SHA256/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_APK_SIZE: metadata.ANDROID_APK_SIZE + 1 },
  }), /INVALID_APK_SIZE/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_VERSION_CODE: 21 },
  }), /INVALID_VERSION_CODE/)
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
  assert.match(workflow, /timeout-minutes: 45/)
  assert.match(workflow, /--max-time 2400/)
  assert.match(workflow, /vars\.PRODUCTION_SSH_HOST_KEY_SHA256/)
  assert.ok(workflow.indexOf('Verify final APK stored in COS') < workflow.indexOf('Update only Android version variables'))
  assert.match(workflow, /node --input-type=module -/)
  assert.match(workflow, /Beta\.21 RC2 Android metadata without database access/i)
  assert.match(workflow, /1\.0\.0-beta\.21/)
  assert.match(workflow, /EXPECTED_SIZE: "180836567"/)
  assert.match(workflow, /463E70B7A3652498EE6286D56F9B306A3222D30905C73C22B59EA61F3113282B/)
  assert.match(workflow, /--argjson code 22/)
  assert.match(workflow, /--argjson minimum 19/)
  assert.match(workflow, /--argjson force false/)
  assert.match(workflow, /Beta\.21 RC2 内测版本/)
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
