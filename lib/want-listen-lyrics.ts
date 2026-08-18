const LRC_TIMESTAMP = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/gu
const LRC_METADATA = /^\s*\[[^\]\r\n:]+:\s*/u
const LYRIC_TAG_LINE = /^\s*(?:\[[^\]\r\n]*\]|【[^】\r\n]*】|\([^\)\r\n]*\))\s*$/u
const SECTION_TAG_LINE = /^\s*(?:前奏|间奏|尾奏|主歌|副歌|桥段|verse|chorus|intro|outro|bridge)\s*[:：-]?\s*$/iu
const CREDIT_LINE = /^\s*(?:作词|作曲|編曲|编曲|制作人|监制|監製|填词|作詞|作曲)\s*[:：]/iu
const NOISE_LINE = /^(?:啊|呀|哦|喔|嗯|唉|啦|喽|哎|la|na|oh|yeah|ha)[!！,.，。…~～\s]*$/iu
const PUNCTUATION = /[，。！？；;,.!?、:：]/u
const SYMBOL_ONLY_LINE = /^[\s\p{P}\p{S}]+$/u
const HAN_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const CONTEXT_RADIUS = 2

export type LyricFragment = {
  answer: string
  /** The hidden line with a continuous segment (or the whole line) replaced by the placeholder. */
  context: string
  /** Full text of the hidden line. */
  sourceLine: string
  /** Index of the hidden line within the full lyric array (kept for backward compatibility). */
  lineIndex?: number
  /** Index of the anchor (window centre) line within the full lyric array. */
  anchorIndex?: number
  /** Position of the hidden line inside the 3-line window: 0 = previous, 1 = middle, 2 = next. */
  hiddenSlot?: number
}

function stripTimecodes(line: string) {
  return line.replace(LRC_TIMESTAMP, '').trim()
}

function stripLyricDecorations(value: string) {
  return value
    .replace(LRC_TIMESTAMP, '')
    .replace(/<[^>]*>/gu, '')
    .trim()
}

/**
 * A context line must contain real Han characters. Punctuation, separators,
 * timestamps, HTML and metadata are deliberately not considered clues.
 */
export function isValidLyricContext(text: string | null | undefined) {
  if (typeof text !== 'string') return false
  const normalized = stripLyricDecorations(text)
  if (
    !normalized
    || LRC_METADATA.test(normalized)
    || LYRIC_TAG_LINE.test(normalized)
    || SECTION_TAG_LINE.test(normalized)
    || CREDIT_LINE.test(normalized)
    || SYMBOL_ONLY_LINE.test(normalized)
  ) return false
  return HAN_CHARACTER.test(normalized.replace(/[\s\p{P}\p{S}]+/gu, ''))
}

function isValidLyricLine(text: string) {
  if (
    !text
    || LRC_METADATA.test(text)
    || LYRIC_TAG_LINE.test(text)
    || SECTION_TAG_LINE.test(text)
    || CREDIT_LINE.test(text)
    || NOISE_LINE.test(text)
    || SYMBOL_ONLY_LINE.test(text)
  ) return false
  return /[\p{L}\p{N}\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text)
}

export function cleanLyrics(raw: string | null | undefined) {
  if (!raw) return []

  return raw
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => stripTimecodes(line).replace(/<[^>]+>/gu, '').trim())
    .filter(isValidLyricLine)
}

export function normalizeLyricText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function lyricContainsTitle(line: string, title: string) {
  const normalizedLine = normalizeLyricText(line)
  const normalizedTitle = normalizeLyricText(title)
  return Boolean(normalizedTitle) && normalizedLine.includes(normalizedTitle)
}

function textLength(value: string) {
  return [...value.replace(/[\s\p{P}\p{S}]+/gu, '')].length
}

function trimAnswer(value: string) {
  return value.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '').trim()
}

function isContentCharacter(character: string) {
  return !PUNCTUATION.test(character) && !/\s/u.test(character)
}

