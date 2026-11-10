import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { configureAndroidVersionEnv, restoreAndroidVersionEnv, type AndroidReleaseMetadata } from '../scripts/update-android-version-env.mjs'
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

function encodeEnvMetadata(metadata: Record<string, string | number | boolean>) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}='${String(value).replaceAll("'", '\\u0027')}'`)
    .join('\n')
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

test('Beta.21 RC6 metadata accepts versionCode 26 only with an RC6 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc6Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 26,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc6-'),
    ANDROID_APK_SHA256: 'CD'.repeat(32),
    ANDROID_APK_SIZE: 184_000_000,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复活跃症任务点击后的目标页面跳转',
      '启用 E院中心现有反馈与更新入口',
      '移除我的二维码头像上方重复的品牌标志',
      '启动时每个应用会话最多自动检查一次更新',
      '保留现有反馈接口与二维码扫描流程',
      'Beta.21 RC6 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc6Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_NAME, '1.0.0-beta.21')
  assert.equal(parsed.ANDROID_VERSION_CODE, '26')
  assert.equal(parsed.ANDROID_MINIMUM_VERSION_CODE, '19')
  assert.equal(parsed.ANDROID_FORCE_UPDATE, 'false')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc6Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc6Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc6Metadata, ANDROID_APK_COS_KEY: rc6Metadata.ANDROID_APK_COS_KEY.replace('rc6-', 'rc5-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc6Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
})

test('Beta.21 RC7 metadata accepts versionCode 27 only with an RC7 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc7Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 27,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc7-'),
    ANDROID_APK_SHA256: 'EF'.repeat(32),
    ANDROID_APK_SIZE: 184_500_000,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '支持意见反馈添加最多 9 张图片',
      '修复活跃症任务导航并补充真实点击回归检查',
      '补充活动中心核销二维码与管理员扫码入口',
      '优化广场滑动切换和每日处方分享',
      '统一普通页面提示并移除技术实现文案',
      'Beta.21 RC7 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc7Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_NAME, '1.0.0-beta.21')
  assert.equal(parsed.ANDROID_VERSION_CODE, '27')
  assert.equal(parsed.ANDROID_MINIMUM_VERSION_CODE, '19')
  assert.equal(parsed.ANDROID_FORCE_UPDATE, 'false')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc7Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc7Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc7Metadata, ANDROID_APK_COS_KEY: rc7Metadata.ANDROID_APK_COS_KEY.replace('rc7-', 'rc6-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc7Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
})

test('Beta.21 RC8 metadata accepts versionCode 28 only with an RC8 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc8Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 28,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc8-'),
    ANDROID_APK_SHA256: 'AB'.repeat(32),
    ANDROID_APK_SIZE: 185_000_000,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复帖子点赞、分享和回复任务的页面跳转',
      '补全活动核销状态、用户二维码及管理员扫码入口',
      '修正普通用户发帖分类权限与默认分类',
      '恢复广场好友、推荐、最新横向滑动切换',
      '接入与网站数据一致的原生 EasMusic 功能',
      'Beta.21 RC8 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc8Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_NAME, '1.0.0-beta.21')
  assert.equal(parsed.ANDROID_VERSION_CODE, '28')
  assert.equal(parsed.ANDROID_MINIMUM_VERSION_CODE, '19')
  assert.equal(parsed.ANDROID_FORCE_UPDATE, 'false')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc8Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc8Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc8Metadata, ANDROID_APK_COS_KEY: rc8Metadata.ANDROID_APK_COS_KEY.replace('rc8-', 'rc7-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc8Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
})

test('Beta.21 RC9 metadata accepts versionCode 29 only with an RC9 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc9Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 29,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc9-'),
    ANDROID_APK_SHA256: 'CD'.repeat(32),
    ANDROID_APK_SIZE: 186_000_000,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '统一多账号会话并修复反馈、账号安全和物料入口状态',
      '恢复授权用户公告发布权限并保持普通用户入口隐藏',
      '修复演唱会详情崩溃并完善 EasMusic 导航',
      '广场好友、推荐、最新支持跟手分页并保留各自状态',
      '活动报名后自动兑换绑定物料并复用现有发放记录',
      'Beta.21 RC9 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc9Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_NAME, '1.0.0-beta.21')
  assert.equal(parsed.ANDROID_VERSION_CODE, '29')
  assert.equal(parsed.ANDROID_MINIMUM_VERSION_CODE, '19')
  assert.equal(parsed.ANDROID_FORCE_UPDATE, 'false')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc9Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc9Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc9Metadata, ANDROID_APK_COS_KEY: rc9Metadata.ANDROID_APK_COS_KEY.replace('rc9-', 'rc8-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc9Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
})

