import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { parseTopicCommentEligibility, topicCommentBlockMessage } from '@/lib/topic-comment-ui'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('V6 UI consumes the canonical DTO and fails closed for incomplete eligibility', () => {
  const dto = parseTopicCommentEligibility({
    topicActivity: {
      commentPolicy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' },
      currentUserEligibility: {
        requiresForm: true,
        gateMode: 'AFTER_ADMIN_REPLY',
        commentLimit: 'SINGLE',
        hasFormSubmission: true,
        hasAdminReply: false,
        canComment: false,
        blockReason: 'ADMIN_REPLY_REQUIRED',
        hasUsedSingleComment: false,
      },
    },
  })
  assert.ok(dto)
  assert.equal(dto.policy.requiresForm, true)
  assert.equal(dto.eligibility.blockReason, 'ADMIN_REPLY_REQUIRED')
  assert.equal(parseTopicCommentEligibility({ topicActivity: { commentPolicy: { gateMode: 'AFTER_FORM_SUBMIT', commentLimit: 'MULTIPLE' } } }), null)
  assert.equal(topicCommentBlockMessage('ACTIVITY_NOT_STARTED'), '活动尚未开始，不能发表评论。')
})

test('V6 comment UI refreshes eligibility, opens the form through the canonical event, and guards SINGLE submission', () => {
  const section = read('components/PostRepliesSection.tsx')
  const replyForm = read('components/ReplyForm.tsx')

  for (const marker of [
    'cache: \'no-store\'',
    'window.addEventListener(\'focus\'',
    'window.addEventListener(\'pageshow\'',
    'ecfc:topic-activity-form-submitted',
    'ecfc:topic-activity-admin-replied',
    'ecfc:topic-activity-open-form',
    'beforeSingleCommentSubmit',
    'singleCommentDecisionRef.current = null',
    '[pathname, postId, topicActivityId]',
    'topicEligibilityLoading || topicEligibilityError',
    'topicEligibilityLoadedKey !== topicEligibilityKey',
    'topicEligibilityLoadedKey === topicEligibilityKey',
    'COMMENT_LIMIT_REACHED',
    'setTopicEligibility((current)',
  ]) assert.match(section, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(replyForm, /beforeSubmit\?: \(\) => boolean \| Promise<boolean>/u)
  assert.match(replyForm, /await beforeSubmit\(\)/u)
  assert.doesNotMatch(section, /window\.(confirm|prompt|close)/u)
  assert.doesNotMatch(section, /history\.back/u)
  assert.match(section, /reviewLoadingRef\.current/u)
})

test('V6 review and SINGLE dialogs are controlled, explicit button actions', () => {
  const review = read('components/activities/ReviewConfirmDialog.tsx')
  const single = read('components/activities/SingleCommentConfirmDialog.tsx')
  for (const source of [review, single]) {
    assert.match(source, /type="button"/gu)
    assert.doesNotMatch(source, /window\.(confirm|prompt|close)/u)
    assert.doesNotMatch(source, /history\.back/u)
  }
  assert.match(review, /确认通过/u)
  assert.match(review, /确认拒绝/u)
  assert.match(review, /拒绝原因（可选）/u)
  assert.match(single, /返回检查/u)
  assert.match(single, /确认发送/u)
  assert.match(review, /event\.key === 'Tab'/u)
  assert.match(single, /event\.key === 'Tab'/u)
})