/**
 * Choose a continuous segment of the hidden line to blank out. The segment must
 * contain at least 4 non-punctuation characters and may grow up to the whole
 * line. `random` drives both the segment length and its start position so the
 * same inputs stay reproducible in tests.
 */
function chooseHiddenSegment(line: string, random: () => number): { answer: string; context: string } | null {
  const characters = [...line]
  const contentIndices: number[] = []
  characters.forEach((character, index) => {
    if (isContentCharacter(character)) contentIndices.push(index)
  })
  const contentLength = contentIndices.length
  if (contentLength < 4) return null

  const minLength = 4
  const segmentLength = minLength + Math.floor(random() * (contentLength - minLength + 1))
  const start = Math.floor(random() * (contentLength - segmentLength + 1))
  if (segmentLength >= contentLength) {
    return { answer: trimAnswer(line), context: '____' }
  }

  const from = contentIndices[start]
  const to = contentIndices[start + segmentLength - 1]
  const span = line.slice(from, to + 1)
  const context = `${line.slice(0, from)}____${line.slice(to + 1)}`
  return { answer: trimAnswer(span), context }
}

function validContextLines(lines: readonly string[]) {
  return lines.filter(isValidLyricContext)
}

function contextLinesForIndex(lines: readonly string[], lineIndex: number, radius = CONTEXT_RADIUS) {
  const before = validContextLines(lines.slice(0, lineIndex)).slice(-radius)
  const after = validContextLines(lines.slice(lineIndex + 1)).slice(0, radius)
  return { before, after }
}

export function countValidLyricLines(text: string | null | undefined) {
  if (typeof text !== 'string') return 0
  return validContextLines(text.replace(/\r\n?/gu, '\n').split('\n')).length
}

/**
 * A fragment may have one valid side, but a boundary fragment then needs two
 * lyric lines on that side. A fragment with valid lyrics on both sides is
 * useful even when one side only has one line.
 */
export function hasSufficientLyricContext(before: string | null | undefined, after: string | null | undefined) {
  const beforeCount = countValidLyricLines(before)
  const afterCount = countValidLyricLines(after)
  return (beforeCount > 0 && afterCount > 0) || beforeCount >= 2 || afterCount >= 2
}

/**
 * Build the three-line lyric window around an anchor line. The window always
 * shows exactly three lines (the anchor plus one line of context on each side,
 * or two on the only available side at song boundaries) so a question never
 * displays more than three lyrics and never isolates a single line.
 */
function buildWindow(lines: readonly string[], anchorIndex: number): string[] {
  const beforeAll = validContextLines(lines.slice(0, anchorIndex))
  const afterAll = validContextLines(lines.slice(anchorIndex + 1))
  let beforeCount = beforeAll.length > 0 ? 1 : 0
  let afterCount = afterAll.length > 0 ? 1 : 0
  if (beforeAll.length === 0) afterCount = Math.min(2, afterAll.length)
  else if (afterAll.length === 0) beforeCount = Math.min(2, beforeAll.length)

  const before = beforeAll.slice(-beforeCount)
  const after = afterAll.slice(0, afterCount)
  return [...before, lines[anchorIndex], ...after]
}

