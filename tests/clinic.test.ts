import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  checkClinicModerationWithWords,
  maskClinicTextWithWords,
} from '../lib/clinic-moderation'
import type { ModerationWord } from '../lib/content-moderation'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

const words: ModerationWord[] = [
  { id: 'mask', word: '傻瓜', normalizedWord: '傻瓜', enabled: true, priority: 'NORMAL' },
  { id: 'strict', word: 'strict-word', normalizedWord: 'strict-word', enabled: true, priority: 'HIGH' },
  { id: 'latin-mask', word: 'damn', normalizedWord: 'damn', enabled: true, priority: 'NORMAL' },
]

test('clinic moderation keeps strict words blocked and masks normal words only for display', () => {
  const normal = checkClinicModerationWithWords('你这个傻瓜', words)
  assert.equal(normal.blocked, false)
  assert.deepEqual(normal.maskMatches.map((word) => word.word), ['傻瓜'])
  assert.equal(maskClinicTextWithWords('你这个傻瓜', words), '你这个哔——')

  const strict = checkClinicModerationWithWords('strict-word', words)
  assert.equal(strict.blocked, true)
  assert.equal(maskClinicTextWithWords('strict-word', words), 'strict-word')
})

test('clinic masking does not replace an ASCII term inside a larger normal word', () => {
  assert.equal(maskClinicTextWithWords('undamnable damn!', words), 'undamnable 哔——!')
})

test('clinic schema and migration are additive and use independent entities', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260816160000_add_aspirin_clinic/migration.sql')
  for (const model of ['ClinicRecord', 'ClinicConsultation', 'ClinicAspirin', 'ClinicMouthpiece', 'ClinicReport']) {
    assert.match(schema, new RegExp(`model ${model}\\s*\\{`))
    assert.match(migration, new RegExp('CREATE TABLE `' + model + '`'))
  }
  assert.match(schema, /@@unique\(\[userId, recordId\]\)/)
  assert.match(schema, /@@unique\(\[userId, consultationId\]\)/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i)
})

test('clinic public DTOs separate anonymous display identity from admin identity', () => {
  const service = read('lib/clinic-service.ts')
  const identityStart = service.indexOf('export type ClinicPublicIdentity')
  const identityEnd = service.indexOf('export type ClinicPublicConsultation')
  assert.ok(identityStart >= 0 && identityEnd > identityStart)
  const publicIdentity = service.slice(identityStart, identityEnd)
  assert.match(publicIdentity, /type: 'anonymous'/)
  assert.match(publicIdentity, /canOpenProfile: false/)
  assert.doesNotMatch(publicIdentity, /authorId|email|profileUrl:.*authorId/)
  assert.match(read('app/clinic/[recordId]/page.tsx'), /markPersonalNotificationsForTargetRead/)
})

