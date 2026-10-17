import { formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { TOPIC_ACTIVITY_V2_POSTER_SIZE } from '@/lib/topic-activity-v2-config'

export const TOPIC_POSTER_SIZE = TOPIC_ACTIVITY_V2_POSTER_SIZE
// Keep the complete title/ribbon of the shared 9:16 artwork clear after its centered 3:4 crop.
export const HERO_SAFE_BOTTOM = 510
export const TOP_VISUAL_SAFE_ZONE = HERO_SAFE_BOTTOM
export const ACTIVITY_INFO_START_Y = 560
export const ACTIVITY_INFO_HEIGHT = 158
export const ACTIVITY_INFO_GAP = 52
export const HERO_ACTIVITY_GAP = ACTIVITY_INFO_START_Y - HERO_SAFE_BOTTOM
export const USER_ZONE_START = 1100
export const RESULT_USER_GAP = 28
// The tilted result strip extends slightly above its card's unrotated top edge.
export const RESULT_TOP_VISUAL_CLEARANCE = 6
export const RESULT_START_Y = ACTIVITY_INFO_START_Y + ACTIVITY_INFO_HEIGHT + ACTIVITY_INFO_GAP + RESULT_TOP_VISUAL_CLEARANCE
export const RESULT_MAX_BOTTOM = USER_ZONE_START - RESULT_USER_GAP
export const FOOTER_SAFE_BOTTOM = 62
export const TOPIC_POSTER_ACTIVITY_INFO = { top: ACTIVITY_INFO_START_Y, height: ACTIVITY_INFO_HEIGHT } as const
export const TOPIC_POSTER_RESULT = {
  top: RESULT_START_Y,
  titleBaseline: RESULT_START_Y + 74,
  titleSize: 60,
  titleMinSize: 38,
  titleLineHeight: 66,
  descriptionSize: 30,
  descriptionMinSize: 22,
  descriptionLineHeight: 36,
  minBottom: RESULT_START_Y + 196,
  maxBottom: RESULT_MAX_BOTTOM,
} as const
export const TOPIC_POSTER_PANELS = {
  activityWidth: 940,
  resultWidth: 932,
  titleWidth: 900,
  descriptionWidth: 856,
  titleTextWidth: 820,
  descriptionTextWidth: 800,
  testTextWidth: 590,
  identityQrWidth: 500,
} as const
export const TOPIC_POSTER_BRAND = { left: 350, top: 1324, width: 380, height: 54 } as const
export const TOPIC_POSTER_AVATAR = { left: 100, top: USER_ZONE_START + 20, size: 144 } as const
// Right-side QR when identity is shown; `topicPosterQr` centers it when it is alone.
export const TOPIC_POSTER_QR = { left: 820, top: USER_ZONE_START + 8, size: 190 } as const
export const TOPIC_POSTER_QR_BRAND = { padding: 12, logoSize: 38, plateSize: 46, radius: 8 } as const
export const TOPIC_POSTER_FONT = 'Noto Sans SC, Noto Sans CJK SC, sans-serif'

export function topicPosterQr(config: Record<string, unknown>) {
  const left = config.showNickname === true
    ? TOPIC_POSTER_QR.left
    : Math.round((TOPIC_POSTER_SIZE.width - TOPIC_POSTER_QR.size) / 2)
  return { ...TOPIC_POSTER_QR, left }
}

/** Keep optional identity and QR balanced in the bottom band on the 3:4 canvas. */
export function topicPosterFooter(config: Record<string, unknown>) {
  const hasOptionalContent = config.showNickname === true || config.showQrCode === true
  return { ...TOPIC_POSTER_BRAND, top: hasOptionalContent ? 1324 : 1290, textLeft: TOPIC_POSTER_SIZE.width / 2, baseline: hasOptionalContent ? 1358 : 1324, fontSize: 27, centerText: true }
}

function text(value: unknown) {
  if (typeof value !== 'string') return ''
  const cleaned = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
  return graphemes(cleaned).slice(0, 4096).join('')
}
function escape(value: string) {
  return value.replace(/[<>&"']/gu, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!))
}

// Conservative em widths for the bundled Noto font, including Latin and emoji.
function em(character: string) {
  if (/^[\x20-\x7e]$/u.test(character)) return /[MW@%]/u.test(character) ? 1 : 0.7
  return 1.08
}
function graphemes(value: string) {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (part) => part.segment)
  }

  // Older runtimes still keep surrogate pairs, combining marks, ZWJ sequences,
  // variation selectors, skin tones and paired regional indicators together.
  const result: string[] = []
  let regionalIndicators = 0
  for (const character of Array.from(value)) {
    const isRegional = /^[\u{1f1e6}-\u{1f1ff}]$/u.test(character)
    const joinsPrevious = result.length > 0 && (
      /^\p{Mark}$/u.test(character) || /^[\ufe00-\ufe0f]$/u.test(character) || /^[\u{1f3fb}-\u{1f3ff}]$/u.test(character) ||
      character === '\u200d' || result[result.length - 1].endsWith('\u200d') || (isRegional && regionalIndicators % 2 === 1)
    )
    if (joinsPrevious) result[result.length - 1] += character
    else result.push(character)
    regionalIndicators = isRegional ? regionalIndicators + 1 : 0
  }
  return result
}
function measuredWidth(value: string, fontSize: number) {
  return graphemes(value).reduce((sum, character) => sum + em(character) * fontSize, 0)
}

type WrappedText = { lines: string[]; overflow: boolean }
export type FittedPosterText = { lines: string[]; fontSize: number; lineHeight: number; truncated: boolean }

function wrapPosterText(value: unknown, width: number, fontSize: number, maxLines: number): WrappedText {
  if (maxLines <= 0) return { lines: [], overflow: Boolean(text(value)) }
  const characters = graphemes(text(value))
  if (!characters.length) return { lines: [], overflow: false }

  const lines: string[] = []
  let line = ''
  let overflow = false
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]
    if (character === '\n') {
      lines.push(line)
      line = ''
      if (lines.length >= maxLines && characters.slice(index + 1).some((next) => next !== '\n')) {
        overflow = true
        break
      }
      continue
    }

    if (line && measuredWidth(line + character, fontSize) > width) {
      lines.push(line)
      line = ''
      if (lines.length >= maxLines) {
        overflow = true
        break
      }
    }
    line += character
  }

  if (!overflow && (line || lines.length === 0)) {
    if (lines.length < maxLines) lines.push(line)
    else overflow = true
  }
  return { lines: lines.slice(0, maxLines), overflow }
}

