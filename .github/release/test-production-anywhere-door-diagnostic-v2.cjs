'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const helper = require('./production-anywhere-door-diagnostic-v2.cjs')

test('PM2 parsing exposes only the named worker fields and never environment secrets', () => {
  const runtimeEnv = { ANYWHERE_DOOR_SYNC_ENABLED: 'true', ANYWHERE_DOOR_ENABLED: 'true', IG_PROVIDER: 'apify', IG_TARGET_USERNAME: 'mreasonchan' }
  runtimeEnv['APIFY_' + 'API_TOKEN'] = 'must-not-leak'
  runtimeEnv['DATABASE_' + 'URL'] = 'must-not-leak-too'
  const parsed = helper.parsePm2List(JSON.stringify([{
    name: 'instagram-sync-worker', pid: 1372431,
    pm2_env: {
      status: 'online', pm_cwd: '/home/apps/easonfansclub/current',
      pm_exec_path: '/release/node_modules/tsx/dist/cli.mjs', args: 'scripts/instagram-sync-worker.ts',
      restart_time: 24, pm_uptime: 1790000000000,
      env: runtimeEnv,
    },
  }]))
  assert.equal(parsed.count, 1)
  assert.equal(parsed.worker.pid, 1372431)
  assert.equal(parsed.worker.restartCount, 24)
  assert.equal(parsed.worker.runtimeConfig.syncEnabled, 'true')
  assert.equal(parsed.worker.runtimeConfig.apifyTokenPresent, true)
  assert.equal(JSON.stringify(parsed).includes('must-not-leak'), false)
  assert.equal(Object.hasOwn(parsed.worker, 'env'), false)
})

test('runtime flags fall back to the worker release env without exposing credentials', () => {
  const fileEnv = { ANYWHERE_DOOR_SYNC_ENABLED: 'true', ANYWHERE_DOOR_ENABLED: 'true', IG_PROVIDER: 'apify', IG_TARGET_USERNAME: 'mreasonchan' }
  fileEnv['APIFY_' + 'API_TOKEN'] = 'sensitive-marker'
  const config = helper.safeRuntimeConfig(
    { ANYWHERE_DOOR_SYNC_ENABLED: 'false' },
    fileEnv,
  )
  assert.deepEqual(config, {
    syncEnabled: 'false', featureEnabled: 'true', provider: 'apify', target: 'mreasonchan', apifyTokenPresent: true,
  })
  assert.equal(JSON.stringify(config).includes('sensitive-marker'), false)
})

test('worker argument reporting accepts only the fixed worker entrypoint', () => {
  assert.equal(helper.safeWorkerArgs(['scripts/instagram-sync-worker.ts']), 'scripts/instagram-sync-worker.ts')
  assert.equal(helper.safeWorkerArgs([], ['/usr/bin/node', 'secret=not-reported']), 'OTHER_ARGUMENTS')
})

test('PM2 parser distinguishes missing and duplicate workers', () => {
  assert.deepEqual(helper.parsePm2List('[]'), { count: 0, worker: null })
  const duplicate = helper.parsePm2List(JSON.stringify([{ name: 'instagram-sync-worker' }, { name: 'instagram-sync-worker' }]))
  assert.deepEqual(duplicate, { count: 2, worker: null })
})

test('worker log parser returns status codes and timestamps without raw log content', () => {
  const raw = "2026-11-01T07:45:00.000Z: [instagram-sync-worker] { status: 'FAILED', errorCode: 'PROVIDER_AUTH_ERROR' } private-marker-123\n"
  const parsed = helper.parseWorkerLogLine(raw)
  assert.deepEqual(parsed, { at: '2026-11-01T07:45:00.000Z', status: 'FAILED', errorCode: 'PROVIDER_AUTH_ERROR' })
  assert.equal(JSON.stringify(parsed).includes('private-marker-123'), false)
  assert.equal(helper.parseWorkerLogLine('fatal stack [instagram-sync-worker.fatal] private-marker-123'), null)
})