test('clinic interaction routes require server transactions and database-backed uniqueness', () => {
  const service = read('lib/clinic-service.ts')
  assert.match(service, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(service, /P2002/)
  assert.match(read('app/api/admin/clinic/route.ts'), /requireAdmin\('clinic_manage'\)/)
  assert.match(read('app/api/clinic/[recordId]/route.ts'), /getPublicClinicRecordDetail/)
  assert.match(read('middleware.ts'), /'\/clinic'/)
  assert.match(read('middleware.ts'), /'\/api\/clinic\/'/)
  assert.match(read('lib/navigation-registry.ts'), /href: '\/clinic'/)
  assert.match(read('lib/navigation-registry.ts'), /icon: 'stethoscope'/)
})

test('clinic client requests match the dynamic record routes', () => {
  const home = read('components/clinic/ClinicHomeClient.tsx')
  const detail = read('components/clinic/ClinicDetailClient.tsx')
  const aspirinRoute = read('app/api/clinic/[recordId]/aspirin/route.ts')
  const consultationRoute = read('app/api/clinic/[recordId]/consultations/route.ts')

  assert.match(home, /fetch\(`\/api\/clinic\/\$\{record\.id\}\/aspirin`/)
  assert.doesNotMatch(home, /\/api\/clinic\/records\/\$\{record\.id\}\/aspirin/)
  assert.match(detail, /fetch\(`\/api\/clinic\/\$\{record\.id\}\/aspirin`/)
  assert.match(detail, /fetch\(`\/api\/clinic\/\$\{record\.id\}\/consultations`/)
  assert.match(detail, /fetch\(`\/api\/clinic\/\$\{record\.id\}`/)
  assert.doesNotMatch(detail, /\/api\/clinic\/records\/\$\{record\.id\}\/(aspirin|consultations)/)
  assert.match(aspirinRoute, /export async function POST/)
  assert.match(consultationRoute, /export async function POST/)
})

test('clinic aspirin interactions keep database count authoritative under duplicates', () => {
  const service = read('lib/clinic-service.ts')
  const home = read('components/clinic/ClinicHomeClient.tsx')
  const card = read('components/clinic/ClinicRecordCard.tsx')
  const detail = read('components/clinic/ClinicDetailClient.tsx')

  assert.match(service, /P2002[\s\S]*created: false, count/)
  assert.match(service, /aspirinCount: \{ increment: 1 \}/)
  assert.match(service, /aspirinCount: \{ gt: 0 \}/)
  assert.match(service, /RECORD_NOT_FOUND', '[^']+', 404/)
  assert.match(home, /aspirinPendingId === record\.id/)
  assert.match(card, /disabled=\{isAspirinPending\}/)
  assert.match(detail, /recordAspirinPending/)
})

test('clinic consultation input preserves business validation and safe diagnostics', () => {
  const service = read('lib/clinic-service.ts')
  const api = read('app/api/clinic/[recordId]/consultations/route.ts')
  const detail = read('components/clinic/ClinicDetailClient.tsx')
  const clinicApi = read('lib/clinic-api.ts')

  assert.match(api, /content: body\?\.content/)
  assert.doesNotMatch(api, /content: sanitizeText\(body\?\.content/)
  assert.match(service, /CONTENT_TOO_SHORT/)
  assert.match(service, /CONTENT_TOO_LONG/)
  assert.match(service, /STRICT_BANNED_WORD/)
  assert.match(service, /consultationCount: \{ increment: 1 \}/)
  assert.match(detail, /setRecord\(body\.data\.record\)/)
  assert.match(api, /action: 'clinic\.consultation\.create'/)
  assert.match(api, /contentLength:/)
  assert.match(clinicApi, /prismaCode/)
  assert.match(clinicApi, /status: 500/)
  assert.doesNotMatch(clinicApi, /console\.error\([^\n]*(content|body)/i)
})

test('clinic nested replies keep the direct target, notify only that author, and flatten visually', () => {
  const service = read('lib/clinic-service.ts')
  const api = read('app/api/clinic/[recordId]/consultations/route.ts')
  const detail = read('components/clinic/ClinicDetailClient.tsx')

  assert.match(api, /parentId: sanitizeText\(body\?\.parentId, 80\) \|\| null/)
  assert.match(service, /parentId: parent\?\.id \|\| null/)
  assert.doesNotMatch(service, /NESTING_TOO_DEEP/)
  assert.match(service, /const rootId = resolveRootId\(row\.id\)/)
  assert.match(service, /if \(root\) root\.replies\.push\(item\)/)
  assert.match(service, /const recipientId = \(parent\?\.authorId \|\| record\.authorId\)/)
  assert.match(detail, /onReply=\{\(id\) =>/)
  assert.match(detail, /onClick=\{\(\) => onReply\(item\.id\)\}/)
  assert.match(detail, /item\.replyToName/)
})

test('clinic mobile layout uses one-column hero, scrollable tabs, compact actions and bounded composer', () => {
  const css = read('app/globals.css')
  const mobileCss = css
  const home = read('components/clinic/ClinicHomeClient.tsx')
  const detail = read('components/clinic/ClinicDetailClient.tsx')

  assert.match(mobileCss, /\.clinic-hero \{ width:100%; grid-template-columns:minmax\(0,1fr\)/)
  assert.match(mobileCss, /\.clinic-hero-mark \{ display:none; \}/)
  assert.match(css, /\.clinic-category-nav \{[^}]*overflow-x:auto/)
  assert.match(css, /\.clinic-category-nav button \{[^}]*white-space:nowrap/)
  assert.match(mobileCss, /\.clinic-record-card-footer \{[^}]*flex-wrap:nowrap/)
  assert.match(mobileCss, /\.clinic-composer-section textarea \{[^}]*max-height:180px/)
  assert.match(detail, /useState\(''\)/)
  assert.doesNotMatch(detail, /defaultValue|<textarea[^>]*>[^<]+<\/textarea>/)
  assert.match(home, /clinic-inline-message clinic-list-error/)
  assert.doesNotMatch(home, /clinic-error-state/)
})

test('clinic migration fields remain aligned with the Prisma models', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260816160000_add_aspirin_clinic/migration.sql')
  const fields = {
    ClinicRecord: ['authorId', 'content', 'category', 'needType', 'identityMode', 'anonymousNumber', 'status', 'aspirinCount', 'consultationCount', 'mouthpieceCount', 'moderationReason', 'matchedBannedWords', 'createdAt', 'updatedAt', 'deletedAt'],
    ClinicConsultation: ['recordId', 'authorId', 'content', 'identityMode', 'anonymousNumber', 'parentId', 'aspirinCount', 'mouthpieceCount', 'status', 'moderationReason', 'matchedBannedWords', 'createdAt', 'updatedAt', 'deletedAt'],
    ClinicAspirin: ['userId', 'recordId', 'consultationId', 'createdAt'],
    ClinicMouthpiece: ['userId', 'consultationId', 'createdAt'],
    ClinicReport: ['reporterId', 'recordId', 'consultationId', 'reason', 'detail', 'status', 'handledById', 'handledAt', 'createdAt'],
  } as const

  for (const [model, modelFields] of Object.entries(fields)) {
    const modelStart = schema.indexOf(`model ${model} {`)
    const modelEnd = schema.indexOf('\n}', modelStart)
    const modelText = schema.slice(modelStart, modelEnd)
    assert.ok(modelStart >= 0, `${model} is missing from schema`)
    for (const field of modelFields) {
      assert.match(modelText, new RegExp(`^\\s+${field}\\s`, 'm'), `${model}.${field} is missing from schema`)
      assert.match(migration, new RegExp('`' + field + '`'), `${model}.${field} is missing from migration`)
    }
  }
  assert.match(migration, /UNIQUE INDEX `ClinicAspirin_userId_recordId_key`/)
  assert.match(migration, /UNIQUE INDEX `ClinicAspirin_userId_consultationId_key`/)
})
