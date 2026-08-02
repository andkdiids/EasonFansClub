import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('听听移动端答案区域位于磁带之后且不使用底部固定覆盖层', () => {
  const game = read('app/entertainment/guess-song/GuessSongGame.tsx')
  const answer = read('components/games/GuessAnswerInput.tsx')
  const css = read('app/globals.css')

  assert.match(game, /<CassettePlayer[\s\S]*<section className="guess-answer-zone answer-section"/)
  assert.match(answer, /answer-grid/)
  assert.match(answer, /guess-confirm-button/)
  assert.match(css, /\.guess-answer-zone \{ position:static/)
  assert.doesNotMatch(css, /\.guess-answer-zone \{ position:fixed/)
  assert.match(css, /\.guess-song-options \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)/)
  assert.match(css, /\.guess-result-overlay \{ position:static/)
})

test('深色主题的挂号说明、评论和楼中楼使用语义 surface', () => {
  const guide = read('components/CheckInGrowthGuideCard.tsx')
  const messages = read('components/CheckInMessagesPanel.tsx')
  const replies = read('components/PostRepliesSection.tsx')
  const replyForm = read('components/ReplyForm.tsx')
  const css = read('app/globals.css')

  assert.doesNotMatch(guide, /bg-gradient-to-br from-white/)
  assert.match(guide, /checkin-growth-guide-intro/)
  assert.match(messages, /checkin-comment-thread/)
  assert.match(messages, /checkin-comment-card/)
  assert.match(replies, /post-reply-card/)
  assert.match(replyForm, /post-reply-form/)
  assert.match(css, /\.checkin-growth-guide \{ color:var\(--foreground\);[\s\S]*background:var\(--surface\); \}/)
  assert.match(css, /\.checkin-messages-panel \.checkin-comment-thread \{ background:var\(--surface-subtle\); \}/)
  assert.match(css, /\.checkin-messages-panel \.checkin-reply-thread \{ border-left-color:var\(--border-strong\); \}/)
  assert.match(css, /\.post-replies-section \.post-reply-thread \{ border-left-color:var\(--border-strong\); \}/)
})
