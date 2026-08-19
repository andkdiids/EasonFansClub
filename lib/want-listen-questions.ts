import { randomUUID } from 'node:crypto'
import {
  cleanLyrics,
  hasSufficientLyricContext,
  isValidLyricContext,
  lyricContextParts,
  selectLyricFragment,
} from '@/lib/want-listen-lyrics'
import { normalizeRatingLanguage, ratingLanguageLabel } from '@/lib/rating-types'
import { normalizeWantListenTitle } from '@/lib/want-listen-title'

export type WantListenSongCandidate = {
  id: string
  title: string
  releaseYear: number
  language: string | null
  lyricist: string | null
  composer: string | null
  arranger: string | null
  producer: string | null
  lyrics: string | null
  description: string | null
  story: string | null
  album: {
    id: string
    name: string
    releaseYear: number
    language: string | null
    coverUrl: string | null
  }
}

export type WantListenOption = { key: string; label: string }

export type WantListenStoredQuestion = {
  kind: 'want-listen' | 'cantonese-fragment' | 'false-title'
  options: WantListenOption[]
  songTitle?: string
  songId?: string
  hints?: Array<Record<string, unknown>>
  maskedContext?: string
  beforeContext?: string
  afterContext?: string
  completeContext?: string
  correctLyric?: string
  falseTitleDifficulty?: 'EASY' | 'NORMAL' | 'HARD'
  fakeTitleId?: string
}

export type WantListenBuiltQuestion = {
  data: WantListenStoredQuestion
  correctOptionKey: string
  sourceSongId?: string
}

function splitContextSides(maskedContext: string | null | undefined) {
  const lines = typeof maskedContext === 'string' ? maskedContext.split(/\r?\n/u) : []
  const targetIndex = lines.findIndex((line) => line.includes('____'))
  if (targetIndex < 0) return { before: '', after: '' }
  return {
    before: lines.slice(0, targetIndex).join('\n'),
    after: lines.slice(targetIndex + 1).join('\n'),
  }
}

/**
 * Validate persisted question data as well as freshly generated data. The
 * non-Cantonese modes intentionally remain unchanged.
 */
export function validateQuestion(question: WantListenStoredQuestion | null | undefined) {
  if (!question) return false
  if (question.kind !== 'cantonese-fragment') return true
  if (!Array.isArray(question.options) || question.options.length !== 4) return false
  if (!isValidLyricContext(question.correctLyric) || !question.maskedContext?.includes('____')) return false

  const extracted = splitContextSides(question.maskedContext)
  const before = question.beforeContext !== undefined ? question.beforeContext : extracted.before
  const after = question.afterContext !== undefined ? question.afterContext : extracted.after
  if (!hasSufficientLyricContext(before, after)) return false
  if (!hasSufficientLyricContext(extracted.before, extracted.after)) return false
  return question.completeContext === undefined || isValidLyricContext(question.completeContext)
}

/**
 * 选项 key 使用随机 UUID，杜绝语义化 key（correct/fake）泄露答案。
 * 客户端拿到的 options 只有随机 key + 文案，无法从中推导正确答案。
 */
function randomOptionKey(): string {
  return randomUUID()
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swapIndex]
    copy[swapIndex] = current
  }
  return copy
}

export function effectiveSongLanguage(song: Pick<WantListenSongCandidate, 'language' | 'album'>) {
  return song.language?.trim() || song.album.language?.trim() || null
}

export function effectiveSongYear(song: Pick<WantListenSongCandidate, 'releaseYear' | 'album'>) {
  const songYear = Number(song.releaseYear)
  if (Number.isInteger(songYear) && songYear >= 1900 && songYear <= 2100) return songYear
  const albumYear = Number(song.album.releaseYear)
  return Number.isInteger(albumYear) && albumYear >= 1900 && albumYear <= 2100 ? albumYear : null
}

export function isValidWantListenSong(song: WantListenSongCandidate) {
  return Boolean(
    song.id
    && song.title.trim()
    && effectiveSongLanguage(song)
    && effectiveSongYear(song),
  )
}

