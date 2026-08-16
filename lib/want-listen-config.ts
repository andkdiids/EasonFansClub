export const WANT_LISTEN_TOTAL_QUESTIONS = 20
export const WANT_LISTEN_SESSION_TTL_MS = 2 * 60 * 60 * 1000

export const WANT_LISTEN_MODES = ['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE'] as const
export type WantListenMode = (typeof WANT_LISTEN_MODES)[number]

export const WANT_LISTEN_MODE_LABELS: Record<WantListenMode, string> = {
  WANT_LISTEN: '想听',
  CANTONESE_FRAGMENT: '粤语残片',
  FALSE_TITLE: '防不胜防',
}

export const WANT_LISTEN_MODE_DESCRIPTIONS: Record<WantListenMode, string> = {
  WANT_LISTEN: '根据逐渐出现的线索，猜出这首歌。',
  CANTONESE_FRAGMENT: '熟悉的歌词少了一块，你还记得这里唱了什么吗？',
  FALSE_TITLE: '六个歌名，五真一假。找出那个不存在的歌名。',
}

export const WANT_LISTEN_MODE_MAX_SCORES: Record<WantListenMode, number> = {
  WANT_LISTEN: 8000,
  CANTONESE_FRAGMENT: 2000,
  FALSE_TITLE: 2000,
}

export type WantListenConfig = {
  enabled: boolean
  wantListenEnabled: boolean
  cantoneseFragmentEnabled: boolean
  falseTitleEnabled: boolean
}

export const DEFAULT_WANT_LISTEN_CONFIG: WantListenConfig = {
  enabled: true,
  wantListenEnabled: true,
  cantoneseFragmentEnabled: true,
  falseTitleEnabled: true,
}

export function isWantListenMode(value: unknown): value is WantListenMode {
  return typeof value === 'string' && (WANT_LISTEN_MODES as readonly string[]).includes(value)
}

export function isWantListenModeEnabled(config: WantListenConfig, mode: WantListenMode) {
  if (!config.enabled) return false
  if (mode === 'WANT_LISTEN') return config.wantListenEnabled
  if (mode === 'CANTONESE_FRAGMENT') return config.cantoneseFragmentEnabled
  return config.falseTitleEnabled
}

export function scoreForWantListenAnswer(mode: WantListenMode, hintLevel: number) {
  if (mode !== 'WANT_LISTEN') return 100
  return ({ 1: 400, 2: 300, 3: 200, 4: 100 } as Record<number, number>)[hintLevel] || 100
}

export function difficultyForQuestion(position: number) {
  if (position <= 5) return 'EASY' as const
  if (position <= 15) return 'NORMAL' as const
  return 'HARD' as const
}

export function modeStatKey(mode: WantListenMode) {
  return mode === 'WANT_LISTEN'
    ? 'wantListen'
    : mode === 'CANTONESE_FRAGMENT'
      ? 'cantoneseFragment'
      : 'falseTitle'
}
