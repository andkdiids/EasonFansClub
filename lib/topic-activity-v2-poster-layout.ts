import { formatBeijingDateTimeMinute } from '@/lib/beijing-time'

export const TOPIC_POSTER_SIZE = { width: 1080, height: 1920 } as const
// The uploaded artwork owns this entire band; dynamic paper/text starts below it.
export const TOP_VISUAL_SAFE_ZONE = 620
export const TOPIC_POSTER_ACTIVITY_INFO = { top: 760, height: 170 } as const
export const TOPIC_POSTER_RESULT = { top: 995, titleBaseline: 1070, titleSize: 64, titleLineHeight: 74, descriptionSize: 34, descriptionLineHeight: 44, minBottom: 1230, maxBottom: 1460 } as const
export const TOPIC_POSTER_PANELS = { activityWidth: 870, resultWidth: 866, titleWidth: 838, descriptionWidth: 794, titleTextWidth: 760, descriptionTextWidth: 744, testTextWidth: 586, identityQrWidth: 414 } as const
export const TOPIC_POSTER_BRAND = { left: 280, top: 1748, width: 420, height: 60 } as const
export const TOPIC_POSTER_AVATAR = { left: 96, top: 1545, size: 176 } as const
export const TOPIC_POSTER_QR = { left: 720, top: 1545, size: 240 } as const
export const TOPIC_POSTER_QR_BRAND = { padding: 12, logoSize: 44, plateSize: 52, radius: 8 } as const
export const TOPIC_POSTER_FONT = 'Noto Sans SC, Noto Sans CJK SC, sans-serif'

/** Missing legacy flags are private by default. Rebalance only the optional footer. */
export function topicPosterFooter(config: Record<string, unknown>) {
  const nickname = config.showNickname === true, qr = config.showQrCode === true
  if (nickname && qr) return { ...TOPIC_POSTER_BRAND, textLeft: 330, baseline: 1790, fontSize: 28, centerText: false }
  if (nickname) return { ...TOPIC_POSTER_BRAND, left: 220, width: 640, textLeft: 540, baseline: 1790, fontSize: 28, centerText: true }
  if (qr) return { left: 96, top: 1590, width: 560, height: 140, textLeft: 376, baseline: 1678, fontSize: 40, centerText: true }
  return { left: 170, top: 1580, width: 740, height: 170, textLeft: 540, baseline: 1686, fontSize: 48, centerText: true }
}