function uniqueTitles(songs: readonly WantListenSongCandidate[]) {
  const seen = new Set<string>()
  return songs.filter((song) => {
    const key = normalizeWantListenTitle(song.title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function languageMatches(left: WantListenSongCandidate, right: WantListenSongCandidate) {
  return normalizeRatingLanguage(effectiveSongLanguage(left)) === normalizeRatingLanguage(effectiveSongLanguage(right))
}

function chooseSongDistractors(song: WantListenSongCandidate, pool: readonly WantListenSongCandidate[], random: () => number) {
  const correctKey = normalizeWantListenTitle(song.title)
  const candidates = uniqueTitles(pool).filter((candidate) => normalizeWantListenTitle(candidate.title) !== correctKey)
  const ranked = candidates
    .map((candidate) => {
      const yearDistance = Math.abs((effectiveSongYear(candidate) || 0) - (effectiveSongYear(song) || 0))
      const sameAlbum = candidate.album.id === song.album.id
      return {
        candidate,
        closeness: (languageMatches(song, candidate) ? 1000 : 0) + (sameAlbum ? 200 : 0) + Math.max(0, 100 - yearDistance * 4),
      }
    })
    .sort((left, right) => right.closeness - left.closeness)

  const top = ranked.slice(0, Math.max(12, ranked.length)).map((item) => item.candidate)
  return shuffle(top, random).slice(0, 3)
}

export function buildWantListenQuestion(
  song: WantListenSongCandidate,
  pool: readonly WantListenSongCandidate[],
  random: () => number = Math.random,
): WantListenBuiltQuestion | null {
  if (!isValidWantListenSong(song)) return null
  const year = effectiveSongYear(song)
  const language = effectiveSongLanguage(song)
  if (!year || !language) return null
  const languageLabel = ratingLanguageLabel(language)

  const distractors = chooseSongDistractors(song, pool, random)
  if (distractors.length < 3) return null

  // 想听模式线索：每一步提供全新的歌曲信息；缺失的数据直接跳过（不展示空内容）。
  // 线索1：年份 + 语言（always 存在，由 isValidWantListenSong 保证）
  // 线索2：专辑（有封面带封面，无封面仅专辑名，绝不重复年份）
  // 线索3：作词人
  // 线索4：作曲人
  const albumHint = song.album.name
    ? (song.album.coverUrl
        ? { type: 'album-cover', albumName: song.album.name, coverUrl: song.album.coverUrl }
        : { type: 'album-text', text: `专辑：《${song.album.name}》` })
    : null
  const lyricistHint = song.lyricist?.trim()
    ? { type: 'credit', label: '作词', value: song.lyricist.trim() }
    : null
  const composerHint = song.composer?.trim()
    ? { type: 'credit', label: '作曲', value: song.composer.trim() }
    : null

  const hints: Array<Record<string, unknown>> = [
    { type: 'year-language', text: `${year} · ${languageLabel}` },
    ...(albumHint ? [albumHint] : []),
    ...(lyricistHint ? [lyricistHint] : []),
    ...(composerHint ? [composerHint] : []),
  ].filter(Boolean) as Array<Record<string, unknown>>

  // 最终线索：歌曲介绍（description 优先，回退 story），缺失则不展示。
  const songIntro = song.description?.trim() || song.story?.trim() || null

  const correctKey = randomOptionKey()
  const options = shuffle([
    { key: correctKey, label: song.title.trim() },
    ...distractors.map((candidate) => ({ key: randomOptionKey(), label: candidate.title.trim() })),
  ], random)

  return {
    sourceSongId: song.id,
    correctOptionKey: correctKey,
    data: { kind: 'want-listen', options, songId: song.id, songTitle: song.title.trim(), hints, completeContext: songIntro ?? undefined },
  }
}

function fragmentFromSong(song: WantListenSongCandidate, position: number, random: () => number = Math.random) {
  const lines = cleanLyrics(song.lyrics)
  const fragment = selectLyricFragment(lines, position, random)
  if (!fragment) return null
  return { fragment, lines }
}

export function buildCantoneseFragmentQuestion(
  song: WantListenSongCandidate,
  pool: readonly WantListenSongCandidate[],
  position: number,
  random: () => number = Math.random,
): WantListenBuiltQuestion | null {
  const source = fragmentFromSong(song, position, random)
  if (!source) return null
  const context = lyricContextParts(source.lines, source.fragment)
  const correct = source.fragment.answer
  const answerKey = normalizeWantListenTitle(correct)
  const distractors: string[] = []
  for (const candidate of shuffle(pool.filter((item) => item.id !== song.id), random)) {
    const fragment = fragmentFromSong(candidate, position, random)?.fragment
    if (!fragment) continue
    const key = normalizeWantListenTitle(fragment.answer)
    if (!key || key === answerKey || distractors.some((item) => normalizeWantListenTitle(item) === key)) continue
    if (Math.abs([...fragment.answer].length - [...correct].length) > 12) continue
    distractors.push(fragment.answer)
    if (distractors.length === 3) break
  }
  if (distractors.length < 3) return null

  const correctKey = randomOptionKey()
  const options = shuffle([
    { key: correctKey, label: correct },
    ...distractors.map((label) => ({ key: randomOptionKey(), label })),
  ], random)
  const data: WantListenStoredQuestion = {
    kind: 'cantonese-fragment',
    options,
    songId: song.id,
    songTitle: song.title.trim(),
    maskedContext: context.masked,
    beforeContext: context.before,
    afterContext: context.after,
    completeContext: context.complete,
    correctLyric: correct,
  }
  if (!validateQuestion(data)) return null

  return {
    sourceSongId: song.id,
    correctOptionKey: correctKey,
    data,
  }
}

export function buildFalseTitleQuestion(
  realTitles: readonly string[],
  fakeTitle: string,
  difficulty: 'EASY' | 'NORMAL' | 'HARD',
  random: () => number = Math.random,
): WantListenBuiltQuestion | null {
  const titles = [...new Set(realTitles.map((title) => title.trim()).filter(Boolean))]
  if (titles.length < 5 || !fakeTitle.trim()) return null
  const real = shuffle(titles, random).slice(0, 5)
  if (real.length < 5) return null
  const fakeKey = randomOptionKey()
  const options = shuffle([
    ...real.map((label) => ({ key: randomOptionKey(), label })),
    { key: fakeKey, label: fakeTitle.trim() },
  ], random)
  return {
    correctOptionKey: fakeKey,
    data: { kind: 'false-title', options, falseTitleDifficulty: difficulty },
  }
}
