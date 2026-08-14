import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Duel has one formal page route and an entertainment compatibility redirect', () => {
  const formalPage = read('app/games/guess-song/duel/page.tsx')
  const aliasPage = read('app/entertainment/guess-song/duel/page.tsx')

  assert.match(formalPage, /GuessSongDuel/)
  assert.match(formalPage, /getCurrentUser\(\)/)
  assert.match(formalPage, /redirect\('\/login\?redirect=%2Fgames%2Fguess-song%2Fduel'/)
  assert.match(aliasPage, /redirect\(`\/games\/guess-song\/duel\$\{suffix\}`\)/)
})

test('entertainment home exposes the Duel entry beside the game library', () => {
  const gameCenter = read('components/games/GameCenter.tsx')

  assert.match(gameCenter, /className="game-duel-entry"/)
  assert.match(gameCenter, /1v1 对决/)
  assert.match(gameCenter, /href="\/games\/guess-song\/duel"/)
  assert.doesNotMatch(gameCenter, /DUEL_ENABLED|NEXT_PUBLIC_.*DUEL/i)
})

test('Guess Song mode selection exposes the same Duel entry on mobile and desktop', () => {
  const detail = read('components/games/GuessSongDetail.tsx')
  const css = read('app/globals.css')

  assert.match(detail, /className="guess-detail-duel-link"/)
  assert.match(detail, /与好友实时抢答 30 题/)
  assert.match(detail, /href="\/games\/guess-song\/duel">1v1 对决/)
  assert.match(detail, /className="game-detail-mobile-top">[\s\S]*?<Link href="\/games\/guess-song\/duel">1v1 对决/)
  assert.match(css, /\.guess-detail-duel-link/)
  assert.match(css, /\.game-duel-entry/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.game-duel-entry/)
})

test('Duel entry does not replace the existing single-player mode flow', () => {
  const detail = read('components/games/GuessSongDetail.tsx')

  assert.match(detail, /type Mode = GuessSongPublicMode/)
  assert.match(detail, /beginSession\(mode: Mode/)
  assert.match(detail, /modes\.map/)
  assert.match(detail, /leaderboard/)
})
