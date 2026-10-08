import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('V5 表单提交保持折叠、历史和图片资产边界', () => {
  const form = read('components/activities/TopicActivityFormParticipation.tsx')
  const picker = read('components/activities/TopicActivityImagePicker.tsx')

  assert.match(form, /TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT/u)
  assert.match(form, /表单已提交成功。/u)
  assert.match(form, /请按活动要求完成分享后，将截图发布到下方评论区等待审核。/u)
  assert.match(form, /attachmentAssetIds/u)
  assert.match(form, /attachmentAssets\.map\([\s\S]*assetId/u)
  assert.match(form, /answersSnapshot\.map/u)
  assert.match(form, /answer\.type === 'IMAGE'/u)
  assert.match(picker, /onUploadingChange/u)
  assert.match(picker, /uploadingRef/u)
})

test('V5 管理器按回复状态和用户筛选，保留 schema IMAGE 与回复附件', () => {
  const manager = read('app/admin/activities/TopicActivityFormSubmissionManager.tsx')

  assert.match(manager, /replyStatus/u)
  assert.match(manager, /ALL/u)
  assert.match(manager, /REPLIED/u)
  assert.match(manager, /UNREPLIED/u)
  assert.match(manager, /userId/u)
  assert.match(manager, /answersSnapshot\.map/u)
  assert.match(manager, /answer\.type === 'IMAGE'/u)
  assert.match(manager, /attachments/u)
  assert.match(manager, /cache: 'no-store'/u)
  assert.match(manager, /TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT/u)
  assert.match(manager, /submittedEvent\.detail\?\.activityId === activityId/u)
  assert.match(manager, /topic-activity-admin-forms-\$\{activityId\}/u)
  assert.match(manager, /userId\?: string/u)
  assert.doesNotMatch(manager, /pendingReview/u)
})

test('V5 活动详情和后台使用新的参与方式语义，并区分表单与评论数量', () => {
  const detail = read('components/activities/ActivityDetailView.tsx')
  const admin = read('app/admin/activities/ActivityAdminManager.tsx')

  for (const label of ['评论审核', '先填表单后发评论审核', '表单与评论，评论为最终凭证']) {
    assert.ok(detail.includes(label), `活动详情缺少参与方式文案：${label}`)
    assert.ok(admin.includes(label), `活动后台缺少参与方式文案：${label}`)
  }
  assert.match(detail, /formSubmissionCount\?: number/u)
  assert.match(detail, /尚未提交参与评论/u)
  assert.match(detail, /参与评论 \$\{initialTopicParticipation\.submissionCount\} 条/u)
  assert.match(detail, /activityPostId=\{activity\.activityPostId\}/u)
  assert.doesNotMatch(detail, /填写参与表单/u)
})

test('V5 活动主帖按有效评论重算参与人数，并支持管理员表单用户深链', () => {
  const post = read('app/posts/[postId]/page.tsx')

  assert.match(post, /formUserId\?: string/u)
  assert.match(post, /topicActivitySubmission\.findMany/u)
  assert.match(post, /status: 'APPROVED'/u)
  assert.match(post, /commentDeletedAt: null/u)
  assert.match(post, /Comment: \{ is: \{ parentId: null, isDeleted: false \} \}/u)
  assert.match(post, /topicActivityFormSubmission\.groupBy/u)
  assert.match(post, /by: \['activityId', 'userId'\]/u)
  assert.match(post, /formSubmissionCount/u)
  assert.match(post, /activityPostId=\{post\.id\}/u)
  assert.match(post, /userId=\{formUserId\}/u)
  assert.doesNotMatch(post, /href=\{`#topic-activity-form-\$\{topicActivity\.id\}`\}/u)
})
