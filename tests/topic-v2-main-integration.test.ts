import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { before, test } from 'node:test'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { authCookieName } from '../lib/auth-cookie'

process.env.JWT_SECRET = 'topic-v2-main-integration-test-only-secret'
let middleware: typeof import('../middleware').middleware
before(async () => { ({ middleware } = await import('../middleware')) })
const source = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const baseSource = (path: string) => execFileSync('git', ['show', `80b62a5938aba4d2b50075ed0ed55da169c94f4d:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n')
const request = (path: string, method: string, extra: Record<string, string> = {}, bearer = true) => new NextRequest(`https://ecfc.fans${path}`, {
  method, headers: { ...(bearer ? { authorization: 'Bearer synthetic-test-token' } : {}), ...extra },
})

test('main integration retains Home/Growth, V2 and Cantonese Bearer route families', async () => {
  for (const [path, method] of [
    ['/api/home', 'GET'], ['/api/growth', 'GET'], ['/api/growth/actions/share', 'POST'],
    ['/api/activities/test/v2/tasks', 'POST'], ['/api/admin/activities/test/v2', 'PATCH'],
    ['/api/admin/activities/test/v2/lottery/draw', 'POST'],
    ['/api/learning/cantonese/course', 'GET'], ['/api/learning/cantonese/progress', 'GET'],
    ['/api/learning/cantonese/progress/lesson-05', 'POST'],
    ['/api/admin/cantonese/review/teaching/test', 'PATCH'],
  ]) {
    assert.equal((await middleware(request(path, method))).status, 200, `${method} ${path}`)
    assert.equal((await middleware(request(path, method, {}, false))).status, 401, `anonymous ${method} ${path}`)
  }
})

