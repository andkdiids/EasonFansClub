import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { validateContentImageFileMetadata } from '@/lib/content-image-upload'
import { normalizeTopicActivityConfig } from '@/lib/topic-activity-config'
import { normalizeTopicActivityFormSchema, validateTopicActivityFormAnswers } from '@/lib/topic-activity-form'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const schema = {
  version: 1,
  fields: [
    { id: 'intro', label: '简单介绍', type: 'TEXTAREA', required: true },
    { id: 'kind', label: '类别', type: 'SINGLE_SELECT', required: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { id: 'photos', label: '图片', type: 'IMAGE', required: false, multiple: true, maxImages: 3 },
  ],
}

test('表单活动配置支持 COMMENT / FORM / BOTH，FORM 模式需要有稳定 schema 字段', () => {
  for (const participationMode of ['COMMENT', 'FORM', 'BOTH'] as const) {
    const config = normalizeTopicActivityConfig({ participationMode, allowImageAttachments: true, formSchema: schema }, 'TOPIC_ACTIVITY')
    assert.equal(config.valid, true)
    if (config.valid) assert.equal(config.value.participationMode, participationMode)
  }
  assert.equal(normalizeTopicActivityConfig({ participationMode: 'FORM' }, 'TOPIC_ACTIVITY').valid, false)
})

test('schema 允许受限字段类型和最多 9 张图片，并拒绝重复 ID、非法字段、未开启图片', () => {
  const normalized = normalizeTopicActivityFormSchema(schema, true)
  assert.equal(normalized.valid, true)
  if (normalized.valid) assert.equal(normalized.value.fields[2]?.maxImages, 3)
  const imageSchema = normalizeTopicActivityFormSchema({ fields: [{ id: 'image', label: '照片', type: 'IMAGE', multiple: true, maxImages: 99 }] }, true)
  assert.equal(imageSchema.valid, true)
  if (imageSchema.valid) assert.equal(imageSchema.value.fields[0]?.maxImages, 9)
  assert.equal(normalizeTopicActivityFormSchema(schema, false).valid, false)
  assert.equal(normalizeTopicActivityFormSchema({ fields: [{ id: 'same', label: 'A', type: 'TEXT' }, { id: 'same', label: 'B', type: 'TEXT' }] }, true).valid, false)
})

test('答案校验执行必填、选项范围、图片 ID 和多图配置约束', () => {
  const normalized = normalizeTopicActivityFormSchema(schema, true)
  assert.equal(normalized.valid, true)
  if (!normalized.valid) return
  assert.equal(validateTopicActivityFormAnswers(normalized.value, { intro: '', kind: 'a' }).valid, false)
  assert.equal(validateTopicActivityFormAnswers(normalized.value, { intro: '内容', kind: 'forged', photos: [] }).valid, false)
  assert.equal(validateTopicActivityFormAnswers(normalized.value, { intro: '内容', kind: 'a', photos: ['bad space'] }).valid, false)
  const valid = validateTopicActivityFormAnswers(normalized.value, { intro: '内容', kind: 'b', photos: ['asset-1', 'asset-2'] })
  assert.equal(valid.valid, true)
  if (valid.valid) assert.deepEqual(valid.value.assetIds, ['asset-1', 'asset-2'])
})

test('只有评论审核建立 Activity+User 聚合，表单旧审核值不计入通过数', () => {
  const service = read('lib/topic-activity.ts')
  assert.match(service, /topicActivitySubmission\.count\([\s\S]*status: 'APPROVED'[\s\S]*commentDeletedAt: null/)
  assert.doesNotMatch(service, /approvedForms|reviewTopicActivityFormSubmission/)
  assert.match(service, /approvedSubmissionCount: nextCount/)
  assert.match(service, /firstParticipationCreated: previousCount === 0/)
  const participation = read('prisma/schema.prisma').match(/model TopicActivityParticipation \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(participation, /@@unique\(\[activityId, userId\]\)/)
})

test('表单可重复提交，提交答案采用版本快照，图片资产仅绑定本人未使用附件', () => {
  const schemaText = read('prisma/schema.prisma')
  const model = schemaText.match(/model TopicActivityFormSubmission \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(model, /formSchemaSnapshot\s+Json/)
  assert.match(model, /answersSnapshot\s+Json/)
  assert.doesNotMatch(model, /@@unique\(\[activityId, userId\]\)/)
  const route = read('app/api/activities/[activityId]/form-submissions/route.ts')
  assert.match(route, /uploadedByUserId: guard\.user\.id/)
  assert.match(route, /formSubmissionId: null, replyId: null/)
  assert.match(route, /startsAt && activity\.startsAt > new Date\(\)/)
  assert.match(route, /endsAt && activity\.endsAt < new Date\(\)/)
})

test('表单所有权、管理员回复权限和 Mobile Bearer 路由均在服务端验证，旧审核入口关闭', () => {
  const detail = read('app/api/topic-activity-form-submissions/[submissionId]/route.ts')
  const review = read('app/api/admin/topic-activity-form-submissions/[submissionId]/review/route.ts')
  const reply = read('app/api/admin/topic-activity-form-submissions/[submissionId]/replies/route.ts')
  const middleware = read('middleware.ts')
  assert.match(detail, /submission\.userId === auth\.user\.id/)
  assert.match(detail, /hasAdminPermission\(auth\.user, 'activity_manage'\)/)
  assert.match(review, /requireRequestAdmin\(request, 'activity_manage'\)/)
  assert.match(reply, /requireRequestAdmin\(request, 'activity_manage'\)/)
  assert.match(review, /FORM_REVIEW_DISABLED/)
  assert.doesNotMatch(review, /TOPIC_ACTIVITY_PARTICIPATION_CREATED/)
  assert.match(reply, /topic-activity-form-reply/)
  assert.ok(middleware.includes('form|my-form-submissions'))
  assert.ok(middleware.includes('topic-activity-form-submissions'))
  assert.ok(middleware.includes('topic-activity-image'))
})

test('V6 话题附件保留原图，论坛原压缩策略不变，真实格式验证和私有 COS 保持', () => {
  const upload = read('app/api/uploads/topic-activity-image/route.ts')
  const storage = read('lib/site-media-storage.ts')
  const browser = read('lib/content-image-browser.ts')
  const original = read('lib/topic-activity-image-original.ts')
  assert.match(upload, /validateContentImageFileMetadata/)
  assert.match(upload, /content-length/)
  assert.match(original, /failOn: 'error'/)
  assert.match(original, /metadata\.format/)
  assert.match(upload, /uploadPrivateSiteImage/)
  assert.match(storage, /ACL: 'private'/)
  assert.match(browser, /CONTENT_IMAGE_COMPRESSION_THRESHOLD/)
  assert.match(browser, /CONTENT_IMAGE_COMPRESSION_TARGET/)
  const topicUploader = browser.slice(browser.indexOf('export async function uploadTopicActivityImage'))
  assert.doesNotMatch(topicUploader, /prepareContentImageFile|compress/)
  assert.match(topicUploader, /form\.set\('file', file\)/)
  assert.match(upload, /body: original/)
  assert.match(upload, /size: original\.byteLength/)
  assert.match(original, /topic-activity\/\$\{safeKeyPart\(input\.activityId, 'activity'\)\}\/\$\{folder\}/)
})

test('当前 Sharp 运行时可解码 HEIF，伪装为 JPEG 的可执行字节在 magic-byte 解码处被拒绝', async () => {
  assert.equal(sharp.format.heif.input.buffer, true)
  const invalidBytes = Buffer.from('MZ\x00\x00not-an-image')
  assert.equal(validateContentImageFileMetadata({ name: 'fake.jpg', type: 'image/jpeg', size: invalidBytes.byteLength }).ok, true)
  await assert.rejects(() => sharp(invalidBytes, { failOn: 'error' }).metadata())
  assert.match(read('lib/topic-activity-image-original.ts'), /sharp\(input, \{ animated: true, failOn: 'error', limitInputPixels: 100_000_000 \}\)/)
})

test('统一图片元数据校验允许 JPEG、PNG、WEBP、GIF、HEIC、HEIF 并拒绝超限文件', () => {
  const formats = [
    ['photo.jpg', 'image/jpeg'], ['photo.jpeg', 'image/jpeg'], ['photo.png', 'image/png'],
    ['photo.webp', 'image/webp'], ['photo.gif', 'image/gif'], ['photo.heic', 'image/heic'], ['photo.heif', 'image/heif'],
  ] as const
  for (const [name, type] of formats) assert.equal(validateContentImageFileMetadata({ name, type, size: 1024 }).ok, true, `${name} should be allowed`)
  assert.equal(validateContentImageFileMetadata({ name: 'large.jpg', type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 }).ok, false)
})

test('Web 表单与管理员回复使用上传控件，不收集用户手填图片 URL', () => {
  const designer = read('components/activities/TopicActivityFormDesigner.tsx')
  const form = read('components/activities/TopicActivityFormParticipation.tsx')
  const picker = read('components/activities/TopicActivityImagePicker.tsx')
  const admin = read('app/admin/activities/TopicActivityFormSubmissionManager.tsx')
  assert.match(designer, /IMAGE/)
  assert.match(form, /TopicActivityImagePicker/)
  assert.match(admin, /TopicActivityImagePicker/)
  assert.match(picker, /type="file"/)
  assert.doesNotMatch(form + admin, /图片 URL|Image URL/i)
})

test('already-counted 只针对评论参与，表单仅展示资料和回复，select 按快照显示', () => {
  const commentReview = read('app/api/admin/topic-activity-submissions/[submissionId]/route.ts')
  const formReview = read('app/api/admin/topic-activity-form-submissions/[submissionId]/review/route.ts')
  const view = read('lib/topic-activity-form-view.ts')
  const adminList = read('app/api/admin/activities/[activityId]/form-submissions/route.ts')
  assert.match(commentReview, /body\.status === 'APPROVED' && !result\.firstParticipationCreated/)
  assert.match(formReview, /status: 410/)
  assert.match(view, /displayValue: labels\.join\('、'\)/)
  assert.match(adminList, /topicActivitySubmission\.groupBy\(\{ by: \['userId'\]/)
})