test('Beta.21 RC10 metadata accepts versionCode 30 only with an RC10 object and matching notes', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc10Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 30,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc10-'),
    ANDROID_APK_SHA256: 'DE'.repeat(32),
    ANDROID_APK_SIZE: 187_000_000,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复反馈、多账号和账号安全的登录状态处理',
      '恢复授权用户公告发布权限并保持普通用户入口隐藏',
      '修复演唱会详情闪退并完善活跃症任务跳转',
      '活动报名后自动发放绑定物料并复用现有兑换记录',
      '完善设置退出登录及用户提示文案',
      'Beta.21 RC10 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc10Metadata })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.ANDROID_VERSION_CODE, '30')
  assert.equal(parsed.ANDROID_APK_COS_KEY, rc10Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), JSON.parse(rc10Metadata.ANDROID_RELEASE_NOTES))
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc10Metadata, ANDROID_APK_COS_KEY: rc10Metadata.ANDROID_APK_COS_KEY.replace('rc10-', 'rc9-') },
  }), /INVALID_APK_OBJECT_KEY/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc10Metadata, ANDROID_RELEASE_NOTES: metadata.ANDROID_RELEASE_NOTES },
  }), /INVALID_RELEASE_NOTES/)
})

test('Beta.21 RC11 metadata is pinned to the verified code31 APK digest and size', (t) => {
  const { appDir, envPath } = fixture(t)
  const rc11Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 31,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc11-').replace('.apk', '-run123456789-attempt2.apk'),
    ANDROID_APK_SHA256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    ANDROID_APK_SIZE: 183802143,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复「还有什么可以送给你」页面的 Bearer 登录认证',
      '修复反馈文字提交与图片上传的 Native Bearer 认证',
      '修复 E院广场好友 Feed 的登录状态识别和失败重试',
      '单接口认证失败不再未经确认清除全局登录状态',
      '多账号请求继续使用当前 active account 的有效 token',
      'Beta.21 RC11 内测版本',
    ]),
  }
  configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc11Metadata })
  assert.equal(dotenv.parse(readFileSync(envPath, 'utf8')).ANDROID_VERSION_CODE, '31')
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc11Metadata, ANDROID_APK_SHA256: 'A1'.repeat(32) },
  }), /INVALID_RC11_APK_SHA256/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc11Metadata, ANDROID_APK_SIZE: 183802144 },
  }), /INVALID_RC11_APK_SIZE/)
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: { ...rc11Metadata, ANDROID_APK_COS_KEY: rc11Metadata.ANDROID_APK_COS_KEY.replace(/-run\d+-attempt\d+(?=\.apk$)/, '') },
  }), /INVALID_APK_OBJECT_KEY/)
})

