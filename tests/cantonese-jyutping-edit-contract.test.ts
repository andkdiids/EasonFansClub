import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { cantoneseJyutpingReviewDigest, jyutpingVerificationReason } from '../lib/cantonese-jyutping-review'

type TeachingRecord = {
  externalId: string
  lessonId: string
  stageId: string
  stepId: string
  title: string
  body: string
  displayText: string | null
  jyutping: string | null
  tone: string | null
  examples: unknown
  audioId: string | null
  contentType: string
  translation: string | null
  explanation: string | null
  section: string | null
  usageNote: string | null
  sourceReference: string | null
  dialogueId: string | null
  speaker: string | null
  contentVersion: number
  sortOrder: number
  requiresAudio: boolean
  requiresSpeaking: boolean
  status: 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED'
  reviewedById: string | null
  reviewedAt: Date | null
  reviewNote: string | null
}

const updates: Array<Record<string, unknown>> = []
const logs: Array<Record<string, unknown>> = []
const readLogs: Array<Record<string, unknown>> = []
const databaseReads = { content: 0, logs: 0 }

function initialRecord(): TeachingRecord {
  return {
    externalId: 'teaching-1', lessonId: 'lesson-01', stageId: 'tone-introduction', stepId: 'step-1',
    title: '你好', body: '你好', displayText: '你好', jyutping: 'nei5 hou2', tone: '2',
    examples: [{ text: '你好嗎？' }], audioId: null, contentType: 'WORD', translation: 'hello',
    explanation: '打招呼。', section: '01', usageNote: '日常使用。', sourceReference: 'source-1',
    dialogueId: 'dialogue-1', speaker: 'A', contentVersion: 11, sortOrder: 4,
    requiresAudio: false, requiresSpeaking: false, status: 'APPROVED', reviewedById: 'reviewer-1',
    reviewedAt: new Date('2026-10-01T00:00:00.000Z'), reviewNote: '已审。',
  }
}

let record = initialRecord()
let authUser: { id: string; role: 'ADMIN' | 'SUPER_ADMIN' | 'USER' } | null = { id: 'admin-1', role: 'ADMIN' }

const txStub = {
  cantoneseLessonContent: {
    findUnique: async () => ({ ...record }),
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      const next = { ...record }
      for (const [key, value] of Object.entries(data)) {
        if (key === 'reviewer') {
          const relation = value as { disconnect?: boolean; connect?: { id: string } }
          next.reviewedById = relation.disconnect ? null : relation.connect?.id || next.reviewedById
          continue
        }
        ;(next as unknown as Record<string, unknown>)[key] = value
      }
      record = next
      return { ...record }
    },
  },
  cantoneseReviewLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      logs.push(data)
      return data
    },
  },
}

const prismaStub = {
  cantoneseLessonContent: {
    findUnique: async () => {
      databaseReads.content += 1
      return { ...record }
    },
  },
  cantoneseReviewLog: {
    findMany: async () => {
      databaseReads.logs += 1
      return readLogs.map((entry) => ({ ...entry }))
    },
  },
  $transaction: async <T>(operation: (tx: typeof txStub) => Promise<T>) => operation(txStub),
}

const securityModule = {
  requireRequestAdmin: async () => ({ user: authUser, response: new Response(null, { status: 401 }) }),
  sanitizeText: (value: unknown, maxLength = 5000) => String(value ?? '').trim().slice(0, maxLength),
}

let route: typeof import('../app/api/admin/cantonese/review/[type]/[id]/route')

before(async () => {
  const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaStub }
    if (request === '@/lib/security') return securityModule
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    route = await import('../app/api/admin/cantonese/review/[type]/[id]/route')
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

beforeEach(() => {
  record = initialRecord()
  authUser = { id: 'admin-1', role: 'ADMIN' }
  updates.length = 0
  logs.length = 0
  readLogs.length = 0
  databaseReads.content = 0
  databaseReads.logs = 0
})

function edit(body: Record<string, unknown>) {
  return route.PATCH(
    new Request('https://ecfc.fans/api/admin/cantonese/review/teaching/teaching-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'edit', ...body }),
    }),
    { params: Promise.resolve({ type: 'teaching', id: 'teaching-1' }) },
  )
}

