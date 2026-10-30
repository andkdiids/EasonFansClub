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
  ANDROID_VERSION_CODE: 23,
  ANDROID_MINIMUM_VERSION_CODE: 19,
  ANDROID_FORCE_UPDATE: false,
  ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc3-20261030-211051.apk',
  ANDROID_APK_SHA256: '7ACE78E61C572FED43D1406765A54081C435E792138EA6DA4F70C1358773820D',
  ANDROID_APK_SIZE: 183510163,
  ANDROID_RELEASE_NOTES: JSON.stringify([
    '分享卡展示帖子原图、作者头像和正式品牌资源',
    '图片分享同时提供说明文字与规范公开链接',
    '二维码和分享文案使用同一公开网址',
    '每日处方分享与更新下载体验改进',
    'RC3 内测修复',
    'Beta.21 RC3 内测版本',
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
  assert.match(after, /ANDROID_VERSION_CODE='23'/)
  assert.match(after, /ANDROID_APK_SIZE='183510163'/)
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
    'Beta.21 RC3 内测版本',
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

test('Beta.21 metadata accepts only matching versioned RC3 or RC4 artifacts', (t) => {
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
    metadata: { ...metadata, ANDROID_APK_SIZE: 500_000_001 },
  }), /INVALID_APK_SIZE/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc2-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...metadata, ANDROID_VERSION_CODE: 22 },
  }), /INVALID_VERSION_CODE/)
})

test('Beta.21 RC4 metadata accepts versionCode 24 only with an RC4 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc4Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 24,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc4-'),
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '分享入口提供私信、图片和链接三种独立方式',
      '好友分享复用站内通讯录和私信',
      '图片分享仅在选择后生成带二维码卡片',
      '链接分享直接提供规范 HTTPS 网页地址',
      '每日处方分享导出改为按需生成',
      'Beta.21 RC4 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc4Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_CODE, '24')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc4Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc4Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc4Metadata, ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc4Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
})

test('Beta.21 RC5 metadata accepts versionCode 25 only with an RC5 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc5Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 25,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc5-'),
    ANDROID_APK_SHA256: 'AB'.repeat(32),
    ANDROID_APK_SIZE: 180_000_000,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复活跃症任务导航空路由',
      '新增反馈与更新并接入现有反馈 API',
      'App 启动时静默检查更新并复用现有更新器',
      '个人主页扫码入口新增我的二维码和扫一扫',
      '产品名称更新为番茄酱牛腩面不吃辣',
      'Beta.21 RC5 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc5Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_NAME, '1.0.0-beta.21')
  assert.equal(parsed.ANDROID_VERSION_CODE, '25')
  assert.equal(parsed.ANDROID_MINIMUM_VERSION_CODE, '19')
  assert.equal(parsed.ANDROID_FORCE_UPDATE, 'false')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc5Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc5Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc5Metadata, ANDROID_APK_COS_KEY: rc5Metadata.ANDROID_APK_COS_KEY.replace('rc5-', 'rc4-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc5Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
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
  assert.match(workflow, /Beta\.21 Android metadata without database access/i)
  assert.match(workflow, /release_candidate:/)
  assert.match(workflow, /inputs\.release_candidate/)
  assert.match(workflow, /1\.0\.0-beta\.21/)
  assert.match(workflow, /inputs\.apk_object_key/)
  assert.match(workflow, /inputs\.apk_sha256/)
  assert.match(workflow, /inputs\.apk_size/)
  assert.match(workflow, /release-beta21-\$\{RELEASE_CANDIDATE\}/)
  assert.match(workflow, /rc3\)/)
  assert.match(workflow, /rc4\)/)
  assert.match(workflow, /rc5\)/)
  assert.match(workflow, /version_code=25/)
  assert.match(workflow, /--argjson code "\$\{version_code\}"/)
  assert.match(workflow, /--argjson minimum 19/)
  assert.match(workflow, /--argjson force false/)
  assert.match(workflow, /Beta\.21 RC3 内测版本/)
  assert.match(workflow, /Beta\.21 RC4 内测版本/)
  assert.match(workflow, /Beta\.21 RC5 内测版本/)
  assert.ok(workflow.indexOf('Update only Android version variables') < workflow.indexOf('Reload only the web process'))
  assert.match(workflow, /pm2 reload easonfansclub --update-env/)
  assert.match(workflow, /PRODUCTION_SHA_MISMATCH/)
  assert.match(workflow, /PRODUCTION_ENV_LINK_MISMATCH/)
  assert.match(workflow, /PRODUCTION_METADATA_NOT_ACTIVE_AFTER_WEB_RELOAD/)
  assert.match(workflow, /String\(versionBody\.apkSha256\)\.toUpperCase\(\) === expectedHash\.toUpperCase\(\)/)
  assert.doesNotMatch(workflow, /pm2 reload all|pm2 restart all/i)
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
