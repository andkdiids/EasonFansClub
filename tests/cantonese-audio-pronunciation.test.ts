import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Module from 'node:module'
import { before, test } from 'node:test'
import {
  CANTONESE_JYUTPING_REVIEW_ACTION,
  CANTONESE_JYUTPING_REVOKE_ACTION,
  cantoneseJyutpingReviewDigest,
  jyutpingVerificationReason,
} from '../lib/cantonese-jyutping-review'
import { decorateAudioPronunciation, resolveAudioPronunciation, type PronunciationAsset } from '../lib/cantonese-audio-pronunciation'
import {
  isCantoneseQuestionType,
  nextCantoneseAudioVersion,
  nextCantoneseReviewStatus,
  parseCantoneseReviewAction,
  parseCantoneseReviewEntityType,
  safeReviewIdentifier,
  safeReviewReason,
} from '../lib/cantonese-review'

type ResolverReader = Parameters<typeof resolveAudioPronunciation>[0]

const TEXT = '早晨'
const JYUTPING = 'zou2 san4'
const EDITED_TEXT = '早唞'
const EDITED_JYUTPING = 'zou2 tau2'
const LESSON_ID = 'lesson-05'
const CONTENT_ID = 'content-early-greeting'
const AUDIO_ID = 'audio-early-greeting'

type ReviewLog = {
  id?: string
  targetType: string
  targetId: string
  action: string
  reason: string | null
  createdAt: Date | string
}

type ContentRecord = {
  externalId: string
  lessonId: string
  audioId: string | null
  displayText: string | null
  jyutping: string | null
  requiresAudio: boolean
  requiresSpeaking: boolean
  status: string
}

type AssetRecord = PronunciationAsset & {
  audioVersion: string
  voiceProfile: string
  speed: number | null
  sampleRate: number
  codec: string
  audioKey: string | null
  cosKey: string | null
  checksum: string | null
  fileSize: number | null
  assetStatus: string
  status: string
  updatedAt: Date
  reviewedById: string | null
  reviewedAt: Date | null
  reviewNote: string | null
}

const digest = (text = TEXT, jyutping = JYUTPING) => cantoneseJyutpingReviewDigest(text, jyutping)!

function content(overrides: Partial<ContentRecord> = {}): ContentRecord {
  return {
    externalId: CONTENT_ID,
    lessonId: LESSON_ID,
    audioId: AUDIO_ID,
    displayText: TEXT,
    jyutping: JYUTPING,
    requiresAudio: true,
    requiresSpeaking: false,
    status: 'CONTENT_REVIEW_REQUIRED',
    ...overrides,
  }
}

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    externalId: AUDIO_ID,
    text: TEXT,
    jyutping: JYUTPING,
    contentId: CONTENT_ID,
    lessonId: LESSON_ID,
    audioVersion: 'v1',
    voiceProfile: '101019',
    speed: null,
    sampleRate: 16000,
    codec: 'mp3',
    audioKey: null,
    cosKey: null,
    checksum: null,
    fileSize: null,
    assetStatus: 'NOT_GENERATED',
    status: 'CONTENT_REVIEW_REQUIRED',
    updatedAt: new Date('2026-10-05T09:00:00.000Z'),
    reviewedById: null,
    reviewedAt: null,
    reviewNote: null,
    ...overrides,
  }
}

function matchingLog(
  targetType: 'TEACHING' | 'AUDIO',
  targetId: string,
  action: string = CANTONESE_JYUTPING_REVIEW_ACTION,
  reason: string | null = digest(),
  createdAt = '2026-10-05T09:01:00.000Z',
): ReviewLog {
  return { id: `${targetType}-${action}`, targetType, targetId, action, reason, createdAt }
}

function makeReader(options: {
  source?: ContentRecord | null
  logs?: ReviewLog[]
} = {}) {
  const calls = { content: [] as unknown[], logs: [] as unknown[] }
  let writes = 0
  const source = options.source === undefined ? content() : options.source
  const logs = options.logs || []
  const whereMatches = (where: Record<string, unknown>, row: ReviewLog) => {
    const targetType = where.targetType
    const targetId = where.targetId
    const action = where.action as { in?: string[] } | undefined
    return row.targetType === targetType && row.targetId === targetId
      && (!action?.in || action.in.includes(row.action))
  }
  const reader = {
    cantoneseLessonContent: {
      findUnique: async (args: unknown) => {
        calls.content.push(args)
        const where = (args as { where?: { externalId?: string } }).where
        return where?.externalId === source?.externalId ? source : null
      },
      update: async () => { writes += 1; throw new Error('resolver must not write') },
    },
    cantoneseReviewLog: {
      findMany: async (args: unknown) => {
        calls.logs.push(args)
        const where = (args as { where: Record<string, unknown> }).where
        return logs.filter((row) => whereMatches(where, row))
      },
      create: async () => { writes += 1; throw new Error('resolver must not write') },
    },
  }
  return { reader: reader as unknown as ResolverReader, calls, get writes() { return writes } }
}