test('RC11 publish compares the captured code30 Version API baseline before changing the environment', (t) => {
  const code30Notes = [
    '修复反馈、多账号和账号安全的登录状态处理',
    '恢复授权用户公告发布权限并保持普通用户入口隐藏',
    '修复演唱会详情闪退并完善活跃症任务跳转',
    '活动报名后自动发放绑定物料并复用现有兑换记录',
    '完善设置退出登录及用户提示文案',
    'Beta.21 RC10 内测版本',
  ]
  const code30Metadata = {
    ANDROID_VERSION_NAME: '1.0.0-beta.21',
    ANDROID_VERSION_CODE: 30,
    ANDROID_MINIMUM_VERSION_CODE: 19,
    ANDROID_FORCE_UPDATE: false,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc10-20261101-152136.apk',
    ANDROID_APK_SHA256: 'D2CA0817E23431EFAB87E992BA544C4B213981E3E8651D67AF49324B440FC967',
    ANDROID_APK_SIZE: 184246197,
    ANDROID_RELEASE_NOTES: JSON.stringify(code30Notes),
    ANDROID_PUBLISHED_AT: '2026-11-01T15:21:36.000Z',
  }
  const env = `# retained settings\nDATABASE_URL=do-not-print-this\n${encodeEnvMetadata(code30Metadata)}\n`
  const { appDir, envPath, sharedDir } = fixture(t, env)
  const rc11Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 31,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc11-').replace('.apk', '-run123456789-attempt2.apk'),
    ANDROID_APK_SHA256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    ANDROID_APK_SIZE: 183802143,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复「还有什么可以送给你」页面的 Bearer 登录认证',
      '修复反馈文字提交与图片上传的 Native Bearer 认证',
      '修复 E院广场好友 Feed 的登录状态识别和失败重试',
      '单接口认证失败不再未经确认清除全局登录状态',
      '多账号请求继续使用当前 active account 的有效 token',
      'Beta.21 RC11 内测版本',
    ]),
  }
  const expectedCurrentMetadata = {
    ANDROID_VERSION_NAME: code30Metadata.ANDROID_VERSION_NAME,
    ANDROID_VERSION_CODE: code30Metadata.ANDROID_VERSION_CODE,
    ANDROID_MINIMUM_VERSION_CODE: code30Metadata.ANDROID_MINIMUM_VERSION_CODE,
    ANDROID_FORCE_UPDATE: code30Metadata.ANDROID_FORCE_UPDATE,
    ANDROID_APK_SHA256: code30Metadata.ANDROID_APK_SHA256,
    ANDROID_APK_SIZE: code30Metadata.ANDROID_APK_SIZE,
    ANDROID_RELEASE_NOTES: code30Notes,
    ANDROID_PUBLISHED_AT: code30Metadata.ANDROID_PUBLISHED_AT,
  }
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: rc11Metadata,
    expectedCurrentMetadata: { ...expectedCurrentMetadata, ANDROID_APK_SHA256: '0'.repeat(64) },
  }), /ANDROID_BASELINE_MISMATCH:ANDROID_APK_SHA256/)
  assert.equal(readFileSync(envPath, 'utf8'), env)
  assert.equal(existsSync(path.join(sharedDir, '.env-backups')), false)

  const result = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc11Metadata, expectedCurrentMetadata })
  assert.equal(dotenv.parse(readFileSync(envPath, 'utf8')).ANDROID_VERSION_CODE, '31')
  assert.equal(readFileSync(result.backupPath, 'utf8'), env)
})

test('Beta.21 RC12 metadata accepts only the fixed code32 artifact on the code31 baseline', (t) => {
  const code31Notes = [
    '修复「还有什么可以送给你」页面的 Bearer 登录认证',
    '修复反馈文字提交与图片上传的 Native Bearer 认证',
    '修复 E院广场好友 Feed 的登录状态识别和失败重试',
    '单接口认证失败不再未经确认清除全局登录状态',
    '多账号请求继续使用当前 active account 的有效 token',
    'Beta.21 RC11 内测版本',
  ]
  const code31Metadata = {
    ANDROID_VERSION_NAME: '1.0.0-beta.21',
    ANDROID_VERSION_CODE: 31,
    ANDROID_MINIMUM_VERSION_CODE: 19,
    ANDROID_FORCE_UPDATE: false,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk',
    ANDROID_APK_SHA256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    ANDROID_APK_SIZE: 183802143,
    ANDROID_RELEASE_NOTES: JSON.stringify(code31Notes),
    ANDROID_PUBLISHED_AT: '2026-11-02T20:57:22.000Z',
  }
  const expectedCurrentMetadata = {
    ANDROID_VERSION_NAME: code31Metadata.ANDROID_VERSION_NAME,
    ANDROID_VERSION_CODE: code31Metadata.ANDROID_VERSION_CODE,
    ANDROID_MINIMUM_VERSION_CODE: code31Metadata.ANDROID_MINIMUM_VERSION_CODE,
    ANDROID_FORCE_UPDATE: code31Metadata.ANDROID_FORCE_UPDATE,
    ANDROID_APK_SHA256: code31Metadata.ANDROID_APK_SHA256,
    ANDROID_APK_SIZE: code31Metadata.ANDROID_APK_SIZE,
    ANDROID_RELEASE_NOTES: code31Notes,
    ANDROID_PUBLISHED_AT: code31Metadata.ANDROID_PUBLISHED_AT,
  }
  const { appDir, envPath, sharedDir } = fixture(t, `# retained settings\nDATABASE_URL=do-not-print-this\n${encodeEnvMetadata(code31Metadata)}\n`)
  const rc12Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 32,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-203716-run123456789-attempt2.apk',
    ANDROID_APK_SHA256: '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271',
    ANDROID_APK_SIZE: 180263015,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复 E院广场下拉刷新后的列表位置与分页状态',
      '勋章展览馆改用天使的礼物同款互动卡片',
      '查看其他用户主页时显示其公开背景',
      '保持勋章授予、帖子互动与主页隐私规则',
      '修复刷新失败保留列表及主页切换时背景串用',
      'Beta.21 RC12 内测版本',
    ]),
  }
  const before = readFileSync(envPath, 'utf8')
  assert.throws(() => configureAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    metadata: rc12Metadata,
    expectedCurrentMetadata: { ...expectedCurrentMetadata, ANDROID_APK_SHA256: '0'.repeat(64) },
  }), /ANDROID_BASELINE_MISMATCH:ANDROID_APK_SHA256/)
  assert.equal(readFileSync(envPath, 'utf8'), before)
  assert.equal(existsSync(path.join(sharedDir, '.env-backups')), false)

  const result = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc12Metadata, expectedCurrentMetadata })
  const updated = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(updated.DATABASE_URL, 'do-not-print-this')
  assert.equal(updated.ANDROID_VERSION_CODE, '32')
  assert.equal(updated.ANDROID_APK_SHA256, rc12Metadata.ANDROID_APK_SHA256)
  assert.equal(updated.ANDROID_APK_SIZE, String(rc12Metadata.ANDROID_APK_SIZE))
  assert.equal(updated.ANDROID_APK_COS_KEY, rc12Metadata.ANDROID_APK_COS_KEY)
  assert.deepEqual(JSON.parse(updated.ANDROID_RELEASE_NOTES), JSON.parse(rc12Metadata.ANDROID_RELEASE_NOTES))
  assert.equal(readFileSync(result.backupPath, 'utf8'), before)
})

