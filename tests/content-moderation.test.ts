import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  findPostForbiddenWordMatches,
  findMatchedBannedWords,
  formatPostForbiddenWordMessage,
  normalizeModerationText,
  publicModerationText,
  publicModerationUserName,
  shouldBypassForbiddenWords,
  type ModerationWord,
} from '../lib/content-moderation'

const words: ModerationWord[] = [
  { id: 'research', word: '研究所', normalizedWord: '研究所', enabled: true, priority: 'HIGH' },
  { id: 'neuro-research', word: '神经研究所', normalizedWord: '神经研究所', enabled: true, priority: 'HIGH' },
  { id: 'neuro', word: '神经所', normalizedWord: '神经所', enabled: true, priority: 'HIGH' },
  { id: 'yjs', word: 'yjs', normalizedWord: 'yjs', enabled: true, priority: 'HIGH' },
]

function matched(text: string) {
  return findMatchedBannedWords(text, words).map((word) => word.word)
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('matches the four P0 words and English case variants', () => {
  assert.ok(matched('这是一个研究所').includes('研究所'))
  assert.ok(matched('神经研究所活动').includes('神经研究所'))
  assert.ok(matched('神经所').includes('神经所'))
  for (const value of ['yjs', 'YJS', 'Yjs', 'yJs']) assert.ok(matched(value).includes('yjs'))
})

test('normalizes ordinary, full-width, zero-width and repeated whitespace for P0 matching', () => {
  assert.equal(normalizeModerationText(' Y J S '), 'yjs')
  assert.equal(normalizeModerationText('神　经\u200B研 究 所'), '神经研究所')
  assert.ok(matched('神 经 研 究 所').includes('神经研究所'))
  assert.ok(matched('Y\u200BJ\u200DS').includes('yjs'))
})

test('does not match a disabled word', () => {
  assert.deepEqual(findMatchedBannedWords('测试词', [{ id: 'disabled', word: '测试词', normalizedWord: '测试词', enabled: false, priority: 'NORMAL' }]), [])
})

test('username, bio, post and comment examples are blocked by the same matcher', () => {
  assert.ok(matched('ABC研究所').includes('研究所'))
  assert.ok(matched('个人简介：神经研究所').includes('神经研究所'))
  assert.ok(matched('帖子正文包含研究所').includes('研究所'))
  assert.ok(matched('评论包含YJS').includes('yjs'))
})

test('post validation keeps title/body locations and removes overlapping shorter words', () => {
  const matches = findPostForbiddenWordMatches({ title: '神经研究所', content: '研究所 YJS' }, words)
  assert.deepEqual(matches, [
    { field: 'title', word: '神经研究所' },
    { field: 'content', word: '研究所' },
    { field: 'content', word: 'yjs' },
  ])
  assert.equal(
    formatPostForbiddenWordMessage(matches),
    '标题包含违禁词「神经研究所」；正文包含违禁词：「研究所」、「yjs」，请修改后重新提交。',
  )
})

test('post validation uses the real server role for the administrator bypass', () => {
  assert.equal(shouldBypassForbiddenWords({ role: 'USER' }), false)
  assert.equal(shouldBypassForbiddenWords({ role: 'ADMIN' }), true)
  assert.equal(shouldBypassForbiddenWords({ role: 'SUPER_ADMIN' }), true)
  const forged = { role: 'USER' as const, isAdmin: true }
  assert.equal(shouldBypassForbiddenWords(forged), false)
})

test('public rendering replaces historical violations without exposing the original text', () => {
  assert.equal(publicModerationText('xxxx研究所xxxx', 'VIOLATION'), '违规内容')
  assert.equal(publicModerationUserName('ABC研究所', ['VIOLATION']), '违规用户')
  assert.equal(publicModerationText('正常内容', 'NORMAL'), '正常内容')
})

test('profile and public-content write APIs use the server-side moderation service', () => {
  const profile = source('app/api/users/me/route.ts')
  assert.match(profile, /USERNAME_CONTAINS_BANNED_WORD/)
  assert.match(profile, /CONTENT_CONTAINS_BANNED_WORD/)
  assert.match(profile, /checkBannedWords\(nickname\)/)
  assert.match(profile, /checkBannedWords\(bio\)/)

  for (const path of [
    'app/api/posts/[postId]/replies/route.ts',
    'app/api/daily-messages/[messageId]/comments/route.ts',
    'app/api/checkin/route.ts',
    'app/api/profile-wall/route.ts',
    'app/api/feedback/route.ts',
    'app/api/feedback/[feedbackId]/replies/route.ts',
    'app/api/direct-conversations/[conversationId]/messages/route.ts',
  ]) {
    const route = source(path)
    assert.match(route, /checkBannedWords/)
    assert.match(route, /CONTENT_CONTAINS_BANNED_WORD/)
  }

  const postCreate = source('app/api/posts/route.ts')
  const postEdit = source('app/api/posts/[postId]/route.ts')
  assert.match(postCreate, /checkPostForbiddenWords/)
  assert.match(postEdit, /checkPostForbiddenWords/)
})

test('post creation and editing share one server-side bypass and validation path', () => {
  const postCreate = source('app/api/posts/route.ts')
  const postEdit = source('app/api/posts/[postId]/route.ts')
  assert.match(postCreate, /const isAdmin = shouldBypassForbiddenWords\(user\)/)
  assert.match(postCreate, /checkPostForbiddenWords\(\{ title: rawTitle, content: rawContent \}, user\)/)
  assert.match(postEdit, /const isAdmin = shouldBypassForbiddenWords\(guard\.user\)/)
  assert.match(postEdit, /checkPostForbiddenWords\(\{ title: rawTitle, content: rawContent \}, user\)/)
  assert.doesNotMatch(postEdit, /containsSensitiveContent/)
  assert.doesNotMatch(postEdit, /checkForbiddenWords/)
  assert.match(source('lib/content-moderation-scan.ts'), /post\.User\.role === 'ADMIN' \|\| post\.User\.role === 'SUPER_ADMIN'/)
})

test('administrator post text is not masked in the public post surfaces', () => {
  assert.match(source('app/api/posts/route.ts'), /moderationStatus = canPublishImmediately \? 'APPROVED'/)
  assert.match(source('lib/content-moderation-scan.ts'), /if \(post\.User\.role === 'ADMIN' \|\| post\.User\.role === 'SUPER_ADMIN'\) continue/)
  for (const path of [
    'app/api/posts/route.ts',
    'app/api/posts/[postId]/route.ts',
    'app/api/forum/feed/route.ts',
    'app/api/forum/discover/route.ts',
    'app/api/search/route.ts',
    'lib/home-data.ts',
    'lib/trending-posts.ts',
  ]) {
    assert.match(source(path), /publicModerationText\(/)
  }
})

test('history scanning covers requested entities and preserves violation state', () => {
  const scan = source('lib/content-moderation-scan.ts')
  for (const model of ['user', 'profile', 'post', 'dailyMessage', 'reply', 'dailyMessageComment', 'profileWallMessage', 'directMessage', 'feedback', 'feedbackReply', 'stickerPack', 'sticker', 'todayEvent', 'cultureComment', 'friendActivity']) {
    assert.match(scan, new RegExp(`prisma\\.${model}\\.`))
  }
  assert.match(scan, /moderationStatus: 'VIOLATION'/)
  assert.match(scan, /moderationReason: 'BANNED_WORD'/)
  assert.match(scan, /matchedBannedWords/)
  assert.doesNotMatch(scan, /moderationStatus: 'NORMAL'/)
})

test('admin management detects duplicates, invalidates cache and starts asynchronous scans', () => {
  const list = source('app/api/admin/banned-words/route.ts')
  const item = source('app/api/admin/banned-words/[id]/route.ts')
  const page = source('app/admin/banned-words/BannedWordManager.tsx')
  assert.match(list, /requireAdmin\('banned_word_manage'\)/)
  assert.match(list, /BANNED_WORD_EXISTS/)
  assert.match(list, /invalidateBannedWordCache\(\)/)
  assert.match(list, /startModerationScan\(\)/)
  assert.match(item, /enabled: false/)
  assert.match(list, /该违禁词已存在/)
  assert.match(page, /违禁词已新增/)
  assert.match(page, /重新扫描全站/)
  assert.match(page, /将根据当前启用的违禁词重新扫描现有用户资料及用户内容，并将命中的内容标记为违规。是否继续？/)
})
