import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const game = readFileSync('app/entertainment/guess-song/GuessSongGame.tsx', 'utf8')

test('switching questions resets audio state and ignores stale audio errors', () => {
  assert.match(game, /const \[audioLoading, setAudioLoading\] = useState\(false\)/)
  assert.match(game, /const \[audioError, setAudioError\] = useState\(''\)/)
  assert.match(game, /audioGenerationRef\.current \+= 1/)
  assert.match(game, /audioRef\.current = null[\s\S]*audio\.removeAttribute\('src'\)[\s\S]*audio\.load\(\)/)
  assert.match(game, /setAudioError\(''\)[\s\S]*setPlayedOnce\(false\)/)
  assert.match(
    game,
    /audio\.addEventListener\('error', \(\) => \{[\s\S]*audioRef\.current !== audio \|\| audioGeneration !== audioGenerationRef\.current[\s\S]*setAudioError\(/,
  )
})

test('each requested clip gets a fresh src and load without auto-playing the next question', () => {
  assert.match(game, /const audio = new Audio\(\)/)
  assert.match(game, /audio\.src = data\.signedUrl[\s\S]*audio\.load\(\)[\s\S]*await audio\.play\(\)/)

  const continueGame = game.slice(
    game.indexOf('function continueGame()'),
    game.indexOf('async function abandon()'),
  )
  assert.match(continueGame, /stopAudio\(\)/)
  assert.match(continueGame, /setAudioError\(''\)/)
  assert.doesNotMatch(continueGame, /\.play\(/)
})
