import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePostExpiresAt, isPostExpired, buildPostExpiryWhere } from '../lib/post-lifecycle'
import { collectPostTopicNames, extractTopicNamesFromText, extractTopicNamesFromRichContent, PostTopicInputError } from '../lib/post-topics'
import { buildPublicPostWhere } from '../lib/post-moderation'

test('话题解析支持中文、英文、数字、下划线并忽略标点', () => {
  assert.deepEqual(extractTopicNamesFromText('#FEARandDREAMS #太子湾花园城，#演唱会repo #2026_repo'), ['FEARandDREAMS', '太子湾花园城', '演唱会repo', '2026_repo'])
})

test('话题解析不把 URL fragment、路径或代码内容当成话题', () => {
  assert.deepEqual(extractTopicNamesFromText('https://example.com/#fragment /#not-a-topic #正常话题'), ['正常话题'])
  const richContent = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '#正文话题' }] },
      { type: 'codeBlock', content: [{ type: 'text', text: '#代码里的话题' }] },
    ],
  } as unknown as import('../lib/rich-text').RichTextContent
  assert.deepEqual(extractTopicNamesFromRichContent(richContent), ['正文话题'])
})

test('正文和手动话题合并后按 normalizedName 去重并限制五个', () => {
  assert.deepEqual(collectPostTopicNames({ content: '#FEARandDREAMS #fearanddreams', topicNames: ['太子湾花园城', '#FEARandDREAMS'] }), ['FEARandDREAMS', '太子湾花园城'])
  assert.throws(() => collectPostTopicNames({ content: '', topicNames: ['a', 'b', 'c', 'd', 'e', 'f'] }), (error: unknown) => error instanceof PostTopicInputError && error.reason === 'TOO_MANY')
  assert.throws(() => collectPostTopicNames({ content: '', topicNames: ['带 空格'] }), (error: unknown) => error instanceof PostTopicInputError && error.reason === 'INVALID_NAME')
})

test('限时帖在公开时刻计算绝对到期时间，普通帖永久有效', () => {
  const startsAt = new Date('2026-09-19T12:00:00+08:00')
  assert.equal(calculatePostExpiresAt(null, startsAt), null)
  assert.equal(calculatePostExpiresAt('HOURS_24', startsAt)?.getTime(), startsAt.getTime() + 24 * 60 * 60 * 1000)
  assert.equal(calculatePostExpiresAt('DAYS_3', startsAt)?.getTime(), startsAt.getTime() + 3 * 24 * 60 * 60 * 1000)
  assert.equal(calculatePostExpiresAt('DAYS_7', startsAt)?.getTime(), startsAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  const todayExpiry = calculatePostExpiresAt('TODAY', startsAt)
  assert.ok(todayExpiry)
  assert.ok(todayExpiry.getTime() > startsAt.getTime())
  assert.equal(isPostExpired(todayExpiry, todayExpiry), true)
  assert.equal(isPostExpired(todayExpiry, new Date(todayExpiry.getTime() - 1)), false)
})

test('公开帖子查询必须排除 expiresAt 已到期的帖子', () => {
  const now = new Date('2026-09-19T04:00:00.000Z')
  const where = buildPublicPostWhere(now)
  assert.equal(where.isDeleted, false)
  assert.equal(where.status, 'PUBLISHED')
  assert.deepEqual(where.moderationStatus.in, ['APPROVED', 'VIOLATION'])
  assert.deepEqual(where.OR, [{ expiresAt: null }, { expiresAt: { gt: now } }])
  assert.deepEqual(buildPostExpiryWhere(now).OR, where.OR)
})