test('RC13 rollback checks the live code33 CAS baseline and restores only the verified code32 metadata', (t) => {
  const code32: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 32,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-185753-run41698377689-attempt1.apk',
    ANDROID_APK_SHA256: '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271',
    ANDROID_APK_SIZE: 180263015,
    ANDROID_RELEASE_NOTES: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'Beta.21 RC12 内测版本']),
    ANDROID_PUBLISHED_AT: '2026-11-03T19:04:22.000Z',
  }
  const pin = { sha256: 'A'.repeat(64), size: 181000000 }
  const code33: AndroidReleaseMetadata = {
    ...code32,
    ANDROID_VERSION_CODE: 33,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc13-20261104-120000-run123-attempt1.apk',
    ANDROID_APK_SHA256: pin.sha256,
    ANDROID_APK_SIZE: pin.size,
    ANDROID_RELEASE_NOTES: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'Beta.21 RC13 内测版本']),
    ANDROID_PUBLISHED_AT: '2026-11-04T04:00:00.000Z',
  }
  const { ANDROID_APK_COS_KEY: code32Key, ...expected32 } = code32
  const { ANDROID_APK_COS_KEY: code33Key, ...expected33 } = code33
  assert.match(code32Key, /rc12/)
  assert.match(code33Key, /rc13/)
  const { appDir, envPath } = fixture(t, `# retained settings\nDATABASE_URL=do-not-print-this\n${encodeEnvMetadata(code32)}\n`)
  const published = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: code33, expectedCurrentMetadata: expected32, rc13Pin: pin })
  const backupName = path.basename(published.backupPath)
  const before = readFileSync(envPath, 'utf8')
  assert.throws(() => restoreAndroidVersionEnv({ appDir, expectedProductionSha, backupName, targetVersionCode: 32,
    expectedCurrentMetadata: { ...expected33, ANDROID_APK_SHA256: 'B'.repeat(64) }, expectedCurrentObjectKey: code33Key, rc13Pin: pin }), /ANDROID_BASELINE_MISMATCH/)
  assert.throws(() => restoreAndroidVersionEnv({ appDir, expectedProductionSha, backupName, targetVersionCode: 32,
    expectedCurrentMetadata: expected33, expectedCurrentObjectKey: code33Key.replace('run123', 'run124'), rc13Pin: pin }), /ANDROID_BASELINE_MISMATCH:ANDROID_APK_COS_KEY/)
  assert.equal(readFileSync(envPath, 'utf8'), before)
  const result = restoreAndroidVersionEnv({ appDir, expectedProductionSha, backupName, targetVersionCode: 32,
    expectedCurrentMetadata: expected33, expectedCurrentObjectKey: code33Key, rc13Pin: pin })
  const restored = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(restored.DATABASE_URL, 'do-not-print-this')
  assert.equal(restored.ANDROID_VERSION_CODE, '32')
  assert.equal(restored.ANDROID_APK_COS_KEY, code32Key)
  assert.equal(restored.ANDROID_APK_SHA256, code32.ANDROID_APK_SHA256)
  assert.equal(restored.ANDROID_APK_SIZE, String(code32.ANDROID_APK_SIZE))
  assert.equal(result.changedKeys.length, 9)
})

