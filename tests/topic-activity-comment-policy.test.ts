import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { resolveTopicActivityCommentEligibilityInTransaction } from '@/lib/topic-activity'
import {
  DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY,
  hasTopicActivityAdminReplyUnlock,
  resolveTopicActivityCommentEligibility,
  resolveTopicActivityCommentPolicy,
  withTopicActivityAdminReplyUnlock,
} from '@/lib/topic-activity-comment-policy'
import { normalizeTopicActivityConfig } from '@/lib/topic-activity-config'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('V6 comment policy defaults are stable and optional nested config is normalized', () => {
  assert.deepEqual(resolveTopicActivityCommentPolicy({}), DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY)
  const config = normalizeTopicActivityConfig({
    participationMode: 'BOTH',
    formSchema: {
      version: 1,
      fields: [{ id: 'name', label: '姓名', type: 'TEXT' }],
      commentPolicy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' },
    },
  }, 'TOPIC_ACTIVITY')
  assert.equal(config.valid, true)
  if (config.valid) assert.deepEqual(config.value.formSchema.commentPolicy, { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' })
  assert.equal(normalizeTopicActivityConfig({ participationMode: 'BOTH', formSchema: { fields: [{ id: 'name', label: '姓名', type: 'TEXT' }], commentPolicy: { gateMode: 'NOPE' } } }, 'TOPIC_ACTIVITY').valid, false)
})

test('eligibility evaluates lifecycle before form, admin reply, and single-use gates', () => {
  const base = { requiresForm: true, hasFormSubmission: false, hasAdminReply: false, hasUsedSingleComment: false }
  assert.equal(resolveTopicActivityCommentEligibility({ ...base, lifecycle: 'ACTIVE' }).blockReason, 'FORM_REQUIRED_BEFORE_COMMENT')
  assert.equal(resolveTopicActivityCommentEligibility({ ...base, hasFormSubmission: true, policy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'MULTIPLE' }, lifecycle: 'ACTIVE' }).blockReason, 'ADMIN_REPLY_REQUIRED')
  assert.equal(resolveTopicActivityCommentEligibility({ ...base, hasFormSubmission: true, hasAdminReply: true, policy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' }, hasUsedSingleComment: true, lifecycle: 'ACTIVE' }).blockReason, 'COMMENT_LIMIT_REACHED')
  assert.equal(resolveTopicActivityCommentEligibility({ ...base, hasFormSubmission: true, hasAdminReply: true, policy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'MULTIPLE' }, lifecycle: 'ENDED' }).blockReason, 'ACTIVITY_ENDED')
  assert.equal(resolveTopicActivityCommentEligibility({ ...base, lifecycle: 'CANCELLED' }).blockReason, 'ACTIVITY_CANCELLED')
})

test('admin reply unlock is durable and single-use history does not depend on current Reply rows', () => {
  const snapshot = withTopicActivityAdminReplyUnlock({ fields: [] }, { unlocked: true, unlockedAt: '2026-10-08T00:00:00.000Z', replyId: 'reply-1', senderUserId: 'admin-1' })
  assert.equal(hasTopicActivityAdminReplyUnlock(snapshot), true)
  assert.equal(hasTopicActivityAdminReplyUnlock({ adminReplyUnlock: true }), true)
  const service = read('lib/topic-activity.ts')
  assert.match(service, /where: \{ activityId: input\.activity\.id, userId: input\.userId \}/)
  assert.doesNotMatch(service, /activityId: input\.activity\.id, userId: input\.userId, commentId:/)
})

test('server route evaluates V6 gate before creating a root Reply and leaves nested replies on the normal path', () => {
  const route = read('app/api/posts/[postId]/replies/route.ts')
  assert.match(route, /resolveTopicActivityCommentEligibilityInTransaction\(tx/)
  assert.match(route, /if \(!parentId && lockedTopicActivity\?\.type === 'TOPIC_ACTIVITY'/)
  assert.match(route, /resolveTopicActivityCommentEligibilityInTransaction\(tx,[\s\S]*?\n\s*if \(!eligibility\.canComment\)/)
  assert.match(route, /const createdReply = await tx\.reply\.create/)
})

test('actual eligibility query preserves lifetime history and unlocks from any valid submitted form', async () => {
  const activity = {
    id: 'activity-1', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', activityPostId: 'post-1',
    startsAt: null, endsAt: null, participationMode: 'BOTH' as const,
    formSchema: { commentPolicy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' } },
  }
  let forms: Array<{ formSchemaSnapshot: Record<string, unknown>; Replies: Array<{ id: string; content: string | null; ImageAssets: Array<{ id: string }> }> }> = []
  let used = false
  const queried: Record<string, unknown>[] = []
  const tx = {
    topicActivityFormSubmission: {
      findMany: async (args: { where: Record<string, unknown> }) => { queried.push(args.where); return forms },
    },
    topicActivitySubmission: {
      findFirst: async (args: { where: Record<string, unknown> }) => { queried.push(args.where); return used ? { id: 'used-with-null-comment' } : null },
    },
  } as unknown as Prisma.TransactionClient
  const resolve = () => resolveTopicActivityCommentEligibilityInTransaction(tx, { activity, userId: 'user-1', now: new Date() })
  assert.equal((await resolve()).blockReason, 'FORM_REQUIRED_BEFORE_COMMENT')
  forms = [{ formSchemaSnapshot: {}, Replies: [] }]
  assert.equal((await resolve()).blockReason, 'ADMIN_REPLY_REQUIRED')
  forms.push({ formSchemaSnapshot: {}, Replies: [{ id: 'image-reply', content: null, ImageAssets: [{ id: 'image-1' }] }] })
  assert.equal((await resolve()).canComment, true)
  forms[1] = { formSchemaSnapshot: { adminReplyUnlock: { unlocked: true } }, Replies: [] }
  assert.equal((await resolve()).canComment, true, 'deleting the sole reply must preserve the durable unlock')
  used = true
  assert.equal((await resolve()).blockReason, 'COMMENT_LIMIT_REACHED')
  assert.ok(queried.length > 0)
  for (const where of queried) assert.deepEqual(where, { activityId: 'activity-1', userId: 'user-1' }, 'no status, deletion, or commentId filter may reset lifetime use')
})