function appendUnicodeEllipsis(line: string, width: number, fontSize: number) {
  const characters = graphemes(line)
  while (characters.length && measuredWidth(characters.join('') + '…', fontSize) > width) characters.pop()
  return characters.join('') + '…'
}

/**
 * Wraps at Unicode code-point boundaries and bounds output to maxLines.
 * The final ellipsis is added only after wrapping still exceeds that limit.
 */
export function posterTextLines(value: unknown, width: number, fontSize: number, maxLines: number) {
  const wrapped = wrapPosterText(value, width, fontSize, maxLines)
  if (wrapped.overflow && wrapped.lines.length) {
    wrapped.lines[wrapped.lines.length - 1] = appendUnicodeEllipsis(wrapped.lines[wrapped.lines.length - 1], width, fontSize)
  }
  return wrapped.lines
}

/** Shrinks in small steps until the value fits the requested width and line count. */
export function fitPosterText(value: unknown, width: number, fontSize: number, minFontSize: number, maxLines: number, lineHeightRatio = 1.1): FittedPosterText {
  const minimum = Math.max(1, Math.min(fontSize, minFontSize))
  for (let size = fontSize; size >= minimum; size -= 2) {
    const wrapped = wrapPosterText(value, width, size, maxLines)
    if (!wrapped.overflow) return { lines: wrapped.lines, fontSize: size, lineHeight: Math.ceil(size * lineHeightRatio), truncated: false }
  }
  const wrapped = wrapPosterText(value, width, minimum, maxLines)
  if (wrapped.overflow && wrapped.lines.length) {
    wrapped.lines[wrapped.lines.length - 1] = appendUnicodeEllipsis(wrapped.lines[wrapped.lines.length - 1], width, minimum)
  }
  return { lines: wrapped.lines, fontSize: minimum, lineHeight: Math.ceil(minimum * lineHeightRatio), truncated: wrapped.overflow }
}

