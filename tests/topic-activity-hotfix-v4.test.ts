import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { readTopicLotteryMigrationPhases } from '../scripts/topic-lottery-migration-plan'

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
  assert.match(read('components/activities/ReviewConfirmDialog.tsx'), /确认通过这条参与内容/)
  assert.match(read('components/PostRepliesSection.tsx'), /ReviewConfirmDialog/)
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

test('Topic Activity V2 additive schema preserves every existing activity field and historical migration', () => {
  // Keep Topic's historical schema guard while explicitly allowing this
  // feature's separate, reviewable concert models and enums.
  const gitOptions = { cwd: root, encoding: 'utf8' as const }
  const migrations = execFileSync('git', ['diff', '--name-only', 'cbc22ce4d0feac91aae124205780c6ae3ac2b871', '--',
    'prisma/migrations/20261005120000_add_topic_activity_system',
    'prisma/migrations/20261005150000_add_topic_activity_forms_replies',
  ], gitOptions)
  assert.equal(migrations.trim(), '')
  const after = read('prisma/schema.prisma')
  const blocks = (schema: string) => new Map([...schema.replace(/\r\n/g, '\n').matchAll(/^(?:model|enum) (\w+) \{([\s\S]*?)^\}/gm)].map((match) => [match[1], match[2].split('\n').map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean)]))
  const currentMainSha = '80b62a5938aba4d2b50075ed0ed55da169c94f4d'
  const currentMainBlocks = blocks(execFileSync('git', ['show', `${currentMainSha}:prisma/schema.prisma`], gitOptions))
  const approvedSourceBlocks = blocks(execFileSync('git', ['show',
    'cbc22ce4d0feac91aae124205780c6ae3ac2b871:prisma/schema.prisma'], gitOptions))
  const newBlocks = blocks(after)
  // Exact reviewed expansion for private duration events. All other models,
  // fields, indexes and historical migration bytes retain the original guard.
  const originalMusicFields = currentMainBlocks.get('MusicPlayRecord')!
  const reviewedMusicFields = originalMusicFields.flatMap((field) => {
    if (field === 'playedAt DateTime @default(now())') return [field,
      'source MusicPlaySource @default(ONLINE)', 'eventId String? @db.VarChar(191)',
      'startedAt DateTime?', 'endedAt DateTime?']
    if (field === 'trackId String') return ['trackId String?']
    if (field === 'MusicTrack MusicTrack @relation(fields: [trackId], references: [id], onDelete: Cascade)') {
      return ['MusicTrack MusicTrack? @relation(fields: [trackId], references: [id], onDelete: Cascade)']
    }
    return [field]
  }).concat(['@@index([userId, source, playedAt])', '@@index([userId, startedAt, endedAt])',
    '@@unique([userId, eventId], map: "MusicPlayRecord_userId_eventId_key")'])
  assert.deepEqual(newBlocks.get('MusicPlayRecord'), reviewedMusicFields, 'only reviewed listening fields and nullable track relation differ')
  assert.deepEqual(newBlocks.get('MusicPlaySource'), ['ONLINE', 'LOCAL'])
  const listeningMigration = read('prisma/migrations/20261117110000_add_music_listening_stats/migration.sql')
  assert.match(listeningMigration, /MODIFY `trackId` VARCHAR\(191\) NULL/)
  assert.match(listeningMigration, /ENUM\('ONLINE', 'LOCAL'\) NOT NULL DEFAULT 'ONLINE'/)
  assert.match(listeningMigration, /ADD UNIQUE INDEX `MusicPlayRecord_userId_eventId_key` \(`userId`, `eventId`\)/)
  assert.doesNotMatch(listeningMigration, /\b(?:DROP|TRUNCATE|DELETE|RENAME)\b/i)
  // Preserve every field already on current main, while separately ensuring
  // the reviewed V2 source fields remain present. Comparing cbc directly to
  // current main would incorrectly reject unrelated additive fields added later.
  for (const [name, fields] of currentMainBlocks) {
    assert.ok(newBlocks.has(name), `existing model/enum ${name} retained`)
    if (name === 'MusicPlayRecord') continue // Exact full model comparison above.
    for (const field of fields) assert.ok(newBlocks.get(name)!.includes(field), `existing field/index unchanged: ${name}.${field}`)
  }
  const v2Models = ['TopicActivityPollVote', 'TopicActivityRewardEntry', 'TopicActivityTestAttempt',
    'TopicActivityLottery', 'TopicActivityLotteryEligibility', 'TopicActivityLotteryDraw', 'TopicActivityLotterySlot',
    'TopicActivityLotteryShipping', 'TopicActivityLotteryNotice', 'TopicActivityLotteryAudit']
  const concertSchemaBlocks = [
    'ConcertEvent', 'ConcertShow', 'ConcertTimelineEvent', 'ConcertShowMark',
    'ConcertTutorial', 'ConcertReminderSubscription', 'ConcertEventStatus',
    'ConcertShowStatus', 'ConcertTimelineType', 'ConcertTutorialType',
    'ConcertTutorialStatus', 'ConcertReminderTargetType',
  ]
  for (const name of v2Models) {
    const approvedFields = approvedSourceBlocks.get(name)
    assert.ok(approvedFields, `approved V2 source contains ${name}`)
    for (const field of approvedFields) assert.ok(newBlocks.get(name)?.includes(field), `approved V2 field retained: ${name}.${field}`)
  }
  const syncFields = newBlocks.get('SocialSyncState')
  assert.ok(syncFields, 'Instagram sync state model retained')
  assert.equal(syncFields.filter((field) => field === 'leaseGeneration BigInt @default(0)').length, 1, 'only the reviewed lease generation field is added')

  const restoredHistoricalFields = new Map<string, string[]>([
    ['CantoneseQuestion', ['learnerProgress CantoneseLearnerQuestionProgress[]']],
    ['Post', ['ProfilePostViewHistory ProfilePostViewHistory[]']],
    ['User', ['ProfilePostViewHistory ProfilePostViewHistory[]', 'CantoneseQuestionProgress CantoneseLearnerQuestionProgress[]']],
    ['UserPrivacySetting', ['showFavorites Boolean @default(true)']],
  ])
  for (const [name, fields] of restoredHistoricalFields) {
    for (const field of fields) {
      assert.ok(newBlocks.get(name)?.includes(field), `restored historical schema field retained: ${name}.${field}`)
    }
  }
  const restoredHistoricalModels = new Map<string, string[]>([
    ['CantoneseLearnerQuestionProgress', [
      'id String @id @default(cuid())',
      'userId String',
      'questionId String @db.VarChar(191)',
      'attemptCount Int @default(0)',
      'correctCount Int @default(0)',
      'wrongCount Int @default(0)',
      'consecutiveCorrect Int @default(0)',
      'mastery String @default("NEW") @db.VarChar(16)',
      'lastWrongAt DateTime?',
      'lastCorrectAt DateTime?',
      'lastAnsweredAt DateTime?',
      'lastAnswerCorrect Boolean @default(false)',
      'lastWrongAnswer Json?',
      'createdAt DateTime @default(now())',
      'updatedAt DateTime @updatedAt',
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
      'question CantoneseQuestion @relation(fields: [questionId], references: [externalId], onDelete: Cascade)',
      '@@unique([userId, questionId])',
      '@@index([userId, mastery, lastWrongAt])',
      '@@index([questionId])',
    ]],
    ['ProfilePostViewHistory', [
      'id String @id @default(cuid())',
      'userId String',
      'postId String',
      'viewedAt DateTime @default(now())',
      'User User @relation(fields: [userId], references: [id], onDelete: Cascade)',
      'Post Post @relation(fields: [postId], references: [id], onDelete: Cascade)',
      '@@unique([userId, postId])',
      '@@index([userId, viewedAt])',
      '@@index([postId])',
    ]],
  ])
  for (const [name, fields] of restoredHistoricalModels) {
    assert.deepEqual(newBlocks.get(name), fields, `restored historical model ${name} matches its recorded schema`)
  }
  const restoredMigrations = [
    {
      name: '20261022090000_profile_mobile_contract',
      blobSha: '01f80ce19b9ae170834235bc93c46ee24b519c71',
    },
    {
      name: '20261023090000_cantonese_question_progress',
      blobSha: '7ce5b245114bb12e48969f28f21761b446f39233',
    },
  ]
  for (const migration of restoredMigrations) {
    const file = `prisma/migrations/${migration.name}/migration.sql`
    const actualBlobSha = execFileSync('git', ['hash-object', file], gitOptions).trim()
    assert.equal(actualBlobSha, migration.blobSha, `restored historical migration retains its recorded blob: ${migration.name}`)
  }

  const comparableBlocks = new Map(newBlocks)
  comparableBlocks.set('MusicPlayRecord', originalMusicFields)
  comparableBlocks.delete('MusicPlaySource')
  comparableBlocks.set('SocialSyncState', syncFields.filter((field) => field !== 'leaseGeneration BigInt @default(0)'))
  for (const [name, fields] of restoredHistoricalFields) {
    comparableBlocks.set(name, comparableBlocks.get(name)!.filter((field) => !fields.includes(field)))
  }
  comparableBlocks.delete('CantoneseLearnerQuestionProgress')
  comparableBlocks.delete('ProfilePostViewHistory')
  const memoirRelations = {
    Activity: ['annualMemoirConfig AnnualMemoirConfig?', 'annualMemoirReservations AnnualMemoirReservation[]', 'annualMemoirSnapshots AnnualMemoirSnapshot[]'],
    User: ['annualMemoirReservations AnnualMemoirReservation[]', 'annualMemoirSnapshots AnnualMemoirSnapshot[]'],
  }
  for (const [model, fields] of Object.entries(memoirRelations)) {
    assert.deepEqual(comparableBlocks.get(model)!.filter((field) => field.startsWith('annualMemoir')), fields)
    comparableBlocks.set(model, comparableBlocks.get(model)!.filter((field) => !fields.includes(field)))
  }
  for (const name of ['AnnualMemoirConfig', 'AnnualMemoirReservation', 'AnnualMemoirSnapshot']) {
    assert.ok(comparableBlocks.delete(name), `required memoir model retained: ${name}`)
  }
  const memoirMigration = read('prisma/migrations/20261121120000_add_annual_memoir/migration.sql')
  assert.doesNotMatch(memoirMigration, /\b(?:DROP|RENAME|TRUNCATE|DELETE\s+FROM|UPDATE\s+`)\b/i)
  assert.match(memoirMigration, /UNIQUE INDEX `AnnualMemoirReservation_activityId_userId_key`/)
  assert.match(memoirMigration, /UNIQUE INDEX `AnnualMemoirSnapshot_userId_year_key`/)
  const pointActions = currentMainBlocks.get('PointActionType')!
  assert.deepEqual(comparableBlocks.get('PointActionType'), [...pointActions, 'SHUN_STEAL', 'SHUN_RECOVERY', 'SHUN_COMPENSATION',
    // V5 approved additive value: the platform-funded capture bonus.
    '/// Platform-funded bonus paid on top of a successful capture. Never debits the',
    "/// caught player and never draws on another player's balance.",
    'SHUN_BONUS',
    // Leaderboard automatic rewards approved additive values.
    '/// Automatic leaderboard weekly reward (entertainment / comment / aspirin).',
    'LEADERBOARD_WEEKLY_REWARD',
    '/// Automatic entertainment leaderboard monthly extra reward.',
    'LEADERBOARD_MONTHLY_REWARD'])
  comparableBlocks.set('PointActionType', pointActions)
  // Leaderboard automatic reward additive models (config / run gate / cap / audit).
  for (const name of ['LeaderboardRewardSettings', 'LeaderboardSettlementRun', 'LeaderboardWeeklyCapUsage',
    'LeaderboardRewardGrant', 'LeaderboardBadgeGrant']) {
    assert.ok(comparableBlocks.delete(name), `leaderboard reward model registered: ${name}`)
  }
  for (const name of ['ShunMasterSettings', 'ShunMasterMember', 'ShunMasterConsent', 'ShunMasterProtection', 'ShunMasterRound',
    'ShunMasterAnonymousLetter']) {
    assert.ok(comparableBlocks.delete(name), `required Shun Master model retained: ${name}`)
  }
  // V5 approved additive model: the signed counter note left by a capturer.
  assert.ok(comparableBlocks.delete('ShunMasterCaptureLetter'), 'V5 capture counter note model registered')
  // V5 approved additive BadgeRuleType values: the three cumulative Shun rules.
  const badgeRuleTypes = currentMainBlocks.get('BadgeRuleType')!
  assert.deepEqual(comparableBlocks.get('BadgeRuleType'), [...badgeRuleTypes,
    '/// Cumulative registration fee successfully taken through Shun Master.',
    'SHUN_STOLEN_TOTAL',
    '/// Cumulative registration fee taken away from this user through Shun Master.',
    'SHUN_VICTIM_TOTAL',
    '/// Cumulative registration fee actually recovered by a successful capture.',
    '/// The platform bonus is deliberately excluded from this metric.',
    'SHUN_RECOVERED_TOTAL'])
  comparableBlocks.set('BadgeRuleType', badgeRuleTypes)
  // V4.1 approved additive field: the irreversible Shun Master opt-out. It is a
  // nullable column (no history rewrite), registered here exactly like the
  // other reviewed additive fields so the snapshot guard still rejects anything
  // genuinely unapproved.
  const optOutField = 'permanentlyOptedOutAt DateTime?'
  assert.ok(newBlocks.get('User')?.includes(optOutField), 'approved permanent opt-out field retained')
  const userFields = comparableBlocks.get('User')!
  const optOutCommentLines = userFields.filter((field) =>
    field.startsWith('/// Permanent, irreversible opt-out') || field.startsWith('/// user participates by default'))
  assert.equal(optOutCommentLines.length, 2, '新增字段必须带不可撤销说明注释')
  comparableBlocks.set('User', userFields.filter((field) =>
    field !== optOutField && !optOutCommentLines.includes(field)))
  // Mobile push delivery is an approved additive schema change: two enums and
  // two new tables only, no edits to any pre-existing block.
  for (const name of ['MobilePushTokenStatus', 'MobilePushToken', 'MobilePushDeliveryStatus', 'MobilePushDelivery']) {
    assert.ok(comparableBlocks.delete(name), `mobile push schema block registered: ${name}`)
  }
  // V4.2 changes are independently checked against their exact additive footprint.
  for (const [model, index] of [
    ['DirectMessage', '@@index([type, createdAt, id], map: "DirectMessage_shun_share_scan_idx")'],
    ['GrowthTaskCompletion', '@@index([createdAt, id], map: "GrowthTaskCompletion_shun_scan_idx")'],
  ] as const) {
    const fields = comparableBlocks.get(model)!
    assert.equal(fields.filter((field) => field === index).length, 1)
    comparableBlocks.set(model, fields.filter((field) => field !== index))
  }
  for (const [model, relation] of [
    ['ShunItemConfigVersion', 'giftIntents ShunItemGiftIntent[]'],
    ['ShunItemGift', 'intent ShunItemGiftIntent?'],
  ] as const) {
    const fields = comparableBlocks.get(model)!
    assert.equal(fields.filter((field) => field === relation).length, 1)
    comparableBlocks.set(model, fields.filter((field) => field !== relation))
  }
  // V4.2.1 approved additive footprint: dual gift reward. Nothing pre-existing
  // is edited — one enum value, one nullable intent column, one nullable gift
  // column plus its relation, and one history index. Registered explicitly so
  // any other unapproved schema change is still rejected below.
  comparableBlocks.set('ShunItemEventType', comparableBlocks.get('ShunItemEventType')!
    .filter((value) => value !== 'GIFT_REWARD' && value !== 'ADMIN_GRANT'))
  assert.ok(newBlocks.get('ShunItemEventType')?.includes('GIFT_REWARD'), 'V4.2.1 gift reward event registered')
  assert.ok(newBlocks.get('ShunItemEventType')?.includes('ADMIN_GRANT'), 'V4.2.3 admin grant event registered')
  // V4.2.3 approved additive footprint: three tables for the admin batch grant.
  // Nothing pre-existing is edited; the enum value above is the only other change.
  for (const model of ['ShunItemGrantTask', 'ShunItemGrantTaskItem', 'ShunItemGrant']) {
    assert.ok(comparableBlocks.delete(model), `V4.2.3 admin grant model registered: ${model}`)
    assert.ok(newBlocks.has(model), `V4.2.3 admin grant model present: ${model}`)
  }
  comparableBlocks.set('ShunItemGiftIntent', comparableBlocks.get('ShunItemGiftIntent')!
    .filter((field) => field !== 'senderCode ShunItemCode?'))
  comparableBlocks.set('ShunItemGift', comparableBlocks.get('ShunItemGift')!.filter((field) =>
    field !== 'rewardEntryId String? @unique'
    && field !== 'rewardEntry ShunItemEntry? @relation("ShunItemGiftReward", fields: [rewardEntryId], references: [id])'))
  comparableBlocks.set('ShunItemEntry', comparableBlocks.get('ShunItemEntry')!.filter((field) =>
    field !== 'rewardedGift ShunItemGift? @relation("ShunItemGiftReward")'
    && field !== '@@index([userId, type, createdAt])'))
  for (const [name, required] of [
    ['ShunItemGiftIntent', 'senderCode ShunItemCode?'],
    ['ShunItemGift', 'rewardEntryId String? @unique'],
    ['ShunItemEntry', '@@index([userId, type, createdAt])'],
  ] as const) {
    assert.ok(newBlocks.get(name)?.includes(required), `V4.2.1 additive field registered: ${name}.${required}`)
  }
  for (const model of ['ShunItemGiftIntent', 'ShunItemGiftIntentStatus']) {
    assert.ok(comparableBlocks.delete(model), `required gift intent schema block retained: ${model}`)
  }
  const approvedShunItems = blocks(execFileSync('git', ['show',
    '1d5a266a833fb99c843900eb5dd96f7c0865ff60:prisma/schema.prisma'], { encoding: 'utf8' }))
  for (const name of ['ShunItemCode', 'ShunItemEventType', 'ShunItemConfigVersion', 'ShunItemDefinition',
    'ShunItemInventory', 'ShunItemPending', 'ShunItemEntry', 'ShunItemDaily', 'ShunItemDailyCounter',
    'ShunItemWeeklyGrant', 'ShunItemGift', 'ShunItemRoundEffect', 'ShunItemRewardEvent']) {
    assert.ok(approvedShunItems.has(name), `approved Shun V4.2 source contains ${name}`)
    assert.deepEqual(comparableBlocks.get(name), approvedShunItems.get(name), `Shun V4.2 schema block retained: ${name}`)
    comparableBlocks.delete(name)
  }
  // Live Photo Web additive footprint: one media table, one status enum, one
  // media enum value and nullable PostMedia/User relations. The asset id is
  // also encoded in the controlled URL so legacy databases can still read.
  for (const name of ['LivePhotoAsset', 'LivePhotoAssetStatus']) {
    assert.ok(newBlocks.has(name), `live photo schema block present: ${name}`)
    assert.ok(comparableBlocks.delete(name), `live photo schema block registered: ${name}`)
  }
  comparableBlocks.set('MediaType', comparableBlocks.get('MediaType')!.filter((value) => value !== 'LIVE_PHOTO'))
  assert.ok(newBlocks.get('MediaType')?.includes('LIVE_PHOTO'))
  comparableBlocks.set('PostMedia', comparableBlocks.get('PostMedia')!.filter((field) =>
    field !== 'livePhotoId String?'
    && field !== 'LivePhoto LivePhotoAsset? @relation(fields: [livePhotoId], references: [id], onDelete: SetNull)'
    && field !== '@@index([livePhotoId])'))
  comparableBlocks.set('User', comparableBlocks.get('User')!.filter((field) =>
    field !== 'LivePhotoAssets LivePhotoAsset[] @relation("LivePhotoAssetOwner")'))
  assert.deepEqual([...comparableBlocks], [...currentMainBlocks], 'all unapproved schema content remains unchanged')
  const pushMigration = read('prisma/migrations/20261126040000_add_mobile_push_tokens/migration.sql')
  assert.match(pushMigration, /CREATE TABLE `MobilePushToken`/)
  assert.match(pushMigration, /CREATE TABLE `MobilePushDelivery`/)
  assert.doesNotMatch(pushMigration, /\b(?:DROP|RENAME|TRUNCATE|DELETE\s+FROM)\b/i)
  for (const name of concertSchemaBlocks) assert.ok(newBlocks.has(name), `concert schema block retained: ${name}`)
  for (const name of v2Models) assert.ok(newBlocks.has(name), `required V2 table retained: ${name}`)
  const additive = read('prisma/migrations/20261013100000_add_topic_activity_v2_web/migration.sql')
  assert.doesNotMatch(additive, /\b(?:DROP|RENAME|TRUNCATE|DELETE|UPDATE)\s+(?:TABLE|COLUMN|FROM|`)/i)
  assert.match(additive, /TopicReward_activity_entry_user_key/)
  const lottery = readTopicLotteryMigrationPhases(root).map((phase) => phase.sql).join('\n')
  assert.doesNotMatch(lottery, /\b(?:DROP|RENAME|TRUNCATE|DELETE|UPDATE)\s+(?:TABLE|COLUMN|FROM|`)/i)
  assert.match(lottery, /TopicLotteryEligibility_activity_user_key/)
  assert.match(lottery, /TopicLotteryDraw_activity_key/)
  assert.match(lottery, /TopicLotteryWinner_slot_key/)
})
