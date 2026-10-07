import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('活动编辑器字段标题、类型和各控件使用可见语义标签', () => {
  const editor = read('components/activities/TopicActivityFormDesigner.tsx')
  const css = read('app/globals.css')
  for (const label of ['字段标题', '字段类型', '单行文字', '多行文字', '单选', '多选', '图片']) assert.ok(editor.includes(label), `缺少编辑器文案：${label}`)
  assert.match(editor, /topic-activity-form-builder/)
  assert.match(css, /\.topic-activity-form-builder[\s\S]*--foreground/)
  assert.match(css, /:focus-visible[\s\S]*var\(--primary\)/)
  assert.match(css, /::placeholder[\s\S]*var\(--foreground-muted\)/)
  assert.doesNotMatch(editor, /dark:bg-black|dark:bg-slate-950/)
})

test('同一个全宽表单组件用于活动详情和活动主帖，字段按窄屏纵向排布', () => {
  const participation = read('components/activities/TopicActivityFormParticipation.tsx')
  const activityDetail = read('components/activities/ActivityDetailView.tsx')
  const postDetail = read('app/posts/[postId]/page.tsx')
  assert.match(participation, /id=\{`topic-activity-form-\$\{activityId\}`\}/)
  assert.match(participation, /w-full min-w-0/)
  assert.match(participation, /grid gap-2/)
  assert.match(activityDetail, /<TopicActivityFormParticipation activityId=\{activity\.id\}/)
  assert.match(activityDetail, /lg:col-span-3/)
  assert.match(postDetail, /<TopicActivityFormParticipation activityId=\{topicActivity\.id\}/)
  assert.match(postDetail, /topicActivityMode === 'FORM' \|\| topicActivityMode === 'BOTH'/)
  assert.doesNotMatch(postDetail, /href=\{`#topic-activity-form-/)
})

test('活动主帖优先展示规范化活动封面，再回退首张帖子图片，普通帖子不渲染占位', () => {
  const post = read('app/posts/[postId]/page.tsx')
  assert.match(post, /coverUrl: true/)
  assert.match(post, /publicImageUrl\(topicActivity\.coverUrl\)[\s\S]*publicImageUrl\(post\.PostMedia\[0\]/)
  assert.match(post, /topicActivity \? <section aria-label="话题活动信息"/)
  assert.match(post, /topicActivityCoverUrl \? <img/)
  assert.match(post, /topicActivity\.participationRule/)
  assert.match(post, /topicActivityMode === 'BOTH'/)
})

test('帖子管理员表单入口显示数量并复用 Activity Admin 的同一管理器', () => {
  const post = read('app/posts/[postId]/page.tsx')
  const manager = read('app/admin/activities/TopicActivityFormSubmissionManager.tsx')
  const admin = read('app/admin/activities/ActivityAdminManager.tsx')
  assert.match(post, /TopicActivityFormSubmissionEntry activityId=\{topicActivity\.id\} count=\{topicActivity\.formSubmissionCount \?\? topicActivity\._count\.TopicActivityFormSubmission\}/)
  assert.match(manager, /表单提交（\{[a-zA-Z]+\}）/)
  assert.match(manager, /<TopicActivityFormSubmissionManager activityId=\{activityId\}/)
  assert.match(admin, /TopicActivityFormSubmissionManager activityId=\{formSubmissionActivityId\}/)
  assert.match(admin, /表单提交管理/)
  assert.match(manager, /answersSnapshot\.map/)
  assert.match(manager, /TopicActivityImagePicker[\s\S]*ADMIN_REPLY/)
})

test('V5表单只查看回复，筛选按回复状态，评论审核确认保留', () => {
  const manager = read('app/admin/activities/TopicActivityFormSubmissionManager.tsx')
  const route = read('app/api/admin/activities/[activityId]/form-submissions/route.ts')
  assert.doesNotMatch(manager, /确认通过这份参与表单|确认拒绝这份参与表单|pendingReview/)
  assert.match(manager, /REPLIED/)
  assert.match(manager, /UNREPLIED/)
  assert.doesNotMatch(manager, /window\.prompt/)
  assert.match(route, /repliedForms/)
  assert.match(route, /unrepliedForms/)
  assert.match(read('components/PostRepliesSection.tsx'), /确认通过这条参与内容/)
})

test('Topic Activity 自动审核/回复通知使用系统身份，普通社交通知不变', () => {
  const commentReview = read('app/api/admin/topic-activity-submissions/[submissionId]/route.ts')
  const formReview = read('app/api/admin/topic-activity-form-submissions/[submissionId]/review/route.ts')
  const formReply = read('app/api/admin/topic-activity-form-submissions/[submissionId]/replies/route.ts')
  const notificationUi = read('app/notifications/NotificationsClient.tsx')
  assert.match(commentReview, /actorId: null/)
  assert.match(formReview, /FORM_REVIEW_DISABLED/)
  assert.doesNotMatch(formReview, /createManyNotifications/)
  assert.match(formReply, /actorId: null/)
  assert.match(notificationUi, /item\.actorUid === null/)
  assert.match(notificationUi, /siteLogoUrl/)
  assert.match(formReply, /senderUserId: guard\.user!\.id/)
})

test('Topic Activity UI 回归保护既有活动模型和 migration，允许其他模块的 additive migration', () => {
  // A worktree-wide Prisma prohibition falsely rejects unrelated, legitimate
  // additions such as Cantonese progress. Keep the guard on Topic's own data.
  const gitOptions = { cwd: root, encoding: 'utf8' as const }
  const migrations = execFileSync('git', ['diff', '--name-only', 'HEAD', '--',
    'prisma/migrations/20261005120000_add_topic_activity_system',
    'prisma/migrations/20261005150000_add_topic_activity_forms_replies',
  ], gitOptions)
  assert.equal(migrations.trim(), '')
  const before = execFileSync('git', ['show', 'HEAD:prisma/schema.prisma'], gitOptions)
  const after = read('prisma/schema.prisma')
  const topicSchema = (schema: string) => ({
    modelsAndEnums: [...schema.matchAll(/^(?:model|enum) (?:TopicActivity\w*|Activity\w*) \{[\s\S]*?^\}/gm)].map((match) => match[0]),
    relations: schema.split(/\r?\n/).filter((line) => /TopicActivity/.test(line)),
  })
  assert.ok(topicSchema(before).modelsAndEnums.length > 0)
  assert.deepEqual(topicSchema(after), topicSchema(before))
})