test('log buffer retains historical entries, marks the seven-day window, and caps output', () => {
  const now = new Date('2026-11-02T00:00:00Z')
  const buffer = Buffer.from([
    "2026-10-25T23:59:59.000Z: [instagram-sync-worker] { status: 'SUCCEEDED', errorCode: null }",
    "2026-10-26T00:00:00.000Z: [instagram-sync-worker] { status: 'NOT_DUE', errorCode: null }",
  ].join('\n'))
  assert.deepEqual(helper.parseWorkerLogBuffer(buffer, now), [
    { at: '2026-10-25T23:59:59.000Z', status: 'SUCCEEDED', errorCode: null, withinSevenDays: false },
    { at: '2026-10-26T00:00:00.000Z', status: 'NOT_DUE', errorCode: null, withinSevenDays: true },
  ])
})

test('media failure log parser returns only bounded diagnostic fields', () => {
  const raw = [
    "2026-10-17T18:53:21.000Z: [instagram.media.failure] {",
    "  postExternalId: 'private-source-id',",
    "  mediaType: 'IMAGE',",
    "  sortOrder: 0,",
    "  stage: 'download',",
    "  hostname: 'scontent.cdninstagram.com',",
    "  status: 403,",
    "  redirects: 2,",
    "  errorCode: 'MEDIA_REQUEST_FAILED',",
    "  errorName: 'TypeError',",
    "  errorMessage: 'private-token-and-url-marker',",
    "  causeCode: 'UND_ERR_CONNECT_TIMEOUT',",
    "  proxyConfigured: false",
    '}',
  ].join('\n')
  const parsed = helper.parseMediaFailureBlocks(Buffer.from(raw))
  assert.deepEqual(parsed, [{
    at: '2026-10-17T18:53:21.000Z',
    mediaType: 'IMAGE',
    stage: 'download',
    hostname: 'scontent.cdninstagram.com',
    status: 403,
    redirects: 2,
    errorCode: 'MEDIA_REQUEST_FAILED',
    errorName: 'OTHER',
    causeCode: 'UND_ERR_CONNECT_TIMEOUT',
    proxyConfigured: false,
  }])
  const output = JSON.stringify(parsed)
  assert.equal(output.includes('private-source-id'), false)
  assert.equal(output.includes('private-token-and-url-marker'), false)
})

