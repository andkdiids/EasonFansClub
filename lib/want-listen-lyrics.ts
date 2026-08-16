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
  /** The source line with the selected answer replaced by the placeholder. */
  context: string
  sourceLine: string
  lineIndex?: number
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

function naturalParts(line: string) {
  const whitespaceParts = line.split(/\s+/u).map(trimAnswer).filter((part) => textLength(part) >= 2)
  if (whitespaceParts.length > 1) return whitespaceParts

  const parts: string[] = []
  let current = ''
  for (const character of [...line]) {
    current += character
    if (PUNCTUATION.test(character)) {
      const part = trimAnswer(current)
      if (textLength(part) >= 2) parts.push(part)
      current = ''
    }
  }
  const tail = trimAnswer(current)
  if (textLength(tail) >= 2) parts.push(tail)
  if (parts.length) return parts

  return [trimAnswer(line)].filter((part) => textLength(part) >= 2)
}

function replaceFirst(source: string, target: string, replacement: string) {
  const index = source.indexOf(target)
  if (index < 0) return null
  return `${source.slice(0, index)}${replacement}${source.slice(index + target.length)}`
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

export function lyricContextParts(lines: readonly string[], fragment: LyricFragment, radius = CONTEXT_RADIUS) {
  const explicitIndex = Number.isInteger(fragment.lineIndex) ? fragment.lineIndex : null
  const lineIndex = explicitIndex ?? lines.indexOf(fragment.sourceLine)
  if (lineIndex < 0) {
    return {
      before: '',
      after: '',
      masked: fragment.context,
      complete: fragment.sourceLine,
    }
  }

  const { before, after } = contextLinesForIndex(lines, lineIndex, radius)
  const maskedLines = [...before, fragment.context, ...after]
  const completeLines = [...before, fragment.sourceLine, ...after]
  return {
    before: before.join('\n'),
    after: after.join('\n'),
    masked: maskedLines.join('\n'),
    complete: completeLines.join('\n'),
  }
}

export function selectLyricFragment(lines: readonly string[], position: number): LyricFragment | null {
  const ranges = position <= 5
    ? { min: 2, max: 3 }
    : position <= 10
      ? { min: 4, max: 5 }
      : position <= 15
        ? { min: 5, max: 10 }
        : { min: 6, max: 18 }

  const candidates = lines.flatMap((line, lineIndex) => naturalParts(line)
    .filter(isValidLyricContext)
    .map((part) => ({ line, lineIndex, part, length: textLength(part) })))
    .map((candidate) => {
      const { before, after } = contextLinesForIndex(lines, candidate.lineIndex)
      const beforeText = before.join('\n')
      const afterText = after.join('\n')
      return {
        ...candidate,
        contextQuality: (before.length > 0 && after.length > 0 ? 2 : 1) + before.length + after.length,
        hasSufficientContext: hasSufficientLyricContext(beforeText, afterText),
      }
    })
    .filter((candidate) => {
      return candidate.hasSufficientContext
    })
  const suitable = candidates.filter((candidate) => candidate.length >= ranges.min && candidate.length <= ranges.max)
  const fallback = candidates.filter((candidate) => candidate.length >= Math.max(2, ranges.min - 1) && candidate.length <= 24)
  const pool = suitable.length ? suitable : fallback
  if (!pool.length) return null

  const preferredPool = [...pool].sort((left, right) => right.contextQuality - left.contextQuality)
  const selected = preferredPool[(Math.max(0, position - 1) * 17) % preferredPool.length]
  const context = replaceFirst(selected.line, selected.part, '____')
  if (!context || context === selected.line || textLength(selected.part) < 2) return null
  return { answer: selected.part, context, sourceLine: selected.line, lineIndex: selected.lineIndex }
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

export function lyricContext(lines: readonly string[], fragment: LyricFragment, radius = CONTEXT_RADIUS) {
  return lyricContextParts(lines, fragment, radius).masked
}
