import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTopicActivityFormSchema, validateTopicActivityFormAnswers, validateTopicActivityFormAttachments } from '@/lib/topic-activity-form'
import { replyMinimumContentError } from '@/lib/reply-length'
import { matchesTopicReviewFilter, topicReviewCountForFilter, topicReviewFilter, topicReviewCountsFromGroups } from '@/lib/topic-review-filter'

test('V6.1.1 text normalization, graphemes and image/sticker exceptions are identical before confirmation', () => {
  for (const text of ['字', '\n \t ', '👩‍👩‍👧‍👦', '<script>xx</script>字']) assert.match(replyMinimumContentError(text, 0, false, '参与评论') || '', /至少需要 2 个字符/)
  for (const text of ['两个', '👍👍', '  ab \n']) assert.equal(replyMinimumContentError(text, 0, false), null)
  assert.equal(replyMinimumContentError('', 1, false), null)
  assert.equal(replyMinimumContentError('', 0, true), null)
})

test('V6.1.1 form IMAGE quantity is field-specific independently of extra/comment attachments', () => {
  for (const allowAttachments of [false, true]) {
    const single = normalizeTopicActivityFormSchema({ fields: [{ id: 'image', label: '截图', type: 'IMAGE', required: true, maxImages: 1 }] }, allowAttachments)
    assert.equal(single.valid, true)
    if (!single.valid) return
    assert.equal(validateTopicActivityFormAnswers(single.value, { image: ['asset-1'] }).valid, true)
    const exceeded = validateTopicActivityFormAnswers(single.value, { image: ['asset-1', 'asset-2'] })
    assert.equal(exceeded.valid, false)
    if (!exceeded.valid) assert.match(exceeded.message, /最多上传 1 张/)
    assert.equal(validateTopicActivityFormAttachments(['global-1'], allowAttachments).valid, allowAttachments)
    const multi = normalizeTopicActivityFormSchema({ fields: [{ id: 'image', label: '历史多图字段', type: 'IMAGE', multiple: true, maxImages: 3 }] }, allowAttachments)
    assert.equal(multi.valid, true)
    if (!multi.valid) return
    assert.equal(multi.value.fields[0].maxImages, 3)
    assert.equal(validateTopicActivityFormAnswers(multi.value, { image: ['a', 'b', 'c'] }).valid, true)
    assert.equal(validateTopicActivityFormAnswers(multi.value, { image: ['a', 'b', 'c', 'd'] }).valid, false)
  }
})

test('V6.1.1 review filters have no own-author bypass and approved/rejected leave PENDING immediately', () => {
  assert.deepEqual(topicReviewFilter('activity-1', 'PENDING'), { TopicActivitySubmission: { is: { activityId: 'activity-1', status: 'PENDING' } } })
  assert.deepEqual(topicReviewFilter('activity-1', null), {})
  const own = { authorId: 'admin-1', topicActivitySubmission: { status: 'PENDING' as const } }
  assert.equal(matchesTopicReviewFilter(own, 'PENDING'), true)
  for (const status of ['APPROVED', 'REJECTED'] as const) {
    const updated = { ...own, topicActivitySubmission: { status } }
    assert.equal(matchesTopicReviewFilter(updated, 'PENDING'), false)
    assert.equal(matchesTopicReviewFilter(updated, status), true)
    assert.equal(matchesTopicReviewFilter(updated, 'ALL'), true)
  }
  assert.deepEqual(topicReviewCountsFromGroups([{ status: 'PENDING', _count: { _all: 2 } }, { status: 'APPROVED', _count: { _all: 1 } }]), { PENDING: 2, APPROVED: 1, REJECTED: 0, WITHDRAWN: 0 })
  const counts = topicReviewCountsFromGroups([{ status: 'PENDING', _count: { _all: 2 } }, { status: 'APPROVED', _count: { _all: 1 } }], 5)
  assert.equal(topicReviewCountForFilter(counts, 'ALL'), 5, 'ALL must include ordinary roots without a Submission')
  assert.equal(topicReviewCountForFilter(counts, 'APPROVED'), 1)
})
