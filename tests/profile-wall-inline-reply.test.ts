import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('profile wall keeps the top composer for root messages only', () => {
  const client = read('components/ProfileWall.tsx')

  assert.match(client, /placeholder="发表新的一级留言\.\.\."/)
  assert.match(client, /body: JSON\.stringify\(\{ receiverUid, content, parentId: null \}\)/)
  assert.doesNotMatch(client, /replyTo\?\.id \|\| null/)
})

test('profile wall renders one inline composer for root and nested reply targets', () => {
  const client = read('components/ProfileWall.tsx')

  assert.match(client, /type WallReplyTarget = \{[\s\S]*id: string[\s\S]*name: string/)
  assert.match(client, /const \[replyTarget, setReplyTarget\]/)
  assert.match(client, /function handleReply\(target: WallReplyTarget\)/)
  assert.match(client, /setReplyTarget\(target\)/)
  assert.match(client, /const parentId = replyTarget\.id/)
  assert.match(client, /body: JSON\.stringify\(\{ receiverUid, content: replyContent, parentId \}\)/)
  assert.match(client, /insertWallMessage\(current, created\)/)
  assert.equal((client.match(/<WallInlineReplyComposer/g) || []).length, 2)
  assert.match(client, /focus\(\{ preventScroll: true \}\)/)
  assert.match(client, /setReplyTarget\(null\)/)
  assert.match(client, /setReplyContent\('\'\)/)
  assert.doesNotMatch(client, /if \(parentId \|\| wallPage === 1\) await load\(\)/)
})