function readReview() {
  return route.GET(
    new Request('https://ecfc.fans/api/admin/cantonese/review/teaching/teaching-1'),
    { params: Promise.resolve({ type: 'teaching', id: 'teaching-1' }) },
  )
}

test('teaching Jyutping-only patch accepts nullable form values and preserves omitted fields', async () => {
  const response = await edit({ jyutping: 'nei5 hou3', displayText: null, tone: null, examples: null })
  assert.equal(response.status, 200)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].jyutping, 'nei5 hou3')
  assert.equal(updates[0].displayText, null)
  assert.equal(updates[0].tone, null)
  assert.notEqual(updates[0].examples, undefined)
  assert.equal(updates[0].title, undefined)
  assert.equal(updates[0].translation, undefined)
  assert.equal(record.title, '你好')
  assert.equal(record.translation, 'hello')
  assert.equal(record.contentVersion, 12)
  assert.equal(record.status, 'CONTENT_REVIEW_REQUIRED')
})

test('spoken content with missing Jyutping and null teaching metadata accepts a Jyutping-only edit', async () => {
  record = {
    ...initialRecord(), title: '早晨', body: '早晨', displayText: '早晨', jyutping: null, tone: null,
    examples: null, translation: null, usageNote: null, requiresAudio: true, requiresSpeaking: true,
  }
  const response = await edit({ jyutping: 'zou2 san4' })
  assert.equal(response.status, 200)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].jyutping, 'zou2 san4')
  assert.equal(updates[0].displayText, undefined)
  assert.equal(updates[0].translation, undefined)
  assert.equal(updates[0].usageNote, undefined)
  assert.equal(updates[0].tone, undefined)
  assert.equal(updates[0].examples, undefined)
  assert.equal(record.displayText, '早晨')
  assert.equal(record.jyutping, 'zou2 san4')
  assert.equal(record.translation, null)
  assert.equal(record.usageNote, null)
  assert.equal(record.tone, null)
  assert.equal(record.examples, null)
})

test('teaching null/blank clears nullable strings, while null/blank nonnullable fields are rejected', async () => {
  const cleared = await edit({ translation: null, explanation: null, section: null, usageNote: '', sourceReference: null, dialogueId: null, speaker: null })
  assert.equal(cleared.status, 200)
  assert.equal(record.translation, null)
  assert.equal(record.explanation, null)
  assert.equal(record.section, null)
  assert.equal(record.usageNote, null)
  assert.equal(record.sourceReference, null)
  assert.equal(record.dialogueId, null)
  assert.equal(record.speaker, null)

  for (const body of [{ title: null }, { title: '' }, { contentType: null }, { sortOrder: null }, { requiresAudio: null }]) {
    record = initialRecord()
    updates.length = 0
    logs.length = 0
    const response = await edit(body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal(updates.length, 0, JSON.stringify(body))
    assert.equal(logs.length, 0, JSON.stringify(body))
  }
})

test('true no-op Jyutping save returns current without resetting status, version, or audit logs', async () => {
  const response = await edit({ jyutping: 'nei5 hou2' })
  assert.equal(response.status, 200)
  assert.equal(updates.length, 0)
  assert.equal(logs.length, 0)
  assert.equal(record.status, 'APPROVED')
  assert.equal(record.contentVersion, 11)
  assert.equal(record.reviewedById, 'reviewer-1')
})

test('actual Jyutping change revokes the old digest and records bounded edit before/after values', async () => {
  const oldDigest = cantoneseJyutpingReviewDigest('你好', 'nei5 hou2')
  const response = await edit({ jyutping: 'nei5 hou3' })
  assert.equal(response.status, 200)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].action, 'REVOKE_JYUTPING')
  assert.equal(logs[0].reason, oldDigest)
  assert.equal(logs[1].action, 'EDIT')
  assert.deepEqual(JSON.parse(String(logs[1].reason)), {
    kind: 'JYUTPING_EDIT', beforeJyutping: 'nei5 hou2', afterJyutping: 'nei5 hou3',
  })
})

