import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { findV6CoursePack, V6_COURSE_PACKS } from '../lib/cantonese-course-packs'
import { parseCantoneseSeedRequest } from '../lib/cantonese-course-pack-request'
import { isLatestJyutpingVerification, CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION } from '../lib/cantonese-jyutping-review'
import { planSeedRows } from '../lib/cantonese-seed-import'

const read = (path: string) => readFileSync(path, 'utf8')

test('admin Cantonese page is permission-gated and discoverable through existing admin navigation', () => {
  const page = read('app/admin/cantonese/page.tsx')
  const permissions = read('lib/admin-permission-config.ts')
  const navigation = read('lib/admin-navigation.ts')
  const packRoute = read('app/api/admin/cantonese/seed-packs/route.ts')
  assert.match(page, /requireAdminPage\('\/admin\/cantonese', 'cantonese_review'\)/)
  assert.match(page, /user\.role !== 'ADMIN'[\s\S]*user\.role !== 'SUPER_ADMIN'/)
  assert.match(permissions, /'\/admin\/cantonese': 'cantonese_review'/)
  assert.match(navigation, /href: '\/admin\/cantonese'.*粤语课程审核/)
  assert.match(packRoute, /requireRequestAdmin\(request, 'cantonese_review'\)/)
  assert.match(packRoute, /guard\.user\.role !== 'ADMIN'[\s\S]*guard\.user\.role !== 'SUPER_ADMIN'/)
})