test('linked audio without a current Content verification remains blocked and uses the Content target', async () => {
  const { reader, calls } = makeReader({ logs: [] })
  const resolved = await resolveAudioPronunciation(reader, asset())

  assert.equal(resolved.verified, false)
  assert.equal(resolved.validSource, true)
  assert.equal(resolved.reviewSource, 'CONTENT')
  assert.equal(resolved.sourceId, CONTENT_ID)
  assert.equal(resolved.text, TEXT)
  assert.equal(resolved.jyutping, JYUTPING)
  assert.equal(calls.logs.length, 1)
  assert.deepEqual((calls.logs[0] as { where: Record<string, unknown> }).where, {
    targetType: 'TEACHING',
    targetId: CONTENT_ID,
    action: { in: [CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION] },
  })
})

test('a pending candidate is not trusted merely because it has Jyutping and linked audio', async () => {
  const { reader } = makeReader({ source: content({ status: 'CONTENT_REVIEW_REQUIRED' }), logs: [] })
  const resolved = await resolveAudioPronunciation(reader, asset())

  assert.equal(resolved.verified, false)
  assert.equal(resolved.validSource, true)
  assert.equal(resolved.digest, digest())
})

test('a legacy hash-only teaching log verifies linked audio without any AUDIO log', async () => {
  const { reader, calls } = makeReader({ logs: [matchingLog('TEACHING', CONTENT_ID)] })
  const resolved = await resolveAudioPronunciation(reader, asset())

  assert.equal(resolved.verified, true)
  assert.equal(resolved.snapshotMatches, true)
  assert.equal(calls.logs.length, 1)
  assert.equal((calls.logs[0] as { where: { targetType: string; targetId: string } }).where.targetType, 'TEACHING')
  assert.equal((calls.logs[0] as { where: { targetType: string; targetId: string } }).where.targetId, CONTENT_ID)
})

test('new structured teaching review reasons also verify the exact canonical pair', async () => {
  const reason = jyutpingVerificationReason(TEXT, JYUTPING)
  assert.ok(reason)
  const { reader } = makeReader({ logs: [matchingLog('TEACHING', CONTENT_ID, CANTONESE_JYUTPING_REVIEW_ACTION, reason)] })
  const resolved = await resolveAudioPronunciation(reader, asset())

  assert.equal(resolved.verified, true)
})

test('a missing linked Content source fails closed and never falls back to AUDIO review history', async () => {
  const { reader, calls } = makeReader({ source: null, logs: [matchingLog('AUDIO', AUDIO_ID)] })
  const resolved = await resolveAudioPronunciation(reader, asset())

  assert.equal(resolved.validSource, false)
  assert.equal(resolved.verified, false)
  assert.equal(resolved.text, '')
  assert.equal(resolved.jyutping, null)
  assert.equal(resolved.digest, null)
  assert.equal(resolved.reviewSource, 'CONTENT')
  assert.equal(calls.logs.length, 0)
})

test('a source with the wrong audio link or lesson is rejected even when its Content review is current', async () => {
  for (const source of [
    content({ audioId: 'different-audio' }),
    content({ lessonId: 'different-lesson' }),
    content({ requiresAudio: false, requiresSpeaking: false }),
  ]) {
    const { reader, calls } = makeReader({ source, logs: [matchingLog('TEACHING', CONTENT_ID)] })
    const resolved = await resolveAudioPronunciation(reader, asset())
    assert.equal(resolved.validSource, false)
    assert.equal(resolved.verified, false)
    assert.equal(calls.logs.length, 0)
  }
})