export function lyricContextParts(lines: readonly string[], fragment: LyricFragment) {
  const maybeAnchorIndex = Number.isInteger(fragment.anchorIndex)
    ? fragment.anchorIndex
    : Number.isInteger(fragment.lineIndex)
      ? fragment.lineIndex
      : lines.indexOf(fragment.sourceLine)
  const anchorIndex = Number.isInteger(maybeAnchorIndex) ? (maybeAnchorIndex as number) : -1
  if (anchorIndex < 0) {
    return {
      before: '',
      after: '',
      masked: fragment.context,
      complete: fragment.sourceLine,
    }
  }

  // 每道题只展示三句歌词（上一句 / 隐藏句 / 下一句）。隐藏句在窗口中的位置
  // 由 hiddenSlot 决定（0=上一句、1=中间、2=下一句），可由随机生成；未指定时
  // 回退为旧行为：隐藏句即锚点句，依据其在窗口中的位置放置。
  const windowLines = buildWindow(lines, anchorIndex)
  const maybeHiddenSlot = Number.isInteger(fragment.hiddenSlot)
    ? fragment.hiddenSlot
    : windowLines.indexOf(fragment.sourceLine)
  let hiddenSlot = Number.isInteger(maybeHiddenSlot) ? (maybeHiddenSlot as number) : -1
  if (hiddenSlot < 0 || hiddenSlot >= windowLines.length) hiddenSlot = Math.floor(windowLines.length / 2)

  const maskedLines = windowLines.map((line, index) => (index === hiddenSlot ? fragment.context : line))
  const before = windowLines.slice(0, hiddenSlot).join('\n')
  const after = windowLines.slice(hiddenSlot + 1).join('\n')
  return {
    before,
    after,
    masked: maskedLines.join('\n'),
    complete: windowLines.join('\n'),
  }
}

export function selectLyricFragment(
  lines: readonly string[],
  position: number,
  random: () => number = Math.random,
): LyricFragment | null {
  // 锚点句必须拥有足够的上下文（两侧各一句，或单侧两句），保证隐藏其中任意一句后
  // 剩余窗口仍有有效上下文。锚点按题号确定性选取，便于同一对局复现。
  const anchorCandidates = lines
    .map((line, lineIndex) => {
      const { before, after } = contextLinesForIndex(lines, lineIndex)
      const beforeText = before.join('\n')
      const afterText = after.join('\n')
      if (!hasSufficientLyricContext(beforeText, afterText)) return null
      const contextQuality = (before.length > 0 && after.length > 0 ? 2 : 1) + before.length + after.length
      return { line, lineIndex, contextQuality }
    })
    .filter((candidate): candidate is { line: string; lineIndex: number; contextQuality: number } => candidate !== null)

  if (!anchorCandidates.length) return null

  const preferredPool = [...anchorCandidates].sort((left, right) => right.contextQuality - left.contextQuality)
  const anchor = preferredPool[Math.max(0, position - 1) * 17 % preferredPool.length]
  if (!anchor) return null

  const windowLines = buildWindow(lines, anchor.lineIndex)
  if (windowLines.length < 3) return null

  // 随机挑选窗口中的一句作为隐藏句，三种位置（上/中/下）等概率；该句需至少含
  // 4 个有效字以满足最小隐藏长度。
  const eligibleSlots = windowLines
    .map((line, slot) => ({ line, slot }))
    .filter(({ line }) => [...line].filter(isContentCharacter).length >= 4)
  if (!eligibleSlots.length) return null

  const chosenSlot = eligibleSlots[Math.floor(random() * eligibleSlots.length)].slot
  const hiddenLine = windowLines[chosenSlot]
  const segment = chooseHiddenSegment(hiddenLine, random)
  if (!segment) return null

  return {
    answer: segment.answer,
    context: segment.context,
    sourceLine: hiddenLine,
    lineIndex: anchor.lineIndex,
    anchorIndex: anchor.lineIndex,
    hiddenSlot: chosenSlot,
  }
}

export function selectSafeLyricSnippet(lines: readonly string[], title: string) {
  const candidates = lines
    .filter((line) => textLength(line) >= 8 && textLength(line) <= 80)
    .filter((line) => !lyricContainsTitle(line, title))
    .filter((line) => !SYMBOL_ONLY_LINE.test(line))

  if (!candidates.length) return null
  const selected = candidates[Math.min(2, candidates.length - 1)]
  return selected
}

export function lyricContext(lines: readonly string[], fragment: LyricFragment) {
  return lyricContextParts(lines, fragment).masked
}