test('RC12 rollback restores only Android metadata from the protected code31 baseline', (t) => {
  const code31Notes = [
    '修复「还有什么可以送给你」页面的 Bearer 登录认证',
    '修复反馈文字提交与图片上传的 Native Bearer 认证',
    '修复 E院广场好友 Feed 的登录状态识别和失败重试',
    '单接口认证失败不再未经确认清除全局登录状态',
    '多账号请求继续使用当前 active account 的有效 token',
    'Beta.21 RC11 内测版本',
  ]
  const code31Metadata = {
    ANDROID_VERSION_NAME: '1.0.0-beta.21',
    ANDROID_VERSION_CODE: 31,
    ANDROID_MINIMUM_VERSION_CODE: 19,
    ANDROID_FORCE_UPDATE: false,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc11-20261102-205722-run41523510243-attempt1.apk',
    ANDROID_APK_SHA256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    ANDROID_APK_SIZE: 183802143,
    ANDROID_RELEASE_NOTES: JSON.stringify(code31Notes),
    ANDROID_PUBLISHED_AT: '2026-11-02T20:57:22.000Z',
  }
  const env = `# retained settings\nDATABASE_URL=do-not-print-this\n${encodeEnvMetadata(code31Metadata)}\n`
  const { appDir, envPath } = fixture(t, env)
  const rc12Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 32,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc12-20261103-203716-run123456789-attempt2.apk',
    ANDROID_APK_SHA256: '50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271',
    ANDROID_APK_SIZE: 180263015,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复 E院广场下拉刷新后的列表位置与分页状态',
      '勋章展览馆改用天使的礼物同款互动卡片',
      '查看其他用户主页时显示其公开背景',
      '保持勋章授予、帖子互动与主页隐私规则',
      '修复刷新失败保留列表及主页切换时背景串用',
      'Beta.21 RC12 内测版本',
    ]),
  }
  const published = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc12Metadata })
  const backupName = path.basename(published.backupPath)
  const code32Env = readFileSync(envPath, 'utf8')
  writeFileSync(envPath, code32Env.replace(rc12Metadata.ANDROID_APK_SHA256, 'A'.repeat(64)), { mode: 0o640 })
  assert.throws(() => restoreAndroidVersionEnv({ appDir, expectedProductionSha, backupName, targetVersionCode: 31 }), /ROLLBACK_CURRENT_APK_SHA256_MISMATCH/)
  writeFileSync(envPath, code32Env, { mode: 0o640 })
  assert.throws(() => restoreAndroidVersionEnv(({
    appDir,
    expectedProductionSha,
    backupName,
    targetVersionCode: 31,
    code30BackupObjectKey: 'android/releases/ECFC-1.0.0-beta.21-code30-backup-20261102-205634-run41523510243-attempt1.apk',
  }) as unknown as Parameters<typeof restoreAndroidVersionEnv>[0]), /INVALID_ROLLBACK_TARGET/)
  assert.throws(() => restoreAndroidVersionEnv(({
    appDir,
    expectedProductionSha,
    backupName,
    targetVersionCode: 29,
  }) as unknown as Parameters<typeof restoreAndroidVersionEnv>[0]), /INVALID_ROLLBACK_TARGET/)
  const restored = restoreAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    backupName,
    targetVersionCode: 31,
    now: new Date('2026-11-03T21:00:00Z'),
  })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.DATABASE_URL, 'do-not-print-this')
  assert.equal(parsed.ANDROID_VERSION_CODE, '31')
  assert.equal(parsed.ANDROID_APK_COS_KEY, code31Metadata.ANDROID_APK_COS_KEY)
  assert.equal(parsed.ANDROID_APK_SHA256, code31Metadata.ANDROID_APK_SHA256)
  assert.equal(parsed.ANDROID_APK_SIZE, String(code31Metadata.ANDROID_APK_SIZE))
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), code31Notes)
  assert.equal(restored.changedKeys.length, 9)
})
test('RC11 rollback restores only Android metadata from the protected code30 baseline', (t) => {
  const code30Notes = [
    '修复反馈、多账号和账号安全的登录状态处理',
    '恢复授权用户公告发布权限并保持普通用户入口隐藏',
    '修复演唱会详情闪退并完善活跃症任务跳转',
    '活动报名后自动发放绑定物料并复用现有兑换记录',
    '完善设置退出登录及用户提示文案',
    'Beta.21 RC10 内测版本',
  ]
  const code30Metadata = {
    ANDROID_VERSION_NAME: '1.0.0-beta.21',
    ANDROID_VERSION_CODE: 30,
    ANDROID_MINIMUM_VERSION_CODE: 19,
    ANDROID_FORCE_UPDATE: false,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc10-20261101-152136.apk',
    ANDROID_APK_SHA256: 'D2CA0817E23431EFAB87E992BA544C4B213981E3E8651D67AF49324B440FC967',
    ANDROID_APK_SIZE: 184246197,
    ANDROID_RELEASE_NOTES: JSON.stringify(code30Notes),
    ANDROID_PUBLISHED_AT: '2026-11-01T15:21:36.000Z',
  }
  const env = `# retained settings\nDATABASE_URL=do-not-print-this\n${encodeEnvMetadata(code30Metadata)}\n`
  const { appDir, envPath } = fixture(t, env)
  const rc11Metadata: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 31,
    ANDROID_APK_COS_KEY: metadata.ANDROID_APK_COS_KEY.replace('rc3-', 'rc11-').replace('.apk', '-run123456789-attempt2.apk'),
    ANDROID_APK_SHA256: '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    ANDROID_APK_SIZE: 183802143,
    ANDROID_RELEASE_NOTES: JSON.stringify([
      '修复「还有什么可以送给你」页面的 Bearer 登录认证',
      '修复反馈文字提交与图片上传的 Native Bearer 认证',
      '修复 E院广场好友 Feed 的登录状态识别和失败重试',
      '单接口认证失败不再未经确认清除全局登录状态',
      '多账号请求继续使用当前 active account 的有效 token',
      'Beta.21 RC11 内测版本',
    ]),
  }
  const published = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: rc11Metadata })
  const backupName = path.basename(published.backupPath)
  const backupObjectKey = 'android/releases/ECFC-1.0.0-beta.21-code30-backup-20261102-090000-run123456789-attempt2.apk'
  const validRc11Env = readFileSync(envPath, 'utf8')
  writeFileSync(envPath, validRc11Env.replace(
    '9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C',
    'A'.repeat(64),
  ), { mode: 0o640 })
  assert.throws(() => restoreAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    backupName,
    targetVersionCode: 30,
    code30BackupObjectKey: backupObjectKey,
    now: new Date('2026-11-02T09:00:00Z'),
  }), /ROLLBACK_CURRENT_APK_SHA256_MISMATCH/)
  writeFileSync(envPath, validRc11Env, { mode: 0o640 })
  assert.throws(() => restoreAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    backupName,
    targetVersionCode: 30,
    code30BackupObjectKey: backupObjectKey.replace(/-run\d+-attempt\d+(?=\.apk$)/, ''),
    now: new Date('2026-11-02T09:00:00Z'),
  }), /INVALID_CODE30_BACKUP_OBJECT_KEY/)
  const restored = restoreAndroidVersionEnv({
    appDir,
    expectedProductionSha,
    backupName,
    targetVersionCode: 30,
    code30BackupObjectKey: backupObjectKey,
    now: new Date('2026-11-02T09:00:00Z'),
  })
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'))
  assert.equal(parsed.DATABASE_URL, 'do-not-print-this')
  assert.equal(parsed.ANDROID_VERSION_CODE, '30')
  assert.equal(parsed.ANDROID_APK_COS_KEY, backupObjectKey)
  assert.equal(parsed.ANDROID_APK_SHA256, code30Metadata.ANDROID_APK_SHA256)
  assert.equal(parsed.ANDROID_APK_SIZE, String(code30Metadata.ANDROID_APK_SIZE))
  assert.deepEqual(JSON.parse(parsed.ANDROID_RELEASE_NOTES), code30Notes)
  assert.equal(restored.changedKeys.length, 9)
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
  assert.match(workflow, /rc6\)/)
  assert.match(workflow, /rc7\)/)
  assert.match(workflow, /rc8\)/)
  assert.match(workflow, /rc9\)/)
  assert.match(workflow, /rc10\)/)
  assert.match(workflow, /rc11\)/)
  assert.match(workflow, /rc12\)/)
  assert.match(workflow, /version_code=25/)
  assert.match(workflow, /version_code=26/)
  assert.match(workflow, /version_code=27/)
  assert.match(workflow, /version_code=28/)
  assert.match(workflow, /version_code=29/)
  assert.match(workflow, /version_code=30/)
  assert.match(workflow, /version_code=31/)
  assert.match(workflow, /version_code=32/)
  assert.match(workflow, /--argjson code "\$\{version_code\}"/)
  assert.match(workflow, /--argjson minimum 19/)
  assert.match(workflow, /--argjson force false/)
  assert.match(workflow, /Beta\.21 RC3 内测版本/)
  assert.match(workflow, /Beta\.21 RC4 内测版本/)
  assert.match(workflow, /Beta\.21 RC5 内测版本/)
  assert.match(workflow, /Beta\.21 RC6 内测版本/)
  assert.match(workflow, /Beta\.21 RC7 内测版本/)
  assert.match(workflow, /Beta\.21 RC8 内测版本/)
  assert.match(workflow, /Beta\.21 RC9 内测版本/)
  assert.match(workflow, /Beta\.21 RC10 内测版本/)
  assert.match(workflow, /Beta\.21 RC11 内测版本/)
  assert.match(workflow, /Beta\.21 RC12 内测版本/)
  assert.match(workflow, /9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C/)
  assert.match(workflow, /12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B/)
  assert.match(workflow, /CODE30_ROLLBACK_SOURCE_VERIFIED=YES/)
  assert.match(workflow, /CODE31_ROLLBACK_SOURCE_VERIFIED=YES/)
  assert.doesNotMatch(workflow, /code(?:30|31)_backup_object_key|CODE(?:30|31)_BACKUP_OBJECT_KEY/)
  assert.match(workflow, /VERSION_API_BASELINE_CHANGED/)
  assert.match(workflow, /ANDROID_EXPECTED_CURRENT_B64/)
  assert.match(workflow, /\^\(23\|24\|25\|26\|27\|28\|29\|30\|31\|32\|33\)\$/)
  assert.ok(workflow.indexOf('Update only Android version variables') < workflow.indexOf('Reload only the web process'))
  assert.match(workflow, /pm2 reload easonfansclub --update-env/)
  assert.match(workflow, /PRODUCTION_SHA_MISMATCH/)
  assert.match(workflow, /PRODUCTION_ENV_LINK_MISMATCH/)
  assert.match(workflow, /PRODUCTION_METADATA_NOT_ACTIVE_AFTER_WEB_RELOAD/)
  assert.match(workflow, /String\(versionBody\.apkSha256\)\.toUpperCase\(\) === expectedHash\.toUpperCase\(\)/)
  assert.doesNotMatch(workflow, /pm2 reload all|pm2 restart all/i)
  assert.doesNotMatch(workflow, /prisma migrate|DATABASE_URL|notification:integrity|npm run seed/i)
  const rollbackWorkflow = readFileSync(path.resolve('.github/workflows/rollback-android-version.yml'), 'utf8')
  const rollbackCode31Workflow = readFileSync(path.resolve('.github/workflows/rollback-android-version-to-code31.yml'), 'utf8')
  assert.match(workflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/)
  assert.match(workflow, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/)
  assert.match(rollbackWorkflow, /workflow_dispatch:/)
  assert.match(rollbackWorkflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/)
  assert.match(rollbackWorkflow, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/)
  assert.match(rollbackWorkflow, /concurrency:/)
  assert.match(rollbackWorkflow, /cancel-in-progress: false/)
  assert.match(rollbackWorkflow, /ANDROID_RELEASE_OPERATION=rollback/)
  assert.match(rollbackWorkflow, /code30-backup/)
  assert.match(rollbackWorkflow, /D2CA0817E23431EFAB87E992BA544C4B213981E3E8651D67AF49324B440FC967/)
  assert.match(rollbackWorkflow, /VERSION_API_CODE30_RESTORED=VERIFIED/)
  assert.match(rollbackCode31Workflow, /environment: Production/)
  assert.match(rollbackCode31Workflow, /ANDROID_RELEASE_OPERATION=rollback-code31/)
  assert.match(rollbackCode31Workflow, /CODE31_ROLLBACK_OBJECT_KEY/)
  assert.doesNotMatch(rollbackCode31Workflow, /code31_backup_object_key|CODE31_BACKUP_OBJECT_KEY/)
  assert.match(rollbackCode31Workflow, /50726672C4137610122DDFFC8650D3073D72B0F9E89CD0738B7CFDF85CA13271/)
  assert.match(rollbackCode31Workflow, /VERSION_API_CODE31_RESTORED=VERIFIED/)
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

