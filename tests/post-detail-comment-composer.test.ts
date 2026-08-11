import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const replySection = read('components/PostRepliesSection.tsx')
const replyForm = read('components/ReplyForm.tsx')

test('post detail primary composer is before the comment list while thread replies stay inline', () => {
  const primaryGate = '{currentUserId && !replyTo ? ('
  const primaryGateCount = replySection.split(primaryGate).length - 1
  const composerIndex = replySection.indexOf(primaryGate)
  const headingIndex = replySection.indexOf('<h2 className="text-2xl font-black text-brand-950">', composerIndex)
  const listIndex = replySection.indexOf('{rootReplies.length === 0 ? (', headingIndex)

  assert.equal(primaryGateCount, 1)
  assert.ok(composerIndex >= 0 && composerIndex < headingIndex)
  assert.ok(headingIndex < listIndex)
  assert.match(replySection, /id=\{`reply-form-\$\{reply\.id\}`\}/)
  assert.match(replyForm, /parentId: replyTo\?\.id/)
})
