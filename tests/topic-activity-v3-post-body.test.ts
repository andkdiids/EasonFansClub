import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildTopicActivityPostContent, syncActivityPostInTransaction } from '@/lib/topic-activity'
import { topicPostSyncFixture } from './fixtures/topic-post-sync'

test('new topic post uses real description only, without generated participation/time/reward metadata', async () => {
  const f = topicPostSyncFixture()
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  assert.equal(f.post.content, f.activity.description)
  assert.doesNotMatch(f.post.content!, /参与方式\n|活动时间\n|活动奖励\n/)
  assert.equal(f.post.title, f.activity.title)
  assert.equal(f.writes[0].action, 'create')
  assert.equal(f.activity.activityPostId, 'local-post')
})

test('config resync never reinserts metadata or overwrites a new topic body with changed settings', async () => {
  const f = topicPostSyncFixture()
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  const body = f.post.content
  f.activity.description = '修改后的活动配置说明'
  f.activity.participationRule = '修改后的参与规则'
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  assert.equal(f.post.content, body, 'post body remains an independent authored document after creation')
  assert.equal(Object.hasOwn(f.writes.at(-1)!.data, 'content'), false)
  assert.equal(Object.hasOwn(f.writes.at(-1)!.data, 'richContent'), false)
})

test('historical legacy template stays byte-for-byte intact without per-record provenance', async () => {
  const template = topicPostSyncFixture()
  const legacy = buildTopicActivityPostContent(template.activity, ['本地勋章'])
  assert.equal(legacy, [template.activity.description, '参与方式\n上传活动相关截图', '活动时间\n2026年10月1日 08:00 — 2026年10月31日 08:00', '活动奖励\n13 挂号费、本地勋章（审核通过后发放）'].join('\n\n'))
  const f = topicPostSyncFixture('TOPIC_ACTIVITY', legacy)
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  assert.equal(f.post.content, legacy)
})

for (const body of ['我觉得这个活动的参与方式很简单，活动时间也很合适。', '参与方式', '活动时间', '本地话题活动', '测试\n参与方式\n活动时间', '<p data-author="user">真正正文</p>']) {
  test(`authored topic body is never heuristically filtered: ${body}`, async () => {
    const f = topicPostSyncFixture('TOPIC_ACTIVITY', body)
    f.post.richContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] }
    const originalRich = structuredClone(f.post.richContent)
    await syncActivityPostInTransaction(f.tx, f.activity.id)
    assert.equal(f.post.content, body)
    assert.deepEqual(f.post.richContent, originalRich)
  })
}

test('ordinary non-topic linked posts retain the existing adapter behavior', async () => {
  const f = topicPostSyncFixture('ONLINE', '原有普通活动正文')
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  assert.equal(f.post.content, buildTopicActivityPostContent(f.activity, ['本地勋章']))
})

test('draft/cancellation lifecycle and topic metadata card are preserved independently of body', async () => {
  const f = topicPostSyncFixture('TOPIC_ACTIVITY', '手写正文')
  f.activity.status = 'CANCELLED'
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  assert.equal(f.post.content, '手写正文')
  assert.equal(f.writes[0].action, 'updateMany')
  assert.deepEqual(f.writes[0].data, { isDeleted: true, deletedAt: f.writes[0].data.deletedAt, activityPinned: false, isLocked: true })
  const page = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  assert.equal(page.split('aria-label="话题活动信息"').length - 1, 1)
  assert.match(page, /fallbackContent=\{publicPostContentSource\}/)
  assert.match(page, /richContent=\{renderedRichContent\}/)
})