/** Fits wrapped text to both width and a fixed vertical allowance before truncating. */
export function fitPosterTextInHeight(
  value: unknown,
  width: number,
  fontSize: number,
  minFontSize: number,
  availableHeight: number,
  lineHeightRatio = 1.2,
  maxLines = 6,
): FittedPosterText {
  const minimum = Math.max(1, Math.min(fontSize, minFontSize))
  const available = Math.max(0, Math.floor(availableHeight))
  for (let size = fontSize; size >= minimum; size -= 2) {
    const lineHeight = Math.ceil(size * lineHeightRatio)
    const allowedLines = Math.min(maxLines, Math.floor(available / lineHeight))
    if (allowedLines < 1) continue
    const wrapped = wrapPosterText(value, width, size, allowedLines)
    if (!wrapped.overflow) return { lines: wrapped.lines, fontSize: size, lineHeight, truncated: false }
  }

  const lineHeight = Math.ceil(minimum * lineHeightRatio)
  const allowedLines = Math.min(maxLines, Math.floor(available / lineHeight))
  if (allowedLines < 1) return { lines: [], fontSize: minimum, lineHeight, truncated: Boolean(text(value)) }
  const wrapped = wrapPosterText(value, width, minimum, allowedLines)
  if (wrapped.overflow && wrapped.lines.length) {
    wrapped.lines[wrapped.lines.length - 1] = appendUnicodeEllipsis(wrapped.lines[wrapped.lines.length - 1], width, minimum)
  }
  return { lines: wrapped.lines, fontSize: minimum, lineHeight, truncated: wrapped.overflow }
}

function date(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : formatBeijingDateTimeMinute(parsed).replace(/-/gu, '.')
}

export function topicPosterTimeRange(start: unknown, end: unknown) {
  const from = date(start), to = date(end)
  return from && to ? `${from} - ${to}` : from ? `${from} 起` : to ? `截至 ${to}` : '活动时间以活动页面为准'
}

function lines(values: string[], x: number, y: number, size: number, height: number, weight = 700, anchor?: 'middle') {
  return values.map((value, index) => `<text x="${x}" y="${y + index * height}" font-size="${size}" font-weight="${weight}"${anchor ? ' text-anchor="middle"' : ''}>${escape(value)}</text>`).join('')
}

// Deterministic paper edges: no filters, remote fonts, or additional image slots.
function paper(x: number, y: number, width: number, height: number, fill: string, opacity = 1) {
  const points = [[8, 5], [width * .22, 0], [width * .24, 5], [width * .55, 2], [width * .57, 6], [width - 5, 3],
    [width - 9, height * .25], [width, height * .38], [width - 6, height * .67], [width - 2, height * .8], [width - 9, height - 3],
    [width * .76, height], [width * .74, height - 4], [width * .42, height + 1], [width * .4, height - 3], [5, height],
    [9, height * .76], [1, height * .64], [6, height * .35], [0, height * .23]]
  return `<polygon points="${points.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ')}" fill="${fill}" fill-opacity="${opacity}"/>`
}

