import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const game = readFileSync('app/entertainment/guess-song/GuessSongGame.tsx', 'utf8')

test('switching questions resets audio state and ignores stale audio errors', () => {
  assert.match(game, /const \[audioLoading, setAudioLoading\] = useState\(false\)/)
  assert.match(game, /const \[audioError, setAudioError\] = useState\(''\)/)
  assert.match(game, /audioGenerationRef\.current \+= 1/)
  assert.match(game, /audioRef\.current = null[\s\S]*audio\.removeAttribute\('src'\)[\s\S]*audio\.load\(\)/)
  assert.match(game, /setAudioError\(''\)[\s\S]*setAnswerResult\(null\)/)
  assert.match(
    game,
    /audio\.addEventListener\('error', \(\) => \{[\s\S]*audioRef\.current !== audio \|\| generation !== audioGenerationRef\.current[\s\S]*setAudioError\(/,
  )
})

test('each requested clip gets a fresh src and load without auto-playing the next question', () => {
  assert.match(game, /const audio = new Audio\(\)/)
  assert.match(game, /audio\.src = data\.signedUrl[\s\S]*audio\.load\(\)[\s\S]*await audio\.play\(\)/)

  const continueGame = game.slice(
    game.indexOf('const continueGame = useCallback'),
    game.indexOf('function requestExit()'),
  )
  assert.match(continueGame, /stopAudio\(\)/)
  assert.match(continueGame, /setAudioError\(''\)/)
  assert.doesNotMatch(continueGame, /\.play\(/)
})

test('correct answer advances after one second while the next question never auto plays', () => {
  assert.match(game, /if \(!answerResult\?\.correct \|\| !nextSession\) return/)
  assert.match(game, /window\.setTimeout\(continueGame, 1000\)/)
  const continueGame = game.slice(game.indexOf('const continueGame = useCallback'), game.indexOf('function requestExit()'))
  assert.doesNotMatch(continueGame, /toggleAudio|requestFreshAudio|\.play\(/)
})

test('cassette playback reuses the active audio for pause and resume', () => {
  const toggleAudio = game.slice(game.indexOf('async function toggleAudio()'), game.indexOf('async function submitAnswer'))
  assert.match(toggleAudio, /audio && !audio\.ended/)
  assert.match(toggleAudio, /if \(audio\.paused\)/)
  assert.match(toggleAudio, /await audio\.play\(\)/)
  assert.match(toggleAudio, /audio\.pause\(\)/)
})