test('course pack list and preview are driven by the pack registry, and preview performs reads only', () => {
  assert.ok(V6_COURSE_PACKS.length >= 1)
  assert.ok(findV6CoursePack('lesson-05'))
  const packRoute = read('app/api/admin/cantonese/seed-packs/route.ts')
  const previewRoute = read('app/api/admin/cantonese/review/import/preview/route.ts')
  const previewService = read('lib/cantonese-seed-pack-preview.ts')
  assert.match(packRoute, /listCantoneseSeedPacks/)
  assert.match(previewRoute, /getCantoneseSeedPackPreview/)
  assert.match(previewRoute, /writes: false/)
  assert.match(previewService, /V6_COURSE_PACKS\.map/)
  assert.match(previewService, /findMany/)
  assert.doesNotMatch(previewRoute + previewService, /\.create\(|\.update\(|\$transaction/)
  assert.match(previewService, /summary:/)
  assert.match(previewService, /approvedSkipped/)
  assert.match(previewService, /UPDATE_AVAILABLE/)
  assert.match(previewService, /SKIPPED_ALREADY_APPROVED/)
})

test('candidate preview exposes item-level content safely and distinguishes unreviewed Jyutping/audio', () => {
  const previewService = read('lib/cantonese-seed-pack-preview.ts')
  const ui = read('app/admin/cantonese/CantoneseAdminReviewCenter.tsx')
  assert.match(previewService, /externalId: item\.externalId/)
  assert.match(previewService, /jyutpingReviewStatus: item\.jyutpingReviewStatus/)
  assert.match(previewService, /cosKey/)
  assert.match(previewService, /audioReady: ready/)
  assert.match(ui, /JYUTPING_REVIEW_REQUIRED/)
  assert.match(ui, /待人工核对/)
  assert.match(ui, /缺候选/)
  assert.match(ui, /APPROVED_PROTECTED/)
  assert.match(ui, /标准音尚未就绪，暂不可批准/)
  assert.match(ui, /口语练习：不评分/)
  assert.doesNotMatch(previewService, /signedUrl|audioKey/)
})

test('import and approved adoption require explicit confirmation and import API preserves approved candidates', () => {
  const ui = read('app/admin/cantonese/CantoneseAdminReviewCenter.tsx')
  const importer = read('app/api/admin/cantonese/review/import/route.ts')
  const adopter = read('app/api/admin/cantonese/review/import/adopt/route.ts')
  assert.match(ui, /showImportConfirm && <ConfirmDialog/)
  assert.match(ui, /导入仅创建新增候选/)
  assert.match(ui, /updateExistingCandidates: importMode === 'new-and-pending-updates'/)
  assert.match(ui, /confirmed: true/)
  assert.match(ui, /showAdoptConfirm && <ConfirmDialog/)
  assert.match(adopter, /body\.confirmed !== true/)
  assert.match(adopter, /status: 'CONTENT_REVIEW_REQUIRED'/)
  assert.match(importer, /decision === 'CREATE_PENDING'/)
  assert.match(importer, /decision === 'CANDIDATE_UPDATE_AVAILABLE'/)
  assert.doesNotMatch(importer, /decision === 'UPDATE_AVAILABLE'\)\s*\{[\s\S]*?updateMany/)
  assert.match(importer, /existingRecordsPreserved: true/)
  assert.match(importer, /confirmation !== true/)
  assert.match(importer, /IMPORT_CONFIRMATION_REQUIRED/)
})

test('review UI supports status/search/lesson filters and gates audio generation until Jyutping is verified', () => {
  const ui = read('app/admin/cantonese/CantoneseAdminReviewCenter.tsx')
  const generate = read('app/api/admin/cantonese/audio/[audioId]/generate/route.ts')
  assert.match(ui, /待审核/)
  assert.match(ui, /已通过/)
  assert.match(ui, /已退回/)
  assert.match(ui, /草稿/)
  assert.match(ui, /全部课程/)
  assert.match(ui, /sourceFilter/)
  assert.match(ui, /搜索 ID \/ 关键词/)
  assert.match(ui, /disabled=\{busy \|\| jyutpingState !== 'VERIFIED'\}/)
  assert.match(generate, /JYUTPING_REVIEW_REQUIRED/)
  assert.match(generate, /isLatestJyutpingVerification/)
})

test('Jyutping confirmation can be revoked using review history; latest revoke closes approval and TTS gate', () => {
  const digest = 'sha256:reviewed-exact-text'
  const verified = { action: CANTONESE_JYUTPING_REVIEW_ACTION, reason: digest, createdAt: new Date('2026-10-04T09:00:00Z') }
  const revoked = { action: CANTONESE_JYUTPING_REVOKE_ACTION, reason: digest, createdAt: new Date('2026-10-04T09:01:00Z') }
  const reverified = { action: CANTONESE_JYUTPING_REVIEW_ACTION, reason: digest, createdAt: new Date('2026-10-04T09:02:00Z') }
  assert.equal(isLatestJyutpingVerification([verified], digest), true)
  assert.equal(isLatestJyutpingVerification([revoked, verified], digest), false)
  assert.equal(isLatestJyutpingVerification([reverified, revoked, verified], digest), true)
  assert.equal(isLatestJyutpingVerification([verified], 'sha256:different-content'), false)
  const actionRoute = read('app/api/admin/cantonese/review/[type]/[id]/route.ts')
  const reviewLogic = read('lib/cantonese-review.ts')
  assert.match(actionRoute, /action === 'revoke-jyutping'/)
  assert.match(actionRoute, /CANTONESE_JYUTPING_REVOKE_ACTION/)
  assert.match(actionRoute, /status: 'CONTENT_REVIEW_REQUIRED'/)
  assert.match(actionRoute, /reviewedAt: null/)
  assert.match(reviewLogic, /'revoke-jyutping'/)
})

test('course candidate pack registry includes stable lesson IDs and candidate-only review status', () => {
  for (const pack of V6_COURSE_PACKS) {
    assert.match(pack.definition.lessonId, /^lesson-\d{2}$/)
    assert.equal(pack.definition.status, 'CONTENT_REVIEW_REQUIRED')
    assert.ok(new Set(pack.teaching.map((item) => item.externalId)).size === pack.teaching.length)
    assert.ok(new Set(pack.questions.map((item) => item.externalId)).size === pack.questions.length)
    assert.ok(new Set(pack.audio.map((item) => item.externalId)).size === pack.audio.length)
    const approved = planSeedRows(pack.teaching.map(({ externalId }) => ({ externalId, title: 'new candidate' })), [{ externalId: pack.teaching[0].externalId, status: 'APPROVED', title: 'approved' }], 'teaching')
    assert.equal(approved[0].decision, 'UPDATE_AVAILABLE')
  }
})

test('every registered course pack parses through the exact server-side preview/import contract', () => {
  for (const pack of V6_COURSE_PACKS) {
    const parsed = parseCantoneseSeedRequest(JSON.stringify({ packId: pack.definition.lessonId }))
    assert.equal(parsed instanceof Response, false, `${pack.definition.lessonId} should satisfy candidate validation`)
    if (parsed instanceof Response) continue
    assert.equal(parsed.selectedLessonId, pack.definition.lessonId)
    assert.equal(parsed.teaching.length, pack.teaching.length)
    assert.equal(parsed.questions.length, pack.questions.length)
    assert.equal(parsed.audio.length, pack.audio.length)
    assert.ok(parsed.teaching.every((row) => row.status === 'CONTENT_REVIEW_REQUIRED'))
    assert.ok(parsed.questions.every((row) => row.status === 'CONTENT_REVIEW_REQUIRED'))
    assert.ok(parsed.audio.every((row) => row.status === 'CONTENT_REVIEW_REQUIRED' && row.assetStatus === 'NOT_GENERATED'))
  }
})
