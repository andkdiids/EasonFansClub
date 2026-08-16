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
  assert.match(read('components/layout/MobileNavigation.tsx'), /href: '\/clinic'/)
  assert.match(read('components/layout/MobileNavigation.tsx'), /stethoscope/)
})