test('standalone audio keeps its own AUDIO review target and remains verifiable', async () => {
  const standalone = asset({ contentId: null, lessonId: null })
  const { reader, calls } = makeReader({ logs: [matchingLog('AUDIO', AUDIO_ID)] })
  const resolved = await resolveAudioPronunciation(reader, standalone)

  assert.equal(resolved.validSource, true)
  assert.equal(resolved.verified, true)
  assert.equal(resolved.reviewSource, 'AUDIO')
  assert.equal(resolved.sourceId, null)
  assert.equal((calls.logs[0] as { where: { targetType: string; targetId: string } }).where.targetType, 'AUDIO')
  assert.equal((calls.logs[0] as { where: { targetType: string; targetId: string } }).where.targetId, AUDIO_ID)
})

test('changing canonical Content invalidates the old review, while a no-op keeps it valid', async () => {
  let current = content()
  const logs = [matchingLog('TEACHING', CONTENT_ID)]
  const calls: unknown[] = []
  const reader = {
    cantoneseLessonContent: { findUnique: async () => current },
    cantoneseReviewLog: { findMany: async (args: unknown) => { calls.push(args); return logs } },
  } as unknown as ResolverReader

  const before = await resolveAudioPronunciation(reader, asset())
  assert.equal(before.verified, true)

  current = content({ displayText: EDITED_TEXT, jyutping: EDITED_JYUTPING })
  const afterEdit = await resolveAudioPronunciation(reader, asset())
  assert.equal(afterEdit.verified, false)
  assert.equal(afterEdit.digest, digest(EDITED_TEXT, EDITED_JYUTPING))

  current = content()
  const afterNoOp = await resolveAudioPronunciation(reader, asset())
  assert.equal(afterNoOp.verified, true)
  assert.ok(calls.length >= 3)
})

test('the latest revoke closes a Content verification until an exact pair is reverified', async () => {
  const verified = matchingLog('TEACHING', CONTENT_ID, CANTONESE_JYUTPING_REVIEW_ACTION, digest(), '2026-10-05T09:01:00.000Z')
  const revoked = matchingLog('TEACHING', CONTENT_ID, CANTONESE_JYUTPING_REVOKE_ACTION, digest(), '2026-10-05T09:02:00.000Z')
  let { reader } = makeReader({ logs: [verified, revoked] })
  assert.equal((await resolveAudioPronunciation(reader, asset())).verified, false)

  const reverified = matchingLog('TEACHING', CONTENT_ID, CANTONESE_JYUTPING_REVIEW_ACTION, digest(), '2026-10-05T09:03:00.000Z')
  reader = makeReader({ logs: [verified, revoked, reverified] }).reader
  assert.equal((await resolveAudioPronunciation(reader, asset())).verified, true)
})

test('decoration is read-only and exposes canonical source plus snapshot state', async () => {
  const fixture = makeReader({ logs: [matchingLog('TEACHING', CONTENT_ID)] })
  const { reader, calls } = fixture
  const decorated = await decorateAudioPronunciation(reader, asset({ text: '旧快照', jyutping: 'gau6 faai3 ziu3' }))

  assert.equal(decorated.text, TEXT)
  assert.equal(decorated.jyutping, JYUTPING)
  assert.equal(decorated.jyutpingReviewStatus, 'VERIFIED')
  assert.equal(decorated.jyutpingReviewSource, 'CONTENT')
  assert.equal(decorated.jyutpingSourceId, CONTENT_ID)
  assert.equal(decorated.pronunciationSnapshotMatches, false)
  assert.equal(calls.content.length, 1)
  assert.equal(calls.logs.length, 1)
  assert.equal(fixture.writes, 0)
})

test('a verified source with a stale generated snapshot is not an audio-ready match', async () => {
  const { reader } = makeReader({ logs: [matchingLog('TEACHING', CONTENT_ID)] })
  const decorated = await decorateAudioPronunciation(reader, asset({
    text: '旧快照',
    jyutping: 'gau6 faai3 ziu3',
    assetStatus: 'READY',
    cosKey: 'private/cos-key',
    checksum: 'checksum',
    fileSize: 123,
  }))

  assert.equal(decorated.jyutpingReviewStatus, 'VERIFIED')
  assert.equal(decorated.pronunciationSourceValid, true)
  assert.equal(decorated.pronunciationSnapshotMatches, false)
  assert.equal(decorated.assetStatus === 'READY' && decorated.pronunciationSnapshotMatches, false)
})

// The route fixture below keeps all generation tests in-process: no Prisma client,
// COS connection, Tencent request, or environment-backed credential is touched.
const routeState: {
  asset: AssetRecord
  owner: AssetRecord | null
  source: ContentRecord | null
  logs: ReviewLog[]
} = { asset: asset(), owner: null, source: content(), logs: [] }

