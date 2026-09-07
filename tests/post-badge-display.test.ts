import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const displayName = read('components/UserDisplayName.tsx')
const replies = read('components/PostRepliesSection.tsx')
const detail = read('app/posts/[postId]/page.tsx')
const topbar = read('components/ForumDiscoveryDetailTopbar.tsx')

test('共用勋章显示组件默认不限制数量，并按既有 position 顺序截取场景上限', () => {
  assert.match(displayName, /maxDisplay\?: number/)
  assert.match(displayName, /const orderedBadges = liveBadges[\s\S]*?position \?\? left\.index/)
  assert.match(displayName, /orderedBadges\.slice\(0, Math\.max\(0, Math\.floor\(maxDisplay as number\)\)\)/)
  assert.match(displayName, /: orderedBadges\n\s*: \[\]/)
})

test('帖子详情的所有评论变体只显示第一枚已佩戴勋章', () => {
  const limitedCommentBadges = (replies.match(/<UserDisplayName[\s\S]*?maxDisplay=\{1\} \/>/g) || []).length
  assert.equal(limitedCommentBadges, 3)
  assert.match(replies, /function renderCompactReply[\s\S]*?maxDisplay=\{1\}/)
  assert.match(replies, /function renderReply[\s\S]*?maxDisplay=\{1\}/)
  assert.match(replies, /post-replies-hot-list[\s\S]*?maxDisplay=\{1\}/)
})

test('帖子顶部作者区不受评论区上限影响，资料卡和其他页面不改默认行为', () => {
  assert.match(detail, /<ForumDiscoveryDetailTopbar[\s\S]*?authorBadges=\{equippedBadgeMap\.get\(post\.User\.id\) \|\| \[\]\}/)
  assert.match(detail, /<UserDisplayName name=\{authorName\}[\s\S]*?badges=\{equippedBadgeMap\.get\(post\.User\.id\) \|\| \[\]\} badge=\{equippedBadgeMap\.get\(post\.User\.id\)\?\.\[0\] \|\| null\} compact \/>/)
  assert.match(topbar, /<UserDisplayName name=\{authorName\}[\s\S]*?badges=\{authorBadges\} badge=\{authorBadge\} compact \/>/)
  assert.doesNotMatch(detail, /authorBadges=.*maxDisplay=\{1\}/)
  assert.doesNotMatch(topbar, /maxDisplay=\{1\}/)
})

test('无勋章时仍由 UserDisplayName 的空数组逻辑不渲染占位', () => {
  assert.match(displayName, /displayBadges\.length && showBadgeIcon/)
  assert.match(detail, /equippedBadgeMap\.get\(post\.User\.id\) \|\| \[\]/)
  assert.match(replies, /reply\.author\.equippedBadges/)
})

test('帖子详情只使用展示上限参数，不改变佩戴数据或资料页面', () => {
  assert.doesNotMatch(replies, /equipBadge|unequipBadge|reorderEquippedBadges/)
  assert.doesNotMatch(detail, /updateUserBadgeShowcase|reorderEquippedBadges|equippedBadgeId.*update/)
})