function text(value: unknown) { return typeof value === 'string' ? value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').slice(0, 4096) : '' }
function escape(value: string) { return value.replace(/[<>&"']/gu, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!)) }

// Conservative em widths for the bundled Noto font, including Latin/emoji names.
function em(c: string) { return /^[\x20-\x7e]$/u.test(c) ? (/[MW@%]/u.test(c) ? 1 : 0.7) : 1.08 }
export function posterTextLines(value: unknown, width: number, fontSize: number, maxLines: number) {
  const lines: string[] = []
  let line = '', used = 0
  for (const c of Array.from(text(value))) {
    if (c === '\n' || used + em(c) * fontSize > width) {
      lines.push(line); line = ''; used = 0
      if (lines.length === maxLines) {
        let last = lines[maxLines - 1]
        while (Array.from(last + '…').reduce((sum, char) => sum + em(char) * fontSize, 0) > width) last = Array.from(last).slice(0, -1).join('')
        lines[maxLines - 1] = last + '…'
        return lines
      }
      if (c === '\n') continue
    }
    line += c; used += em(c) * fontSize
  }
  if (line) lines.push(line)
  return lines
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
  return values.map((value, i) => `<text x="${x}" y="${y + i * height}" font-size="${size}" font-weight="${weight}"${anchor ? ' text-anchor="middle"' : ''}>${escape(value)}</text>`).join('')
}

// Deterministic paper edges: no filters, remote fonts, or additional image slots.
function paper(x: number, y: number, w: number, h: number, fill: string, opacity = 1) {
  const points = [[8, 5], [w * .22, 0], [w * .24, 5], [w * .55, 2], [w * .57, 6], [w - 5, 3],
    [w - 9, h * .25], [w, h * .38], [w - 6, h * .67], [w - 2, h * .8], [w - 9, h - 3],
    [w * .76, h], [w * .74, h - 4], [w * .42, h + 1], [w * .4, h - 3], [5, h],
    [9, h * .76], [1, h * .64], [6, h * .35], [0, h * .23]]
  return `<polygon points="${points.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ')}" fill="${fill}" fill-opacity="${opacity}"/>`
}

export function topicPosterLayout(snapshot: Record<string, unknown>) {
  const config = snapshot.poster && typeof snapshot.poster === 'object' ? snapshot.poster as Record<string, unknown> : {}
  const activityTop = TOPIC_POSTER_ACTIVITY_INFO.top
  const result = TOPIC_POSTER_RESULT
  const testTitle = text(snapshot.testTitle) || text(snapshot.activityTitle) || '私家E院话题活动'
  const title = posterTextLines(text(snapshot.title) || '测试结果', TOPIC_POSTER_PANELS.titleTextWidth, result.titleSize, 2)
  const description = posterTextLines(snapshot.description, TOPIC_POSTER_PANELS.descriptionTextWidth, result.descriptionSize, 5)
  const test = posterTextLines(testTitle, TOPIC_POSTER_PANELS.testTextWidth, 32, 2)
  const time = topicPosterTimeRange(snapshot.activityStartsAt, snapshot.activityEndsAt)
  const nickname = config.showNickname === true ? posterTextLines(text(snapshot.nickname) || '私家E院会员', config.showQrCode === true ? 374 : 608, 40, 2) : []
  const brand = topicPosterFooter(config)
  const descriptionTop = result.titleBaseline + title.length * result.titleLineHeight
  const score = typeof snapshot.score === 'number' && Number.isFinite(snapshot.score)
    ? `得分 ${snapshot.score}${typeof snapshot.maxScore === 'number' && Number.isFinite(snapshot.maxScore) ? ` / ${snapshot.maxScore}` : ''}` : ''
  const bottom = Math.min(result.maxBottom, Math.max(result.minBottom, descriptionTop + Math.max(0, description.length - 1) * result.descriptionLineHeight + 42 + (score ? 52 : 0)))
  const identity = nickname.length ? `${paper(282, 1576, config.showQrCode === true ? TOPIC_POSTER_PANELS.identityQrWidth : 650, 142, '#fffdf7', .96)}
    <circle cx="184" cy="1633" r="94" fill="#fffdf7"/><circle cx="184" cy="1633" r="87" fill="#ffdc52"/>
    ${lines([Array.from(nickname[0])[0] || 'E'], 153, 1656, 64, 64, 850)}
    ${lines(nickname, 308, 1630, 40, 50, 800)}<path d="M308 1693 Q480 1681 667 1690" fill="none" stroke="#ffcf22" stroke-width="8"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <g font-family="${TOPIC_POSTER_FONT}" fill="#141414">
      <g data-poster-group="activity">
        ${paper(70, activityTop, TOPIC_POSTER_PANELS.activityWidth, TOPIC_POSTER_ACTIVITY_INFO.height, '#fffdf7', .97)}
        ${paper(142, activityTop + 21, 208, 42, '#ffe259')}${paper(142, activityTop + 110, 208, 42, '#ffe259')}
        <g transform="translate(100 ${activityTop + 28}) rotate(-8)" stroke="#161616" stroke-width="4" stroke-linejoin="round"><path d="M0 8 L27 0 V32 L0 23 Z" fill="#ffe259"/><path d="M4 24 l4 15 h9 l-4 -14" fill="#ffe259"/><path d="M34 4 l10 -5 M35 16 h13 M34 28 l10 5" fill="none"/></g>
        <g transform="translate(100 ${activityTop + 112}) rotate(4)" stroke="#161616" stroke-width="4"><rect width="34" height="34" fill="#fffdf7"/><path d="M0 10 h34 M8 -5 v12 M26 -5 v12"/><path d="M8 20 h5 M22 20 h5"/></g>
        ${lines(['活动测试：'], 154, activityTop + 48, 30, 40, 850)}${lines(test, 362, activityTop + (test.length > 1 ? 42 : 49), 32, 39)}
        ${lines(['活动时间：'], 154, activityTop + 140, 30, 40, 850)}${lines([time], 362, activityTop + 140, 26, 38, 650)}
      </g>
      <g data-poster-group="result">
        ${paper(74, result.top, TOPIC_POSTER_PANELS.resultWidth, bottom - result.top, '#fffdf7', .94)}
        <g transform="rotate(-1.2 530 ${result.top + 86})">${paper(86, result.top + 18, TOPIC_POSTER_PANELS.titleWidth, title.length * result.titleLineHeight + 24, '#f59ac8')}${lines(title, 118, result.titleBaseline, result.titleSize, result.titleLineHeight, 900)}</g>
        ${description.length ? paper(104, descriptionTop - 38, TOPIC_POSTER_PANELS.descriptionWidth, 50, '#ffe259', .94) : ''}
        ${lines(description, 118, descriptionTop, result.descriptionSize, result.descriptionLineHeight, 650)}
        ${score ? lines([score], 118, bottom - 24, 34, 44, 750) : ''}
      </g>
      ${identity ? `<g data-poster-group="identity">${identity}</g>` : ''}
      <g data-poster-group="brand">${paper(brand.left, brand.top, brand.width, brand.height, '#ffe259')}${lines(['私家E院 · ECFC'], brand.textLeft, brand.baseline, brand.fontSize, 36, 850, brand.centerText ? 'middle' : undefined)}</g>
    </g></svg>`
}
