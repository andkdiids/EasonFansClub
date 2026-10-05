import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildCantoneseTeachingEditPayload, hasCantoneseTeachingEditChanges } from '../lib/cantonese-admin-edit-payload'
import { reviewLogFinalJyutping, reviewLogJyutpingDisplay } from '../app/admin/cantonese/CantoneseAdminReviewCenter'

const read = (path: string) => readFileSync(path, 'utf8')

test('teaching edit payload only includes dirty editable fields and sends null for clears', () => {
  const original = {
    title: '你好', body: '你好正文', displayText: '你好', jyutping: 'nei5 hou2', translation: '你好',
    explanation: '说明', usageNote: null, lessonId: 'lesson-arbitrary', requiresAudio: true, sortOrder: 7,
  }
  const payload = buildCantoneseTeachingEditPayload(original, {
    title: '你好', body: '你好正文', displayText: '你好', jyutping: '', translation: '你好', explanation: '说明', usageNote: '',
  })
  assert.deepEqual(payload, { action: 'edit', jyutping: null })
  assert.equal(hasCantoneseTeachingEditChanges(payload), true)
  assert.equal('lessonId' in payload, false)
  assert.equal('requiresAudio' in payload, false)
  assert.equal('sortOrder' in payload, false)
})

test('missing sparse edit values are omitted rather than interpreted as clears', () => {
  const payload = buildCantoneseTeachingEditPayload({ title: '标题', body: '正文', jyutping: 'nei5 hou2' }, { title: '标题' })
  assert.deepEqual(payload, { action: 'edit' })
  assert.equal(hasCantoneseTeachingEditChanges(payload), false)
})

test('review history never decodes unavailable digests and distinguishes current matches from recorded values', () => {
  assert.equal(reviewLogFinalJyutping({ action: 'VERIFY', reason: 'sha256:old', jyutpingValueSource: 'UNAVAILABLE' }), '不可用（历史记录未保存粤拼）')
  assert.equal(reviewLogJyutpingDisplay({ action: 'JYUTPING_EDIT', beforeJyutping: 'nei5', afterJyutping: 'nei5 hou2', jyutpingValueSource: 'RECORDED' }), 'nei5 → nei5 hou2')
  assert.match(reviewLogJyutpingDisplay({ action: 'VERIFY', jyutping: 'nei5 hou2', jyutpingValueSource: 'CURRENT_DIGEST_MATCH' }), /当前值与历史摘要匹配：nei5 hou2/)
})

test('review detail remains permission-gated and linked audio uses canonical content pronunciation without a second confirmation', () => {
  const ui = read('app/admin/cantonese/CantoneseAdminReviewCenter.tsx')
  const detailRoute = read('app/api/admin/cantonese/review/[type]/[id]/route.ts')
  assert.match(ui, /\/api\/admin\/cantonese\/review\/\$\{type\}\//)
  assert.match(ui, /cache: 'no-store'/)
  assert.match(ui, /reviewer\?\.nickname/)
  assert.match(ui, /jyutpingSourceId/)
  assert.match(ui, /音频无需再次确认/)
  assert.match(ui, /pronunciationSnapshotMatches === false/)
  assert.match(ui, /pronunciationSourceValid === false/)
  assert.match(ui, /async function invalidateReviewDetails/)
  assert.ok((ui.match(/await invalidateReviewDetails\(\)/g) || []).length >= 3)
  assert.doesNotMatch(ui, /lesson-0[5-9]/)
  assert.match(detailRoute, /requireRequestAdmin\(request, 'cantonese_review'\)/)
})