test('lottery winner address is owner-guarded and lottery views expose no unrelated PUT handlers', async () => {
  const path = '/api/activities/test/v2/lottery/winners/winner-test/address'
  assert.equal((await middleware(request(path, 'PUT'))).status, 200)
  assert.equal((await middleware(request(path, 'PUT', {}, false))).status, 401)
  const route = source('app/api/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route.ts')
  assert.match(route, /export async function PUT[\s\S]*?requireRequestUser\(request\)/)
  assert.match(route, /saveTopicLotteryAddress\(\{ activityId, winnerId, userId: guard\.user\.id/)
  const publicLotteryRoute = source('app/api/activities/[activityId]/v2/lottery/route.ts')
  assert.doesNotMatch(publicLotteryRoute, /export async function PUT/)
  const adminAddressRoute = source('app/api/admin/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route.ts')
  assert.match(adminAddressRoute, /export async function GET\(request: Request[\s\S]*?requireRequestAdmin\(request, 'activity_manage'\)/)
  assert.doesNotMatch(adminAddressRoute, /export async function PUT/)
})

test('global CSRF executes before merged Bearer bypass for V2, Cantonese and main writes', async () => {
  for (const [path, method] of [
    ['/api/growth/actions/share', 'POST'], ['/api/admin/activities/test/v2', 'PATCH'],
    ['/api/activities/test/v2/lottery/winners/winner-test/address', 'PUT'],
    ['/api/learning/cantonese/progress/lesson-05', 'POST'],
  ]) {
    const response = await middleware(request(path, method, { origin: 'https://hostile.invalid' }))
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'CSRF_BLOCKED')
  }
})

test('Web Cookie winner-address edit remains authenticated and cross-site Cookie writes remain blocked', async () => {
  const cookie = await new SignJWT({ id: 'synthetic-owner', role: 'USER' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET))
  const path = '/api/activities/test/v2/lottery/winners/winner-test/address'
  const headers = { cookie: `${authCookieName}=${cookie}`, origin: 'https://ecfc.fans' }
  assert.equal((await middleware(request(path, 'PUT', headers, false))).status, 200)
  const rejected = await middleware(request(path, 'PUT', { ...headers, origin: 'https://hostile.invalid' }, false))
  assert.equal(rejected.status, 403)
  assert.equal((await rejected.json()).code, 'CSRF_BLOCKED')
})

test('deployment retains main release boundary and candidate exact-SHA safety', () => {
  const workflow = source('.github/workflows/deploy.yml')
  assert.match(workflow, /paths-ignore:\s+- '\.github\/\*\*'/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /!contains\(github\.event\.head_commit\.message, '\[infra-only\]'\)/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /refusing to copy or create production configuration/)
  assert.match(workflow, /JSON\.parse\(raw\)\.release === process\.argv\[1\]/)
  assert.match(workflow, /Guarded rollback after deploy or public-health failure/)
  assert.doesNotMatch(workflow, /curl --insecure|mkdir -p.*releases|cp -p.*shared\/\.env/)
})

test('main production diagnostic workflows and scripts remain unchanged', () => {
  const reviewedDiagnostics = new Map([
    ['.github/workflows/production-migration-ledger-diagnostic-v2.yml', '9c39e9ac6897953b57fe47a53ce5217d3667a6c7875db5a33f12633cecff3de0'],
    ['.github/workflows/production-strict-readonly-preflight.yml', 'a938a5d06e883f2fdb9bb39ac246e98b735a6b8dd588ec57798131f5d21da16a'],
    ['.github/release/production-migration-ledger-diagnostic-v2.mjs', '724cacff167f60b77b493b32a40a8bb58ea3d7d208794d3dea4d0f88199700a2'],
    ['.github/release/strict-readonly-preflight.mjs', '584a1e017566bcae62d0419f11e4cf8e255c6676f3c0f7907724dfd0eeda91ef'],
    ['.github/release/test-production-migration-ledger-diagnostic-v2.mjs', '0c14dcfe21c784f6cb0d21615e316b3859d0bcd3ec13fc2fe3d5e1006c0ec45e'],
    ['.github/release/test-strict-readonly-preflight.mjs', '989ae7b601e0d67cc075c5053445a899aabef72be97bc5ac83926f2780cb6fc6'],
  ])
  for (const [path, digest] of reviewedDiagnostics) {
    assert.equal(createHash('sha256').update(source(path)).digest('hex'), digest, `reviewed RC14 diagnostic: ${path}`)
  }
  const intentionallyReviewedReleaseControlPaths = new Set([
    ...reviewedDiagnostics.keys(),
    '.github/workflows/deploy.yml',
    '.github/workflows/android-release-infra-ci.yml',
    '.github/workflows/production-server-rc-v3.yml', // remove the manual backup attestation gate; deployment and migration guards remain covered by deploy-policy tests
    '.github/workflows/recording-sessions-v2-mysql.yml', // expanded for the RC14 isolated Worker fencing integration suite
    '.github/workflows/unified-ci.yml', // exact Node heap override for the RC14 Next.js build OOM
    '.github/workflows/publish-android-rc11.yml', // separately guarded below and by Android release tests
    '.github/workflows/configure-android-version.yml', // separately guarded below and by Android release tests
  ])
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', '80b62a5938aba4d2b50075ed0ed55da169c94f4d', '.github'], { encoding: 'utf8' })
    .trim().split('\n').filter(path => !intentionallyReviewedReleaseControlPaths.has(path))
  assert.equal(paths.length, 25, 'all other diagnostic/release-policy files retain their original protection')
  for (const path of paths) assert.equal(source(path), baseSource(path), path)
  const mainUnifiedCi = baseSource('.github/workflows/unified-ci.yml')
  const expectedUnifiedCi = mainUnifiedCi.replace(
    '      - name: Next.js production build\n        shell: bash\n        run: |\n',
    '      - name: Next.js production build\n        shell: bash\n        env:\n          NODE_OPTIONS: --max-old-space-size=4096\n        run: |\n',
  )
  assert.notEqual(expectedUnifiedCi, mainUnifiedCi, 'the main build step must match the reviewed insertion point')
  assert.equal(source('.github/workflows/unified-ci.yml'), expectedUnifiedCi, 'only the reviewed build heap override may change unified release CI')
  const nextConfig = source('next.config.ts')
  const experimentalConfig = nextConfig.match(/experimental:\s*\{([\s\S]*?)\n\s*\},/)
  assert.ok(experimentalConfig, 'Next.js experimental build configuration exists')
  assert.match(experimentalConfig[1], /\bcpus:\s*2\b/)
  assert.match(experimentalConfig[1], /\bwebpackMemoryOptimizations:\s*true\b/)
  assert.match(nextConfig, /eslint:\s*\{[\s\S]*?ignoreDuringBuilds:\s*true/)
  assert.match(nextConfig, /typescript:\s*\{[\s\S]*?ignoreBuildErrors:\s*true/)
  const unifiedCi = source('.github/workflows/unified-ci.yml')
  assert.match(unifiedCi, /^  typecheck:\s*$/m, 'type checking remains an independent CI gate')
  assert.match(unifiedCi, /^  eslint:\s*$/m, 'ESLint remains an independent CI gate')
  const workerMysql = source('.github/workflows/recording-sessions-v2-mysql.yml')
  assert.match(workerMysql, /CREATE DATABASE ecfc_rc14_worker_qa/)
  assert.match(workerMysql, /tests\/instagram-worker-process\.mysql\.integration\.ts/)
  assert.match(workerMysql, /tests\/instagram-lease-generation-migration\.mysql\.integration\.ts/)
  const reviewedStaging = source('.github/workflows/publish-android-rc11.yml')
  assert.equal(createHash('sha256').update(reviewedStaging.replace(/\r\n/g, '\n')).digest('hex'), 'dbdbc92eff05d55fa24361868ea87001e8bad55b88068ca67e6484ac7a9723c0', 'reviewed Android staging workflow must not change without updating this guard')
  const reviewedMetadata = source('.github/workflows/configure-android-version.yml')
  assert.equal(createHash('sha256').update(reviewedMetadata).digest('hex'), '66f0990f6636584e01ec086521284a6ce224487df5efa5d7d77164dd82488a7e', 'reviewed Android metadata workflow must not change without updating this guard')
})

test('reviewed RC14 diagnostics retain exact main identity and read-only production checks', () => {
  for (const path of ['.github/workflows/production-migration-ledger-diagnostic-v2.yml', '.github/workflows/production-strict-readonly-preflight.yml']) {
    const body = source(path)
    assert.match(body, /workflow_dispatch:/)
    assert.match(body, /contents: read/)
    assert.match(body, /refs\/heads\/main/)
    assert.match(body, /git\/ref\/heads\/main/)
    assert.match(body, /candidate_sha:/)
    assert.match(body, /expected_production_sha:/)
    assert.doesNotMatch(body, /prisma migrate deploy|pm2 restart|pm2 reload|actions: write|contents: write/)
  }
  const ledger = source('.github/release/production-migration-ledger-diagnostic-v2.mjs')
  assert.match(ledger, /PRODUCTION_RELEASE_SHA_MISMATCH/)
  assert.match(ledger, /checksum/)
  assert.match(ledger, /\.deployed-sha/)
})

test('Beta23 release control is independently fail-closed and keeps the prior candidate guards', async () => {
  const pin = JSON.parse(source('scripts/android-beta23-release.json')) as {
    applicationId: string
    versionName: string
    versionCode: number
    sha256: string | null
    size: number | null
    signerSha256: string
    sourceFile: string
    sourcePath: string
    mobileCommit: string | null
    releaseNotes: string[]
  }
  assert.equal(pin.applicationId, 'fans.ecfc.app')
  assert.equal(pin.versionName, '1.0.0-beta.23')
  assert.equal(pin.versionCode, 36)
  assert.equal(pin.sourceFile, 'ECFC-1.0.0-beta.23-release-code36.apk')
  assert.equal(pin.sourcePath, 'E:\\Eason\\build-cache\\ECFC-Release-Artifacts\\Beta23\\ECFC-1.0.0-beta.23-release-code36.apk')
  assert.equal(pin.signerSha256, '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B')
  assert.equal(pin.releaseNotes.at(-1), 'Beta.23 正式版本')
  const beta23Release = await import('../scripts/android-beta23-release.mjs' as string) as unknown as {
    validateBeta23Pin: (value: Record<string, unknown>) => unknown
  }
  const readyPin = {
    ...pin,
    sha256: pin.sha256 ?? 'A'.repeat(64),
    size: pin.size ?? 10000000,
    mobileCommit: pin.mobileCommit ?? 'a'.repeat(40),
  }
  if (pin.sha256 === null || pin.size === null || pin.mobileCommit === null) {
    assert.throws(() => beta23Release.validateBeta23Pin(pin), /BETA23_ARTIFACT_PIN_NOT_READY/)
  } else {
    assert.doesNotThrow(() => beta23Release.validateBeta23Pin(pin))
  }
  assert.doesNotThrow(() => beta23Release.validateBeta23Pin(readyPin))
  for (const field of ['sha256', 'size', 'mobileCommit'] as const) {
    assert.throws(() => beta23Release.validateBeta23Pin({ ...readyPin, [field]: null }), /BETA23_ARTIFACT_PIN_NOT_READY/)
  }
  const pinScript = source('scripts/android-beta23-release.mjs')
  assert.match(pinScript, /BETA23_ARTIFACT_PIN_NOT_READY/)
  assert.match(pinScript, /mobileCommit/)
  const staging = source('.github/workflows/publish-android-rc11.yml')
  assert.match(staging, /- beta23/)
  assert.match(staging, /android-beta23-release\.mjs.*validate/)
  assert.match(staging, /expectedCode = '36'/)
  assert.match(staging, /expectedVersionName = '1\.0\.0-beta\.23'/)
  assert.match(staging, /publish-beta23/)
  assert.match(staging, /apksigner verify --verbose --print-certs/)
  const metadata = source('.github/workflows/configure-android-version.yml')
  assert.match(metadata, /- beta23/)
  assert.match(metadata, /BETA23_ARTIFACT_PIN_NOT_READY|android-beta23-release\.mjs/)
  assert.match(metadata, /BETA23.*code35|code35.*BETA23/i)
  assert.match(metadata, /ANDROID_BETA23_ARTIFACT_PIN_B64/)
  assert.match(metadata, /expected_version_code=36/)
  assert.match(metadata, /- beta24/)
  assert.match(metadata, /ANDROID_BETA24_ARTIFACT_PIN_B64/)
  assert.match(metadata, /expected_version_code=37/)
  assert.match(metadata, /LIVE_BETA24_DOWNLOAD=VERIFIED/)
  assert.match(metadata, /- beta26/)
  assert.match(metadata, /ANDROID_BETA26_ARTIFACT_PIN_B64/)
  assert.match(metadata, /expected_version_code=39/)
  assert.match(metadata, /LIVE_BETA26_DOWNLOAD=VERIFIED/)
  assert.match(metadata, /CODE37_ROLLBACK_SOURCE_VERIFIED=YES/)
  assert.match(metadata, /PRODUCTION_VERSION_API_NOT_EXPECTED_CODE36/)
  assert.match(metadata, /verify_only:/)
  assert.match(metadata, /if: inputs\.verify_only != true/)
  const beta23BaselineStart = metadata.indexOf('id: beta23-baseline')
  const beta23BaselineEnd = metadata.indexOf('- name: Preserve Beta22', beta23BaselineStart)
  const beta23Baseline = metadata.slice(beta23BaselineStart, beta23BaselineEnd)
  assert.match(beta23Baseline, /PRODUCTION_VERSION_API_CODE35_MISMATCH_FIELDS/)
  assert.match(beta23Baseline, /versionCode != 35/)
  assert.match(beta23Baseline, /apkSha256/)
  assert.match(beta23Baseline, /releaseNotes \| type == "array"/)
  assert.match(beta23Baseline, /publishedAt \| type == "string"/)
  assert.doesNotMatch(beta23Baseline, /\.releaseNotes == \$pin\[0\]\.releaseNotes/)
  assert.doesNotMatch(beta23Baseline, /\.publishedAt == "2026-11-13T23:18:16Z"/)
  const rollback = source('.github/workflows/rollback-android-version-to-code33.yml')
  assert.match(rollback, /- '35'/)
  assert.match(rollback, /expected_beta23_object_key/)
  assert.match(rollback, /rollback-code35/)
  assert.match(rollback, /BETA23_ROLLBACK_OBJECT_KEY_INVALID/)
  assert.match(rollback, /CODE35_ORIGINAL_ROLLBACK_SOURCE_VERIFIED=YES/)
  assert.match(rollback, /VERSION_API_CODE35_RESTORED=VERIFIED/)
  assert.doesNotMatch(rollback, /DATABASE_URL|prisma migrate|migration deploy/i)
})

test('Ecenter conflict retains GET/PATCH request-auth plus generic identity regression guard', () => {
  const tests = source('tests/ecenter-features.test.ts')
  assert.ok(tests.includes('assert.match(route, /requireRequestUser\\(request\\)/)'))
  assert.ok(tests.includes('export async function GET\\(request: Request\\)[\\s\\S]*?requireRequestUser'))
  assert.ok(tests.includes('export async function PATCH\\(request: Request\\)[\\s\\S]*?requireRequestUser'))
  assert.ok(tests.includes('assert.doesNotMatch(route, /requireUser\\(/)'))
})