export function topicPosterLayout(snapshot: Record<string, unknown>) {
  const config = snapshot.poster && typeof snapshot.poster === 'object' ? snapshot.poster as Record<string, unknown> : {}
  const activityTop = TOPIC_POSTER_ACTIVITY_INFO.top
  const result = TOPIC_POSTER_RESULT
  const testTitle = text(snapshot.testTitle) || text(snapshot.activityTitle) || '私家E院话题活动'
  const title = fitPosterText(text(snapshot.title) || '测试结果', TOPIC_POSTER_PANELS.titleTextWidth, result.titleSize, result.titleMinSize, 2, 1.1)
  const test = fitPosterText(testTitle, TOPIC_POSTER_PANELS.testTextWidth, 32, 24, 2, 1.08)
  const time = fitPosterText(topicPosterTimeRange(snapshot.activityStartsAt, snapshot.activityEndsAt), 610, 24, 18, 1, 1.1)
  const hasScore = typeof snapshot.score === 'number' && Number.isFinite(snapshot.score)
  const score = hasScore
    ? `得分 ${snapshot.score}${typeof snapshot.maxScore === 'number' && Number.isFinite(snapshot.maxScore) ? ` / ${snapshot.maxScore}` : ''}`
    : ''
  const titleLineHeight = title.lines.length > 0 ? title.lineHeight : result.titleLineHeight
  const descriptionTop = result.titleBaseline + title.lines.length * titleLineHeight + 12
  const resultBottomLimit = Math.min(result.maxBottom, USER_ZONE_START - RESULT_USER_GAP)
  const descriptionAllowance = Math.max(0, resultBottomLimit - descriptionTop - (score ? 84 : 28))
  const description = fitPosterTextInHeight(snapshot.description, TOPIC_POSTER_PANELS.descriptionTextWidth,
    result.descriptionSize, result.descriptionMinSize, descriptionAllowance, 1.2, 6)
  const descriptionBottom = description.lines.length
    ? descriptionTop + (description.lines.length - 1) * description.lineHeight + Math.ceil(description.fontSize * 1.15)
    : descriptionTop
  const scoreBaseline = descriptionTop + description.lines.length * description.lineHeight + 22
  const bottom = Math.min(resultBottomLimit, Math.max(result.minBottom,
    Math.ceil(descriptionBottom + (score ? 58 : 24))))
  const timeText = time.lines[0] || ''
  const nickname = config.showNickname === true
    ? fitPosterText(text(snapshot.nickname) || '私家E院会员', config.showQrCode === true ? 420 : 610, 34, 25, 2, 1.12)
    : { lines: [], fontSize: 34, lineHeight: 38, truncated: false }
  const brand = topicPosterFooter(config)

  const identity = nickname.lines.length ? `${paper(260, 1120, config.showQrCode === true ? TOPIC_POSTER_PANELS.identityQrWidth : 720, 132, '#fffdf7', .96)}
    <circle cx="172" cy="1192" r="76" fill="#fffdf7"/><circle cx="172" cy="1192" r="70" fill="#ffdc52"/>
    ${lines([graphemes(nickname.lines[0])[0] || 'E'], 150, 1212, 52, 52, 850)}
    ${lines(nickname.lines, 292, 1182, nickname.fontSize, nickname.lineHeight, 800)}<path d="M292 1240 Q460 1228 638 1238" fill="none" stroke="#ffcf22" stroke-width="7"/>` : ''

  const { width, height } = TOPIC_POSTER_SIZE
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <g font-family="${TOPIC_POSTER_FONT}" fill="#141414">
      <g data-poster-group="activity">
        ${paper(70, activityTop, TOPIC_POSTER_PANELS.activityWidth, TOPIC_POSTER_ACTIVITY_INFO.height, '#fffdf7', .97)}
        ${paper(142, activityTop + 17, 196, 40, '#ffe259')}${paper(142, activityTop + 104, 196, 40, '#ffe259')}
        <g transform="translate(100 ${activityTop + 24}) rotate(-8)" stroke="#161616" stroke-width="4" stroke-linejoin="round"><path d="M0 8 L27 0 V32 L0 23 Z" fill="#ffe259"/><path d="M4 24 l4 15 h9 l-4 -14" fill="#ffe259"/><path d="M34 4 l10 -5 M35 16 h13 M34 28 l10 5" fill="none"/></g>
        <g transform="translate(100 ${activityTop + 105}) rotate(4)" stroke="#161616" stroke-width="4"><rect width="34" height="34" fill="#fffdf7"/><path d="M0 10 h34 M8 -5 v12 M26 -5 v12"/><path d="M8 20 h5 M22 20 h5"/></g>
        ${lines(['活动测试：'], 148, activityTop + 46, 28, 36, 850)}${lines(test.lines, 352, activityTop + (test.lines.length > 1 ? 40 : 48), test.fontSize, test.lineHeight)}
        ${lines(['活动时间：'], 148, activityTop + 133, 28, 36, 850)}${lines([timeText], 352, activityTop + 133, time.fontSize, time.lineHeight, 650)}
      </g>
      <g data-poster-group="result">
        ${paper(74, result.top, TOPIC_POSTER_PANELS.resultWidth, bottom - result.top, '#fffdf7', .94)}
        <g transform="rotate(-1.2 530 ${result.top + 78})">${paper(86, result.top + 18, TOPIC_POSTER_PANELS.titleWidth, title.lines.length * titleLineHeight + 24, '#f59ac8')}${lines(title.lines, 118, result.titleBaseline, title.fontSize, titleLineHeight, 900)}</g>
        ${description.lines.length ? paper(104, descriptionTop - 29, TOPIC_POSTER_PANELS.descriptionWidth, 40, '#ffe259', .94) : ''}
        ${lines(description.lines, 118, descriptionTop, description.fontSize, description.lineHeight, 650)}
        ${score ? lines([score], 118, scoreBaseline, 28, 36, 750) : ''}
      </g>
      ${identity ? `<g data-poster-group="identity">${identity}</g>` : ''}
      <g data-poster-group="brand">${paper(brand.left, brand.top, brand.width, brand.height, '#ffe259')}${lines(['私家E院 · ECFC'], brand.textLeft, brand.baseline, brand.fontSize, 36, 850, 'middle')}</g>
    </g></svg>`
}
