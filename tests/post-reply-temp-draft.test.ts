import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  clearPostReplyDrafts,
  getPostReplyDraftKey,
  readPostReplyDrafts,
  writePostReplyDraft,
} from '../lib/post-reply-drafts'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return Array.from(values.keys())[index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, value) },
  }
}

test('post and comment reply drafts are isolated by post and target', () => {
  const storage = memoryStorage()
  const postDraft = getPostReplyDraftKey('post-a', { targetType: 'POST', targetId: 'post-a' })
  const commentA = getPostReplyDraftKey('post-a', { targetType: 'COMMENT', targetId: 'comment-a' })
  const commentB = getPostReplyDraftKey('post-a', { targetType: 'COMMENT', targetId: 'comment-b' })
  const otherPost = getPostReplyDraftKey('post-b', { targetType: 'POST', targetId: 'post-b' })

  writePostReplyDraft(postDraft, '帖子回复', storage)
  writePostReplyDraft(commentA, '回复 A', storage)
  writePostReplyDraft(commentB, '回复 B', storage)
  writePostReplyDraft(otherPost, '另一个帖子', storage)

  assert.deepEqual(readPostReplyDrafts('post-a', storage), {
    [postDraft]: '帖子回复',
    [commentA]: '回复 A',
    [commentB]: '回复 B',
  })
  assert.deepEqual(readPostReplyDrafts('post-b', storage), { [otherPost]: '另一个帖子' })
})

test('empty content removes only the selected target draft', () => {
  const storage = memoryStorage()
  const commentA = getPostReplyDraftKey('post-a', { targetType: 'COMMENT', targetId: 'comment-a' })
  const commentB = getPostReplyDraftKey('post-a', { targetType: 'COMMENT', targetId: 'comment-b' })
  writePostReplyDraft(commentA, '保留前的内容', storage)
  writePostReplyDraft(commentB, '不能被误删', storage)
  writePostReplyDraft(commentA, '', storage)

  assert.deepEqual(readPostReplyDrafts('post-a', storage), { [commentB]: '不能被误删' })
})

test('clearing a post removes all of its temporary drafts but not another post', () => {
  const storage = memoryStorage()
  const postA = getPostReplyDraftKey('post-a', { targetType: 'POST', targetId: 'post-a' })
  const commentA = getPostReplyDraftKey('post-a', { targetType: 'COMMENT', targetId: 'comment-a' })
  const postB = getPostReplyDraftKey('post-b', { targetType: 'POST', targetId: 'post-b' })
  writePostReplyDraft(postA, 'A', storage)
  writePostReplyDraft(commentA, 'A comment', storage)
  writePostReplyDraft(postB, 'B', storage)

  clearPostReplyDrafts('post-a', storage)

  assert.deepEqual(readPostReplyDrafts('post-a', storage), {})
  assert.deepEqual(readPostReplyDrafts('post-b', storage), { [postB]: 'B' })
})

test('reply form clears the selected draft only after a validated send success', () => {
  const replyForm = read('components/ReplyForm.tsx')
  const successBoundary = replyForm.indexOf("if (!data.success || !data.reply?.id || !data.reply?.author)")
  const draftClear = replyForm.indexOf('onDraftClear?.()', successBoundary)
  const failureBoundary = replyForm.indexOf('if (!response.ok)')

  assert.ok(successBoundary >= 0)
  assert.ok(draftClear > successBoundary)
  assert.ok(draftClear > failureBoundary)
  assert.match(replyForm, /draftContent\?: string/)
  assert.match(replyForm, /onDraftChange\?: \(content: string\) => void/)
})

test('post reply section keeps close separate from draft cleanup and uses target-scoped storage', () => {
  const section = read('components/PostRepliesSection.tsx')
  assert.match(section, /targetType: 'POST'/)
  assert.match(section, /targetType: 'COMMENT'/)
  assert.match(section, /readPostReplyDrafts\(postId\)/)
  assert.match(section, /clearPostReplyDrafts\(postId\)/)
  assert.match(section, /onDraftClear=\{\(\) => clearReplyDraft\(/)
  assert.match(section, /const closeMobileReplySheet = useCallback\(\(\) => \{[\s\S]*setReplyTo\(null\)/)
})