test('RC14 metadata update requires a pinned artifact and exact code33 CAS', (t) => {
  const code33: AndroidReleaseMetadata = {
    ...metadata,
    ANDROID_VERSION_CODE: 33,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc13-20261104-203019-run41906858324-attempt1.apk',
    ANDROID_APK_SHA256: '5D39F4CD071D2D4B78EA82DFEFEE7D2069A8E9D6425D223D0D3F11A1F50F7BF7',
    ANDROID_APK_SIZE: 183811739,
    ANDROID_RELEASE_NOTES: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'Beta.21 RC13 内测版本']),
    ANDROID_PUBLISHED_AT: '2026-11-04T20:42:23.000Z',
  }
  const pin = { sha256: 'A'.repeat(64), size: 181000000 }
  const code34: AndroidReleaseMetadata = {
    ...code33,
    ANDROID_VERSION_NAME: '1.0.0-beta.21',
    ANDROID_VERSION_CODE: 34,
    ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.21-release-beta21-rc14-20261110-120000-run123-attempt1.apk',
    ANDROID_APK_SHA256: pin.sha256,
    ANDROID_APK_SIZE: pin.size,
    ANDROID_RELEASE_NOTES: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'Beta.21 RC14 内测版本']),
    ANDROID_PUBLISHED_AT: '2026-11-10T12:00:00.000Z',
  }
  const { ANDROID_APK_COS_KEY: rollbackKey, ...expected33 } = code33
  assert.match(rollbackKey, /rc13/)
  const { appDir, envPath, sharedDir } = fixture(t, `DATABASE_URL=do-not-print-this\n${encodeEnvMetadata(code33)}\n`)
  const before = readFileSync(envPath, 'utf8')
  assert.throws(() => configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: code34, expectedCurrentMetadata: expected33 }), /RC14_ARTIFACT_PIN_NOT_READY/)
  assert.throws(() => configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: code34, rc14Pin: pin }), /RC14_CODE33_CAS_BASELINE_REQUIRED/)
  assert.throws(() => configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: code34, expectedCurrentMetadata: { ...expected33, ANDROID_APK_SHA256: 'B'.repeat(64) }, rc14Pin: pin }), /RC14_CODE33_CAS_BASELINE_REQUIRED/)
  assert.throws(() => configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: { ...code34, ANDROID_APK_SHA256: 'B'.repeat(64) }, expectedCurrentMetadata: expected33, rc14Pin: pin }), /INVALID_RC14_APK_SHA256/)
  assert.equal(readFileSync(envPath, 'utf8'), before)
  assert.equal(existsSync(path.join(sharedDir, '.env-backups')), false)
  const result = configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: code34, expectedCurrentMetadata: expected33, rc14Pin: pin })
  assert.equal(readFileSync(result.backupPath, 'utf8'), before)
  assert.equal(dotenv.parse(readFileSync(envPath)).ANDROID_VERSION_CODE, '34')
  assert.throws(() => configureAndroidVersionEnv({ appDir, expectedProductionSha, metadata: code34, expectedCurrentMetadata: expected33, rc14Pin: pin }), /RC14_CODE33_ROLLBACK_SOURCE_MISMATCH/)
})