const routeCalls = {
  config: 0,
  synthesize: 0,
  storageCreate: 0,
  storageExists: 0,
  storageUpload: 0,
  updateMany: 0,
}
const routeReviewLogCreates: unknown[] = []

function resetRouteFixture() {
  routeState.asset = asset()
  routeState.owner = null
  routeState.source = content()
  routeState.logs = []
  for (const key of Object.keys(routeCalls) as Array<keyof typeof routeCalls>) routeCalls[key] = 0
  routeReviewLogCreates.length = 0
}

function routeLogMatches(where: Record<string, unknown>, row: ReviewLog) {
  const action = where.action as { in?: string[] } | undefined
  return row.targetType === where.targetType && row.targetId === where.targetId
    && (!action?.in || action.in.includes(row.action))
}

const routePrismaStub = {
  cantoneseAudioAsset: {
    findUnique: async ({ where }: { where: { externalId?: string; audioKey?: string } }) => {
      if (where.externalId) return where.externalId === routeState.asset.externalId ? routeState.asset : null
      if (where.audioKey) return routeState.owner && where.audioKey === routeState.owner.audioKey ? routeState.owner : null
      return null
    },
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      routeCalls.updateMany += 1
      Object.assign(routeState.asset, data)
      return { count: 1 }
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(routeState.asset, data)
      return routeState.asset
    },
  },
  cantoneseLessonContent: {
    findUnique: async ({ where }: { where: { externalId: string } }) => where.externalId === routeState.source?.externalId ? routeState.source : null,
  },
  cantoneseReviewLog: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => routeState.logs.filter((row) => routeLogMatches(where, row)),
    create: async ({ data }: { data: unknown }) => { routeReviewLogCreates.push(data); return data },
  },
}

Object.assign(routePrismaStub, {
  $transaction: async (operation: (tx: typeof routePrismaStub) => Promise<unknown>) => operation(routePrismaStub),
})

class StubFoundationAudioUnavailable extends Error {
  code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const foundationAudioStub = {
  FoundationAudioUnavailable: StubFoundationAudioUnavailable,
  readFoundationAudioConfig: () => {
    routeCalls.config += 1
    return { secretId: 'stub', secretKey: 'stub', region: 'ap-guangzhou', appId: 'stub', voiceType: 101019, speed: 0, sampleRate: 16000, codec: 'mp3' as const }
  },
  createFoundationAudioStorage: () => {
    routeCalls.storageCreate += 1
    return {
      exists: async (key: string) => { routeCalls.storageExists += 1; return Boolean(routeState.owner?.cosKey === key) },
      upload: async () => { routeCalls.storageUpload += 1 },
      signedUrl: (key: string) => `https://storage.invalid/${encodeURIComponent(key)}`,
    }
  },
  foundationAudioObjectKey: (text: string) => `stub/${text}`,
  synthesizeFoundationAudio: async () => {
    routeCalls.synthesize += 1
    return Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00])
  },
}

const securityStub = {
  requireRequestAdmin: async () => ({ user: { id: 'admin-1', role: 'ADMIN' as const } }),
}

const contentAdminStub = {
  parseContentType: (value: unknown) => typeof value === 'string' ? value : null,
  publicAudioAsset: <T extends { cosKey: string | null; audioKey?: string | null; assetStatus: string }>(record: T) => {
    const { cosKey, ...safe } = record
    delete (safe as { audioKey?: string | null }).audioKey
    return { ...safe, serverSupported: Boolean(cosKey && record.assetStatus === 'READY') }
  },
}

const reviewStub = {
  isCantoneseQuestionType,
  nextCantoneseAudioVersion,
  nextCantoneseReviewStatus,
  parseCantoneseReviewAction,
  parseCantoneseReviewEntityType,
  safeReviewIdentifier,
  safeReviewReason,
}

let generateRoute: typeof import('../app/api/admin/cantonese/audio/[audioId]/generate/route')
let detailRoute: typeof import('../app/api/admin/cantonese/review/[type]/[id]/route')

