import type { GuessSongPublicMode } from '@/lib/guess-song-config'
import type { WantListenMode } from '@/lib/want-listen-config'
import { GAME_RANKING_RANGE_OPTIONS, type GameRankingRangeOption } from '@/lib/game-ranking-range'

export type EntertainmentLeaderboardPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL' | 'YEAR'

export type EntertainmentLeaderboardMode = {
  key: string
  label: string
}

export type EntertainmentLeaderboardGameKey =
  | 'WANT_LISTEN'
  | 'CANTONESE_FRAGMENT'
  | 'FALSE_TITLE'
  | 'LISTEN'
  | 'LISTEN_DUEL'
  | 'UNDERCOVER_STAR'

export type EntertainmentLeaderboardPeriodDefinition = {
  key: EntertainmentLeaderboardPeriod
  label: string
}

export type EntertainmentLeaderboardDefinition = {
  gameKey: EntertainmentLeaderboardGameKey
  name: string
  route: string
  /** null means this game has no mode selector in the unified center. */
  modes: readonly EntertainmentLeaderboardMode[] | null
  periods: readonly EntertainmentLeaderboardPeriodDefinition[]
  /** The four shared public date filters. Empty means no public leaderboard exists yet. */
  ranges: readonly GameRankingRangeOption[]
  defaultMode: string | null
  defaultPeriod: EntertainmentLeaderboardPeriod | null
  source: 'want-listen' | 'guess-song' | null
  /** The underlying game mode used by an existing service, not a UI level. */
  sourceMode: WantListenMode | GuessSongPublicMode | null
}

const WANT_LISTEN_PERIODS = [
  { key: 'DAY', label: '今日榜' },
  { key: 'WEEK', label: '周榜' },
  { key: 'MONTH', label: '月榜' },
  { key: 'ALL', label: '总榜' },
] as const satisfies readonly EntertainmentLeaderboardPeriodDefinition[]

const GUESS_SONG_PERIODS = [
  { key: 'WEEK', label: '周榜' },
  { key: 'MONTH', label: '月榜' },
  { key: 'YEAR', label: '年榜' },
] as const satisfies readonly EntertainmentLeaderboardPeriodDefinition[]

const GUESS_SONG_MODES = [
  { key: 'EASY', label: '简单' },
  { key: 'ADVANCED', label: '进阶' },
  { key: 'HARD', label: '困难' },
  { key: 'EXPERT', label: '专家' },
] as const satisfies readonly EntertainmentLeaderboardMode[]

const DUEL_MODES = [
  { key: 'SCORE', label: '计分模式' },
  { key: 'BUZZER', label: '抢答模式' },
] as const satisfies readonly EntertainmentLeaderboardMode[]

/**
 * One registry drives the game picker, mode/period controls and server
 * adapters. Want Listen's three existing mechanics are represented as
 * top-level entries so the unified center never renders WANT_LISTEN →
 * WANT_LISTEN. Only 听听 exposes a mode level here.
 */
export const ENTERTAINMENT_LEADERBOARDS = [
  {
    gameKey: 'WANT_LISTEN',
    name: '想听',
    route: '/games/want-listen',
    modes: null,
    periods: WANT_LISTEN_PERIODS,
    ranges: GAME_RANKING_RANGE_OPTIONS,
    defaultMode: null,
    defaultPeriod: 'WEEK',
    source: 'want-listen',
    sourceMode: 'WANT_LISTEN',
  },
  {
    gameKey: 'CANTONESE_FRAGMENT',
    name: '粤语残片',
    route: '/games/want-listen',
    modes: null,
    periods: WANT_LISTEN_PERIODS,
    ranges: GAME_RANKING_RANGE_OPTIONS,
    defaultMode: null,
    defaultPeriod: 'WEEK',
    source: 'want-listen',
    sourceMode: 'CANTONESE_FRAGMENT',
  },
  {
    gameKey: 'FALSE_TITLE',
    name: '防不胜防',
    route: '/games/want-listen',
    modes: null,
    periods: WANT_LISTEN_PERIODS,
    ranges: GAME_RANKING_RANGE_OPTIONS,
    defaultMode: null,
    defaultPeriod: 'WEEK',
    source: 'want-listen',
    sourceMode: 'FALSE_TITLE',
  },
  {
    gameKey: 'LISTEN',
    name: '听听',
    route: '/games/guess-song',
    modes: GUESS_SONG_MODES,
    periods: GUESS_SONG_PERIODS,
    ranges: GAME_RANKING_RANGE_OPTIONS,
    defaultMode: 'EASY',
    defaultPeriod: 'WEEK',
    source: 'guess-song',
    sourceMode: null,
  },
  {
    gameKey: 'LISTEN_DUEL',
    name: '听听 1v1',
    route: '/games/guess-song/duel',
    modes: DUEL_MODES,
    periods: [],
    ranges: [],
    defaultMode: 'SCORE',
    defaultPeriod: null,
    source: null,
    sourceMode: null,
  },
  {
    gameKey: 'UNDERCOVER_STAR',
    name: '卧底巨星',
    route: '/games/undercover-star',
    modes: null,
    periods: [],
    ranges: [],
    defaultMode: null,
    defaultPeriod: null,
    source: null,
    sourceMode: null,
  },
] as const satisfies readonly EntertainmentLeaderboardDefinition[]

export function getEntertainmentLeaderboardDefinition(gameKey: unknown) {
  return ENTERTAINMENT_LEADERBOARDS.find((item) => item.gameKey === gameKey) || null
}

export function isEntertainmentLeaderboardPeriod(value: unknown): value is EntertainmentLeaderboardPeriod {
  return typeof value === 'string'
    && ['DAY', 'WEEK', 'MONTH', 'ALL', 'YEAR'].includes(value)
}