test('admin GET returns reviewer/date and recorded final/before-after values without fabricating unmatched legacy Jyutping', async () => {
  const currentDigest = cantoneseJyutpingReviewDigest('你好', 'nei5 hou2')!
  const unmatchedDigest = cantoneseJyutpingReviewDigest('早晨', 'zou2 san4')!
  readLogs.push(
    {
      id: 'log-current', action: 'VERIFY_JYUTPING', oldStatus: 'CONTENT_REVIEW_REQUIRED', newStatus: 'CONTENT_REVIEW_REQUIRED',
      reason: currentDigest, createdAt: new Date('2026-10-02T00:00:00.000Z'), reviewer: { id: 'reviewer-current', nickname: '甲' },
    },
    {
      id: 'log-edit', action: 'EDIT', oldStatus: 'APPROVED', newStatus: 'CONTENT_REVIEW_REQUIRED',
      reason: JSON.stringify({ kind: 'JYUTPING_EDIT', beforeJyutping: 'nei5 hou2', afterJyutping: 'nei5 hou3' }),
      createdAt: new Date('2026-10-03T00:00:00.000Z'), reviewer: { id: 'reviewer-edit', nickname: '乙' },
    },
    {
      id: 'log-recorded', action: 'VERIFY_JYUTPING', oldStatus: 'CONTENT_REVIEW_REQUIRED', newStatus: 'CONTENT_REVIEW_REQUIRED',
      reason: jyutpingVerificationReason('你好', 'nei5 hou2'), createdAt: new Date('2026-10-04T00:00:00.000Z'),
      reviewer: { id: 'reviewer-recorded', nickname: '丙' },
    },
    {
      id: 'log-unmatched', action: 'VERIFY_JYUTPING', oldStatus: 'CONTENT_REVIEW_REQUIRED', newStatus: 'CONTENT_REVIEW_REQUIRED',
      reason: unmatchedDigest, createdAt: new Date('2026-10-05T00:00:00.000Z'), reviewer: { id: 'reviewer-unmatched', nickname: '丁' },
    },
  )

  const response = await readReview()
  assert.equal(response.status, 200)
  assert.equal(databaseReads.content, 1)
  assert.equal(databaseReads.logs, 1)
  assert.equal(updates.length, 0)
  assert.equal(logs.length, 0)
  const payload = await response.json() as { logs: Array<Record<string, unknown>> }
  const current = payload.logs.find((entry) => entry.id === 'log-current')!
  assert.equal(current.reason, '粤拼核对记录')
  assert.equal(current.jyutping, 'nei5 hou2')
  assert.equal(current.jyutpingValueSource, 'CURRENT_DIGEST_MATCH')
  assert.deepEqual(current.reviewer, { id: 'reviewer-current', nickname: '甲' })
  assert.equal(current.createdAt, '2026-10-02T00:00:00.000Z')

  const recorded = payload.logs.find((entry) => entry.id === 'log-recorded')!
  assert.equal(recorded.jyutping, 'nei5 hou2')
  assert.equal(recorded.jyutpingValueSource, 'RECORDED')
  const editLog = payload.logs.find((entry) => entry.id === 'log-edit')!
  assert.equal(editLog.reason, '编辑教学内容')
  assert.equal(editLog.beforeJyutping, 'nei5 hou2')
  assert.equal(editLog.afterJyutping, 'nei5 hou3')
  assert.equal(editLog.jyutping, 'nei5 hou3')
  const unmatched = payload.logs.find((entry) => entry.id === 'log-unmatched')!
  assert.equal(unmatched.jyutping, null)
  assert.equal(unmatched.jyutpingValueSource, 'UNAVAILABLE')
})

test('non-admin GET is forbidden before any database read', async () => {
  authUser = { id: 'user-1', role: 'USER' }
  const response = await readReview()
  assert.equal(response.status, 403)
  assert.equal(databaseReads.content, 0)
  assert.equal(databaseReads.logs, 0)
})