before(async () => {
  const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: routePrismaStub }
    if (request === '@/lib/security') return securityStub
    if (request === '@/lib/cantonese-foundation-audio') return foundationAudioStub
    if (request === '@/lib/cantonese-content-admin') return contentAdminStub
    if (request === '@/lib/cantonese-review') return reviewStub
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    generateRoute = await import('../app/api/admin/cantonese/audio/[audioId]/generate/route')
    detailRoute = await import('../app/api/admin/cantonese/review/[type]/[id]/route')
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

function generateRequest() {
  return new Request(`https://ecfc.invalid/api/admin/cantonese/audio/${AUDIO_ID}/generate`, { method: 'POST' })
}

function reviewPatchRequest(body: Record<string, unknown>) {
  return new Request(`https://ecfc.invalid/api/admin/cantonese/review/audio/${AUDIO_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function audioReviewContext() {
  return { params: Promise.resolve({ type: 'audio', id: AUDIO_ID }) }
}

test('generation blocks an unverified candidate before reading Tencent configuration', async () => {
  resetRouteFixture()
  const response = await generateRoute.POST(generateRequest(), { params: Promise.resolve({ audioId: AUDIO_ID }) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'JYUTPING_REVIEW_REQUIRED')
  assert.equal(routeCalls.config, 0)
  assert.equal(routeCalls.synthesize, 0)
})

test('generation accepts a pending Content candidate after exact teaching review and uses canonical text', async () => {
  resetRouteFixture()
  routeState.source = content({ status: 'CONTENT_REVIEW_REQUIRED', displayText: '  早晨  ', jyutping: ' zou2 san4 ' })
  routeState.asset = asset({ text: '旧候选快照', jyutping: null })
  routeState.logs = [matchingLog('TEACHING', CONTENT_ID)]

  const response = await generateRoute.POST(generateRequest(), { params: Promise.resolve({ audioId: AUDIO_ID }) })
  assert.equal(response.status, 200)
  const body = await response.json() as { item: { text: string; jyutping: string; status: string } }
  assert.equal(body.item.text, '早晨')
  assert.equal(body.item.jyutping, JYUTPING)
  assert.equal(body.item.status, 'CONTENT_REVIEW_REQUIRED')
  assert.equal(routeCalls.config, 1)
  assert.equal(routeCalls.synthesize, 1)
})

test('generation rejects a missing linked source even when the asset has a legacy AUDIO review', async () => {
  resetRouteFixture()
  routeState.source = null
  routeState.logs = [matchingLog('AUDIO', AUDIO_ID)]

  const response = await generateRoute.POST(generateRequest(), { params: Promise.resolve({ audioId: AUDIO_ID }) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'AUDIO_CONTENT_MISMATCH')
  assert.equal(routeCalls.config, 0)
  assert.equal(routeCalls.synthesize, 0)
})

test('a READY asset with a stale snapshot is regenerated and cannot short-circuit as ready', async () => {
  resetRouteFixture()
  routeState.asset = asset({
    text: '旧快照',
    jyutping: 'gau6 faai3 ziu3',
    assetStatus: 'READY',
    audioKey: 'old-audio-key',
    cosKey: 'old-cos-key',
    checksum: 'old-checksum',
    fileSize: 123,
  })
  routeState.logs = [matchingLog('TEACHING', CONTENT_ID)]

  const response = await generateRoute.POST(generateRequest(), { params: Promise.resolve({ audioId: AUDIO_ID }) })
  assert.equal(response.status, 200)
  assert.equal(routeCalls.synthesize, 1)
  assert.equal(routeState.asset.audioVersion, 'v2')
  assert.equal(routeState.asset.text, TEXT)
  assert.equal(routeState.asset.jyutping, JYUTPING)
})

test('snapshot changes reuse the deterministic owner cache while clearing stale target audioKey', async () => {
  resetRouteFixture()
  const ownerAudioKey = createHash('sha256').update(`stub/${TEXT}`).digest('hex')
  routeState.owner = asset({
    externalId: 'audio-owner',
    contentId: null,
    lessonId: null,
    audioKey: ownerAudioKey,
    cosKey: 'owner-cos-key',
    checksum: 'owner-checksum',
    fileSize: 456,
    assetStatus: 'READY',
    status: 'APPROVED',
  })
  routeState.asset = asset({
    text: '旧快照',
    jyutping: 'gau6 faai3 ziu3',
    audioKey: 'stale-target-key',
    audioVersion: 'v1',
    assetStatus: 'READY',
    cosKey: 'stale-cos-key',
    checksum: 'stale-checksum',
    fileSize: 123,
  })
  routeState.logs = [matchingLog('TEACHING', CONTENT_ID)]

  const response = await generateRoute.POST(generateRequest(), { params: Promise.resolve({ audioId: AUDIO_ID }) })
  assert.equal(response.status, 200)
  const body = await response.json() as { reused: boolean; item: { text: string; jyutping: string; audioVersion: string; checksum: string | null; fileSize: number | null; assetStatus: string; audioKey?: string | null } }
  assert.equal(body.reused, true)
  assert.equal(body.item.text, TEXT)
  assert.equal(body.item.jyutping, JYUTPING)
  assert.equal(body.item.audioVersion, 'v2')
  assert.equal(body.item.checksum, 'owner-checksum')
  assert.equal(body.item.fileSize, 456)
  assert.equal(body.item.assetStatus, 'READY')
  assert.equal(body.item.audioKey, undefined)
  assert.equal(routeState.asset.audioKey, null)
  assert.equal(routeState.asset.text, TEXT)
  assert.equal(routeState.asset.jyutping, JYUTPING)
  assert.equal(routeState.asset.cosKey, 'owner-cos-key')
  assert.equal(routeCalls.storageExists, 1)
  assert.equal(routeCalls.synthesize, 0)
  assert.equal(routeCalls.storageUpload, 0)
})

test('linked audio approval trusts a verified canonical Content pair without an AUDIO verification log', async () => {
  resetRouteFixture()
  routeState.asset = asset({ assetStatus: 'READY', cosKey: 'cos-key', checksum: 'checksum', fileSize: 123 })
  routeState.logs = [matchingLog('TEACHING', CONTENT_ID)]

  const response = await detailRoute.PATCH(reviewPatchRequest({ action: 'approve' }), audioReviewContext())
  assert.equal(response.status, 200)
  const body = await response.json() as { item: { status: string } }
  assert.equal(body.item.status, 'APPROVED')
  assert.equal(routeReviewLogCreates.length, 1)
  const log = routeReviewLogCreates[0] as { targetType: string; targetId: string; action: string }
  assert.equal(log.targetType, 'AUDIO')
  assert.equal(log.targetId, AUDIO_ID)
  assert.equal(log.action, 'APPROVE')
})

test('linked audio approval rejects an unverified canonical pair before changing review state', async () => {
  resetRouteFixture()
  routeState.asset = asset({ assetStatus: 'READY', cosKey: 'cos-key', checksum: 'checksum', fileSize: 123 })
  const response = await detailRoute.PATCH(reviewPatchRequest({ action: 'approve' }), audioReviewContext())

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'JYUTPING_REVIEW_REQUIRED')
  assert.equal(routeReviewLogCreates.length, 0)
  assert.equal(routeState.asset.status, 'CONTENT_REVIEW_REQUIRED')
})

test('linked audio approval rejects a stale generated snapshot even when Content review is current', async () => {
  resetRouteFixture()
  routeState.asset = asset({ text: '旧快照', jyutping: 'gau6 faai3 ziu3', assetStatus: 'READY', cosKey: 'cos-key', checksum: 'checksum', fileSize: 123 })
  routeState.logs = [matchingLog('TEACHING', CONTENT_ID)]
  const response = await detailRoute.PATCH(reviewPatchRequest({ action: 'approve' }), audioReviewContext())

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'AUDIO_CONTENT_MISMATCH')
  assert.equal(routeReviewLogCreates.length, 0)
  assert.equal(routeState.asset.status, 'CONTENT_REVIEW_REQUIRED')
})

test('linked audio approval rejects a missing source rather than using the asset text', async () => {
  resetRouteFixture()
  routeState.source = null
  routeState.asset = asset({ assetStatus: 'READY', cosKey: 'cos-key', checksum: 'checksum', fileSize: 123 })
  routeState.logs = [matchingLog('AUDIO', AUDIO_ID)]
  const response = await detailRoute.PATCH(reviewPatchRequest({ action: 'approve' }), audioReviewContext())

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'AUDIO_CONTENT_MISMATCH')
  assert.equal(routeReviewLogCreates.length, 0)
})

test('linked audio cannot create an AUDIO Jyutping verification; reviewers must verify Content', async () => {
  resetRouteFixture()
  const response = await detailRoute.PATCH(reviewPatchRequest({ action: 'verify-jyutping' }), audioReviewContext())

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'CONTENT_JYUTPING_SOURCE_REQUIRED')
  assert.equal(routeReviewLogCreates.length, 0)
})
