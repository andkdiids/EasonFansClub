import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

const game = read('app/entertainment/guess-song/GuessSongGame.tsx')
const shell = read('components/layout/AppShell.tsx')
const styles = read('app/globals.css')

test('game center uses a responsive hall with banner, filters, search and skeleton cards', () => {
  const center = read('components/games/GameCenter.tsx')
  const catalog = read('lib/game-catalog.ts')
  assert.match(center, /<GameBanner/)
  assert.match(center, /<GameGrid/)
  assert.match(center, /gameCategories\.map/)
  assert.match(center, /placeholder="搜索游戏名称"/)
  assert.match(center, /game-grid-skeleton/)
  assert.match(catalog, /guess-song/)
  assert.match(catalog, /lyrics-chain/)
  assert.match(catalog, /concert-knowledge/)
  assert.match(styles, /grid-template-columns:repeat\(auto-fill,minmax\(210px,240px\)\)/)
  assert.match(styles, /@media \(max-width:767px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
})

test('all games share the detail template while guess song has mode, ranking and history entries', () => {
  const layout = read('components/games/GameDetailLayout.tsx')
  const detail = read('components/games/GuessSongDetail.tsx')
  assert.match(layout, /玩法说明/)
  assert.match(layout, /奖励与积分/)
  assert.match(detail, /立即开始/)
  assert.match(detail, /排行榜/)
  assert.match(detail, /历史记录/)
  assert.match(detail, /router\.push\(`\/games\/guess-song\/play\?session=/)
})

test('formal game route is split to /play and gets a route-level immersive layout', () => {
  const page = read('app/games/[slug]/play/page.tsx')
  const layout = read('app/games/[slug]/play/layout.tsx')
  assert.match(page, /slug !== 'guess-song'/)
  assert.match(page, /<GuessSongGame/)
  assert.match(layout, /data-game-immersive="true"/)
  assert.match(styles, /\.immersive-game-layout[\s\S]*min-height:100dvh/)
})

test('AppShell omits all site navigation for any game play route without global CSS hiding', () => {
  assert.match(shell, /isImmersiveGameRoute = \/\^\\\/games/)
  assert.match(shell, /isImmersiveGameRoute \|\| shelllessPrefixes/)
  const immersiveCss = styles.slice(styles.indexOf('.immersive-game-layout'))
  assert.doesNotMatch(immersiveCss, /display:\s*none\s*!important/)
})

test('immersive exit unifies button, browser back, confirmation and abandon cleanup', () => {
  assert.match(game, /className="game-exit-button"/)
  assert.match(game, /addEventListener\('popstate'/)
  assert.match(game, /addEventListener\('beforeunload'/)
  assert.match(game, /setExitOpen\(true\)/)
  assert.match(game, /退出当前游戏？/)
  assert.match(game, /继续游戏/)
  assert.match(game, /确认退出/)
  assert.match(game, /stopAudio\(\)[\s\S]*\/abandon/)
  assert.match(game, /window\.history\.go\(-2\)/)
})

test('EasMusic pauses on entry, preserves its track and hides the mini player while immersed', () => {
  const provider = read('components/music/MusicPlayerProvider.tsx')
  assert.match(game, /dispatchEvent\(new Event\('easmusic:pause-all'\)\)/)
  assert.match(provider, /const onPauseAll = \(\) => audio\.pause\(\)/)
  assert.match(provider, /track && !isImmersiveGameRoute/)
  assert.doesNotMatch(provider, /onPauseAll = \(\) => stop/)
})

test('cassette, canvas waveform and answer UI are split into focused components', () => {
  const cassette = read('components/games/CassettePlayer.tsx')
  const waveform = read('components/games/WaveformBackground.tsx')
  const answer = read('components/games/GuessAnswerInput.tsx')
  for (const component of ['GameCard', 'GameBanner', 'GameGrid', 'GameDetailLayout', 'CassettePlayer', 'WaveformBackground', 'ProgressBar', 'GuessAnswerInput', 'GuessResultOverlay', 'GuessHeader', 'GuessFooter']) {
    const combined = [
      ...['components/games/GameCard.tsx', 'components/games/GameBanner.tsx', 'components/games/GameGrid.tsx', 'components/games/GameDetailLayout.tsx',
        'components/games/CassettePlayer.tsx', 'components/games/WaveformBackground.tsx', 'components/games/ProgressBar.tsx',
        'components/games/GuessAnswerInput.tsx', 'components/games/GuessResultOverlay.tsx', 'components/games/GuessHeader.tsx',
        'components/games/GuessFooter.tsx'].map(read),
    ].join('\n')
    assert.match(combined, new RegExp(`function ${component}`))
  }
  assert.match(cassette, /cassette-reel/)
  assert.match(cassette, /cassette-label[\s\S]*cassette-play/)
  assert.match(waveform, /getContext\('2d'\)/)
  assert.match(waveform, /requestAnimationFrame/)
  assert.match(waveform, /document\.visibilityState === 'hidden'/)
  assert.match(waveform, /cancelAnimationFrame/)
  assert.match(answer, /输入歌曲名称/)
})

test('guess UI keeps one Audio instance at a time and leaves all core APIs unchanged', () => {
  assert.match(game, /const audioRef = useRef<HTMLAudioElement \| null>\(null\)/)
  assert.match(game, /const audio = new Audio\(\)/)
  assert.match(game, /stopAudio\(\)[\s\S]*audioRef\.current = null/)
  assert.match(game, /\/api\/entertainment\/guess-song\/sessions\/\$\{session\.id\}\/play/)
  assert.match(game, /\/api\/entertainment\/guess-song\/sessions\/\$\{session\.id\}\/answer/)
  assert.match(game, /\/api\/entertainment\/guess-song\/sessions\/\$\{session\.id\}\/abandon/)
})

test('mobile immersive UI uses safe areas, 100dvh and fixed bottom answer controls', () => {
  assert.match(styles, /top:max\(18px,env\(safe-area-inset-top\)\)/)
  assert.match(styles, /min-height:100dvh/)
  assert.match(styles, /\.guess-answer-zone \{ position:fixed/)
  assert.match(styles, /env\(safe-area-inset-bottom\)/)
  assert.match(styles, /\.game-exit-button[\s\S]*min-height:44px/)
})

test('no Prisma schema, migration or API implementation is introduced by the UI test contract', () => {
  const routePage = read('app/games/[slug]/play/page.tsx')
  const hallPage = read('app/games/page.tsx')
  assert.doesNotMatch(routePage, /prisma|@\/lib\/guess-song-session/)
  assert.doesNotMatch(hallPage, /prisma|api\/entertainment/)
})
