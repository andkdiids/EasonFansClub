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