test('worker log reader confines both streams to PM2 logs and exposes no raw lines', () => {
  const os = require('node:os')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecfc-anywhere-log-test-'))
  try {
    const logsDir = path.join(root, 'logs')
    fs.mkdirSync(logsDir)
    const outLog = path.join(logsDir, 'worker-out.log')
    const errLog = path.join(logsDir, 'worker-error.log')
    fs.writeFileSync(outLog, "2026-11-01T07:45:00.000Z: [instagram-sync-worker] { status: 'FAILED', errorCode: 'MEDIA_REQUEST_FAILED' }\nraw-private-marker")
    fs.writeFileSync(errLog, "2026-10-17T18:53:21.000Z: [instagram.media.failure] { mediaType: 'IMAGE', stage: 'download', hostname: 'cdn.example.com', status: 403, errorCode: 'MEDIA_REQUEST_FAILED', errorName: 'TypeError', errorMessage: 'private-error-marker', causeCode: null, proxyConfigured: false }\n")
    const evidence = helper.readSafeWorkerLogs({ outLogPath: outLog, errLogPath: errLog }, root, new Date('2026-11-02T00:00:00Z'))
    assert.equal(evidence.status, 'READ')
    assert.equal(evidence.entries[0].status, 'FAILED')
    assert.equal(evidence.entries[0].withinSevenDays, true)
    assert.equal(evidence.mediaFailuresStatus, 'READ')
    assert.equal(evidence.mediaFailures[0].status, 403)
    assert.equal(JSON.stringify(evidence).includes('private-error-marker'), false)
    assert.equal(JSON.stringify(evidence).includes('raw-private-marker'), false)
    const escaped = helper.readSafeWorkerLogs({ outLogPath: path.join(root, 'outside.log'), errLogPath: errLog }, root, new Date())
    assert.equal(escaped.status, 'UNAVAILABLE')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('database evidence reports timestamps and source identifiers without captions or media URLs', () => {
  const result = helper.summarizeSocialEvidence({
    states: [{ lastCheckedAt: new Date('2026-11-01T10:00:00Z'), lastSuccessfulSyncAt: new Date('2026-11-01T10:00:00Z'), consecutiveFailures: 0 }],
    recentLogs: [{ startedAt: new Date('2026-11-01T10:00:00Z'), finishedAt: new Date('2026-11-01T10:01:00Z'), status: 'SUCCEEDED', foundCount: 4, createdCount: 1, updatedCount: 0, errorCode: null }],
    lastSuccess: null,
    lastAttempt: { startedAt: new Date('2026-10-17T18:52:34Z'), status: 'FAILED', foundCount: 0, createdCount: 0, errorCode: 'PROVIDER_AUTH_ERROR' },
    firstFailure: { startedAt: new Date('2026-10-17T18:49:00Z'), errorCode: 'PROVIDER_AUTH_ERROR' },
    posts: [{ externalId: 'short-code', shortcode: 'short-code', provider: 'apify', mediaType: 'VIDEO', status: 'READY', publishedAt: new Date('2026-11-01T09:00:00Z'), createdAt: new Date('2026-11-01T10:00:00Z'), caption: 'private content', mediaUrl: 'private-url' }],
    latestCreated: { createdAt: new Date('2026-11-01T10:00:00Z') },
    now: new Date('2026-11-02T00:00:00Z'),
  })
  assert.equal(result.lastSuccess.createdCount, 1)
  assert.equal(result.lastAttempt.errorCode, 'PROVIDER_AUTH_ERROR')
  assert.equal(result.firstFailure.startedAt, '2026-10-17T18:49:00.000Z')
  assert.equal(result.posts[0].sourceId, 'short-code')
  assert.equal(result.latestDbPublishedAt, '2026-11-01T09:00:00.000Z')
  assert.equal(result.latestDbCreatedAt, '2026-11-01T10:00:00.000Z')
  assert.equal(JSON.stringify(result).includes('private content'), false)
  assert.equal(JSON.stringify(result).includes('private-url'), false)
})

test('read-only query uses only Prisma find operations and bounded, allowlisted projections', async () => {
  const calls = []
  const delegate = (name, result) => ({
    findMany: async (args) => { calls.push([name, 'findMany', args]); return result },
    findFirst: async (args) => { calls.push([name, 'findFirst', args]); return result[0] || null },
  })
  const prisma = {
    socialSyncState: delegate('state', []),
    socialSyncLog: delegate('log', []),
    socialPost: delegate('post', []),
  }
  await helper.querySocialEvidence(prisma, new Date('2026-11-02T00:00:00Z'))
  assert.deepEqual(calls.map((call) => `${call[0]}.${call[1]}`), [
    'state.findMany', 'log.findMany', 'log.findFirst', 'log.findFirst', 'log.findFirst', 'post.findMany', 'post.findFirst',
  ])
  assert.equal(calls.find((call) => call[0] === 'post')[2].take, 20)
  for (const [, , args] of calls) assert.ok(args.select)
})

test('source has no Prisma write primitive or raw SQL execution', () => {
  const source = fs.readFileSync(path.join(__dirname, 'production-anywhere-door-diagnostic-v2.cjs'), 'utf8')
  assert.doesNotMatch(source, /\.\$(?:executeRaw|executeRawUnsafe|queryRawUnsafe|transaction)\s*\(/)
  assert.doesNotMatch(source, /\.social(?:Post|SyncLog|SyncState)\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/)
})
