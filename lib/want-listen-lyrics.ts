const LRC_TIMESTAMP = /^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/u
const LRC_METADATA = /^\s*\[(?:ar|ti|al|by|re|ve|length|offset|作词|作曲|编曲|制作人|填词|監製|监制)\s*:/iu
const CREDIT_LINE = /^\s*(?:作词|作曲|編曲|编曲|制作人|监制|監製|填词|作詞|作曲)\s*[:：]/iu
const NOISE_LINE = /^(?:啊|呀|哦|喔|嗯|唉|啦|喽|哎|la|na|oh|yeah|ha)[!！,.，。…~～\s]*$/iu
const PUNCTUATION = /[，。！？；;,.!?、:：]/u

export type LyricFragment = {
  answer: string
  context: string
  sourceLine: string
}

function stripTimecodes(line: string) {
  return line.replace(LRC_TIMESTAMP, '').replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/gu, '').trim()
}

export function cleanLyrics(raw: string | null | undefined) {
  if (!raw) return []

  return raw
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => stripTimecodes(line).replace(/<[^>]+>/gu, '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !LRC_METADATA.test(line))
    .filter((line) => !CREDIT_LINE.test(line))
    .filter((line) => !NOISE_LINE.test(line))
    .filter((line) => !/^\s*[-_=*#~·•]+\s*$/u.test(line))
}

export function normalizeLyricText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s，。！？；;,.!?、:："“”‘’'《》〈〉【】\[\]()（）…—–-]+/gu, '')
}

export function lyricContainsTitle(line: string, title: string) {
  const normalizedLine = normalizeLyricText(line)
  const normalizedTitle = normalizeLyricText(title)
  return Boolean(normalizedTitle) && normalizedLine.includes(normalizedTitle)
}

function textLength(value: string) {
  return [...value.replace(/[\s，。！？；;,.!?、:：]+/gu, '')].length
}

function trimAnswer(value: string) {
  return value.replace(/^[\s，。！？；;,.!?、:：]+|[\s，。！？；;,.!?、:：]+$/gu, '').trim()
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

export function selectLyricFragment(lines: readonly string[], position: number): LyricFragment | null {
  const ranges = position <= 5
    ? { min: 2, max: 3 }
    : position <= 10
      ? { min: 4, max: 5 }
      : position <= 15
        ? { min: 5, max: 10 }
        : { min: 6, max: 18 }

  const candidates = lines.flatMap((line) => naturalParts(line).map((part) => ({ line, part, length: textLength(part) })))
  const suitable = candidates.filter((candidate) => candidate.length >= ranges.min && candidate.length <= ranges.max)
  const fallback = candidates.filter((candidate) => candidate.length >= Math.max(2, ranges.min - 1) && candidate.length <= 24)
  const pool = suitable.length ? suitable : fallback
  if (!pool.length) return null

  const selected = pool[(Math.max(0, position - 1) * 17) % pool.length]
  const context = replaceFirst(selected.line, selected.part, '____')
  if (!context || context === selected.line || textLength(selected.part) < 2) return null
  return { answer: selected.part, context, sourceLine: selected.line }
}

export function selectSafeLyricSnippet(lines: readonly string[], title: string) {
  const candidates = lines
    .filter((line) => textLength(line) >= 8 && textLength(line) <= 80)
    .filter((line) => !lyricContainsTitle(line, title))
    .filter((line) => !/^\s*[_-]+\s*$/u.test(line))

  if (!candidates.length) return null
  const selected = candidates[Math.min(2, candidates.length - 1)]
  return selected
}

export function lyricContext(lines: readonly string[], fragment: LyricFragment, radius = 1) {
  const index = lines.indexOf(fragment.sourceLine)
  if (index < 0) return fragment.context
  return lines
    .slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1))
    .map((line) => line === fragment.sourceLine ? fragment.context : line)
    .join('\n')
}
