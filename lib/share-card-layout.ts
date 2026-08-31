import { sanitizeShareCardText, shareCardTypeLabel, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { tokenizeShareCardText } from '@/lib/share-card-emoji'
import { getForumBoardDisplayName } from '@/lib/boards'

/** Default Hero height used when an image has no readable dimensions. */
export const SHARE_CARD_HERO_HEIGHT = 660
export const SHARE_CARD_PORTRAIT_HERO_HEIGHT = Math.round(SHARE_CARD_WIDTH * 4 / 3)
export const SHARE_CARD_LANDSCAPE_MIN_HERO_HEIGHT = 360
/** Kept as compatibility constants; the content overlay follows the Hero. */
export const SHARE_CARD_PANEL_TOP = SHARE_CARD_HERO_HEIGHT
export const SHARE_CARD_PANEL_X = 0
export const SHARE_CARD_PANEL_WIDTH = SHARE_CARD_WIDTH
export const SHARE_CARD_PANEL_PADDING_X = 72
export const SHARE_CARD_TEXT_WIDTH = SHARE_CARD_PANEL_WIDTH - SHARE_CARD_PANEL_PADDING_X * 2
export const SHARE_CARD_QR_SIZE = 224
export const SHARE_CARD_QR_FRAME_X = 788
export const SHARE_CARD_QR_FRAME_SIZE = 232
export const SHARE_CARD_QR_X = 792
export const SHARE_CARD_AVATAR_SIZE = 86
export const SHARE_CARD_AVATAR_X = SHARE_CARD_PANEL_PADDING_X
export const SHARE_CARD_AUTHOR_X = SHARE_CARD_AVATAR_X + SHARE_CARD_AVATAR_SIZE + 26
export const SHARE_CARD_AUTHOR_WIDTH = SHARE_CARD_QR_FRAME_X - SHARE_CARD_AUTHOR_X - 28
export const SHARE_CARD_FOOTER_LOGO_SIZE = 84
export const SHARE_CARD_FOOTER_LOGO_X = SHARE_CARD_PANEL_PADDING_X
export const SHARE_CARD_FOOTER_TEXT_X = SHARE_CARD_FOOTER_LOGO_X + SHARE_CARD_FOOTER_LOGO_SIZE + 12
/** Keep the footer copy to the left of the QR frame. */
export const SHARE_CARD_FOOTER_TEXT_WIDTH = SHARE_CARD_QR_FRAME_X - SHARE_CARD_FOOTER_TEXT_X - 28
export const SHARE_CARD_FOOTER_TITLE_FONT_SIZE = 26
export const SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT = 34
export const SHARE_CARD_FOOTER_BRAND_FONT_SIZE = 20
export const SHARE_CARD_FOOTER_BRAND_LINE_HEIGHT = 28
export const SHARE_CARD_FOOTER_TEXT_GAP = 10
export const SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT = SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT + SHARE_CARD_FOOTER_TEXT_GAP + SHARE_CARD_FOOTER_BRAND_LINE_HEIGHT
export const SHARE_CARD_FOOTER_BRAND_BLOCK_HEIGHT = Math.max(SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT)
export const SHARE_CARD_CONTENT_BOTTOM_PADDING = 48
export const SHARE_CARD_AUTHOR_TOP_GAP = 40
export const SHARE_CARD_FOOTER_TOP_GAP = 40
export const SHARE_CARD_FOOTER_BOTTOM_PADDING = 56
/** Content details sit inside the lower part of the existing Hero viewport. */
export const SHARE_CARD_ACTIVITY_OVERLAY_PADDING_TOP = 36
export const SHARE_CARD_ACTIVITY_OVERLAY_PADDING_BOTTOM = 36
export const SHARE_CARD_ACTIVITY_OVERLAY_TITLE_GAP = 16
export const SHARE_CARD_ACTIVITY_OVERLAY_DESCRIPTION_GAP = 18
export const SHARE_CARD_ACTIVITY_OVERLAY_META_GAP = 16
/** Posts need a little more optical separation before the board label. */
export const SHARE_CARD_POST_DESCRIPTION_META_GAP = 24
export const SHARE_CARD_ACTIVITY_TITLE_MAX_LINES = 3
export const SHARE_CARD_ACTIVITY_DESCRIPTION_MAX_LINES = 2
export const SHARE_CARD_ACTIVITY_META_MAX_LINES = 1
export const SHARE_CARD_POST_TITLE_MAX_LINES = 2
/** All share-card types use the same bounded overlay copy policy. */
export const SHARE_CARD_OVERLAY_TITLE_MAX_LINES = SHARE_CARD_ACTIVITY_TITLE_MAX_LINES
export const SHARE_CARD_OVERLAY_DESCRIPTION_MAX_LINES = SHARE_CARD_ACTIVITY_DESCRIPTION_MAX_LINES
export const SHARE_CARD_OVERLAY_META_MAX_LINES = SHARE_CARD_ACTIVITY_META_MAX_LINES
/** Footer balance: the brand group sits lower while the QR group sits higher. */
export const SHARE_CARD_BRAND_OFFSET_Y = 64
export const SHARE_CARD_QR_OFFSET_Y = -56
/** Kept as compatibility aliases for callers/tests that used the activity names. */
export const SHARE_CARD_ACTIVITY_BRAND_OFFSET_Y = SHARE_CARD_BRAND_OFFSET_Y
export const SHARE_CARD_ACTIVITY_QR_OFFSET_Y = SHARE_CARD_QR_OFFSET_Y
export const SHARE_CARD_CATEGORY_FONT_SIZE = 22
export const SHARE_CARD_CATEGORY_LINE_HEIGHT = 32
export const SHARE_CARD_TITLE_FONT_SIZE = 56
export const SHARE_CARD_TITLE_LINE_HEIGHT = 72
export const SHARE_CARD_DESCRIPTION_FONT_SIZE = 30
export const SHARE_CARD_DESCRIPTION_LINE_HEIGHT = 42
export const SHARE_CARD_META_FONT_SIZE = 25
export const SHARE_CARD_META_LINE_HEIGHT = 38
export const SHARE_CARD_AUTHOR_FONT_SIZE = 30
export const SHARE_CARD_AUTHOR_LINE_HEIGHT = 36
export const SHARE_CARD_DATE_FONT_SIZE = 22
export const SHARE_CARD_DATE_LINE_HEIGHT = 30

export type ShareCardImageDimensions = Readonly<{
  width: number
  height: number
}>

/** Post and activity media use the image's natural flow; home keeps its contained brand treatment. */
export function shareCardHeroFit(type: ShareCardData['type']): 'cover' | 'contain' {
  return type === 'home' ? 'contain' : 'cover'
}

export function shareCardHeroDimensions(data: ShareCardData, dimensions?: ShareCardImageDimensions | null) {
  const width = dimensions?.width || data.imageWidth || 0
  const height = dimensions?.height || data.imageHeight || 0
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HERO_HEIGHT, orientation: 'unknown' as const }
  }
  if (height > width) {
    return { width: SHARE_CARD_WIDTH, height: SHARE_CARD_PORTRAIT_HERO_HEIGHT, orientation: 'portrait' as const }
  }
  return {
    width: SHARE_CARD_WIDTH,
    height: Math.max(SHARE_CARD_LANDSCAPE_MIN_HERO_HEIGHT, Math.round(SHARE_CARD_WIDTH * height / width)),
    orientation: 'landscape' as const,
  }
}

export type ShareCardTextBlock = Readonly<{
  lines: readonly string[]
  lineHeight: number
  height: number
}>

export type ShareCardLayout = Readonly<{
  width: typeof SHARE_CARD_WIDTH
  height: number
  heroHeight: number
  panelTop: number
  panelHeight: number
  panelBottom: number
  contentCardBottom: number
  overlayTop: number
  overlayHeight: number
  activityOverlayTop: number
  activityOverlayHeight: number
  categoryTop: number
  titleTop: number
  descriptionTop: number
  metaTop: number
  authorTop: number
  authorTextTop: number
  dateTop: number
  qrTop: number
  qrBottom: number
  brandBlockTop: number
  brandBlockBottom: number
  brandBlockHeight: number
  brandLogoTop: number
  brandTextTop: number
  footerBottom: number
  title: string
  description: string
  author: string
  date: string
  meta: readonly string[]
  titleLines: readonly string[]
  descriptionLines: readonly string[]
  metaLines: readonly string[]
  authorLines: readonly string[]
  dateLines: readonly string[]
  authorBlockHeight: number
  heroOrientation: 'landscape' | 'portrait' | 'unknown'
}>

function normalizeCardText(value: string | null | undefined) {
  return sanitizeShareCardText(value, { preserveLineBreaks: true })
}

function estimatedCharacterWidth(character: string, fontSize: number) {
  const codePoint = character.codePointAt(0) || 0
  if (/\s/u.test(character)) return fontSize * 0.35
  if (codePoint > 0xffff || (codePoint >= 0x1f000 && codePoint <= 0x1ffff)) return fontSize
  return codePoint <= 0x007f ? fontSize * 0.55 : fontSize
}

export function estimatedShareCardTextWidth(value: string, fontSize: number) {
  return tokenizeShareCardText(value).reduce((total, token) => {
    if (token.type === 'emoji') return total + fontSize
    return total + Array.from(token.value).reduce((textTotal, character) => textTotal + estimatedCharacterWidth(character, fontSize), 0)
  }, 0)
}

/** Wrap text by the same safe width model used by both the Sharp and Canvas renderers. */
export function wrapShareCardText(value: string, maxWidth: number, fontSize: number) {
  const lines: string[] = []
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    let lineWidth = 0
    const units = tokenizeShareCardText(paragraph).flatMap((token) => token.type === 'emoji' ? [token.value] : Array.from(token.value))
    for (const character of units) {
      const characterWidth = estimatedCharacterWidth(character, fontSize)
      if (line && lineWidth + characterWidth > maxWidth) {
        lines.push(line)
        line = ''
        lineWidth = 0
      }
      line += character
      lineWidth += characterWidth
    }
    if (line) lines.push(line)
  }
  return lines
}

export function measureWrappedText(value: string, maxWidth: number, fontSize: number, lineHeight: number): ShareCardTextBlock {
  if (!value.trim()) return { lines: [], lineHeight, height: 0 }
  const lines = wrapShareCardText(value, maxWidth, fontSize)
  return { lines, lineHeight, height: lines.length * lineHeight }
}

function limitWrappedText(block: ShareCardTextBlock, maxLines: number, maxWidth: number, fontSize: number): ShareCardTextBlock {
  if (block.lines.length <= maxLines) return block
  const lines = block.lines.slice(0, maxLines)
  while (lines.length > 1 && !lines[lines.length - 1]?.trim()) lines.pop()
  let lastLine = (lines[lines.length - 1] || '').trimEnd()
  while (lastLine && estimatedShareCardTextWidth(`${lastLine}…`, fontSize) > maxWidth) {
    const units = tokenizeShareCardText(lastLine)
    const lastUnit = units.at(-1)
    if (!lastUnit) break
    if (lastUnit.type === 'emoji') {
      lastLine = units.slice(0, -1).map((unit) => unit.value).join('')
      continue
    }
    lastLine = units.slice(0, -1).map((unit) => unit.value).join('') + Array.from(lastUnit.value).slice(0, -1).join('')
  }
  lines[lines.length - 1] = `${lastLine}…`
  return { ...block, lines, height: lines.length * block.lineHeight }
}

function visibleMeta(data: ShareCardData) {
  const entries = data.meta
    .map(({ label, value }) => {
      const normalizedLabel = normalizeCardText(label)
      const normalizedValue = normalizeCardText(value)
      return {
        label: normalizedLabel,
        value: normalizedLabel === '版块'
          ? getForumBoardDisplayName({ slug: normalizedValue, name: normalizedValue })
          : normalizedValue,
      }
    })
    .filter(({ label, value }) => label && value)
  const activityEntries = data.type === 'activity'
    ? entries.filter(({ label }) => label === '活动时间' || label === '活动地点')
    : entries
  return activityEntries
    .slice(0, data.type === 'activity' ? 2 : 3)
    .map(({ label, value }) => `${label}：${value}`)
}

function normalizeActivityDescription(value: string | null | undefined) {
  const normalized = normalizeCardText(value)
  if (!normalized) return '简介：暂无活动简介。'
  const introLines = normalized
    .split('\n')
    .filter((line) => !/^(?:时间|活动时间|地点|活动地点)\s*[:：]/u.test(line.trim()))
    .map((line) => line.replace(/^简介\s*[:：]\s*/u, '').trim())
    .filter(Boolean)
  return `简介：${introLines.join('\n') || '暂无活动简介。'}`
}

/** Single flow layout shared by the API response, server renderer, and local fallback. */
export function calculateShareCardLayout(data: ShareCardData, dimensions?: ShareCardImageDimensions | null): ShareCardLayout {
  const hero = shareCardHeroDimensions(data, dimensions)
  const isActivity = data.type === 'activity'
  const title = normalizeCardText(data.title) || shareCardTypeLabel(data.type)
  const description = isActivity ? normalizeActivityDescription(data.description) : normalizeCardText(data.description)
  const author = normalizeCardText(data.author) || '私家E院'
  const date = normalizeCardText(data.date)
  const meta = visibleMeta(data)
  const measuredTitleBlock = measureWrappedText(title, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_TITLE_FONT_SIZE, SHARE_CARD_TITLE_LINE_HEIGHT)
  const measuredDescriptionBlock = measureWrappedText(description, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_DESCRIPTION_FONT_SIZE, SHARE_CARD_DESCRIPTION_LINE_HEIGHT)
  const titleMaxLines = data.type === 'post' ? SHARE_CARD_POST_TITLE_MAX_LINES : SHARE_CARD_OVERLAY_TITLE_MAX_LINES
  const titleBlock = limitWrappedText(measuredTitleBlock, titleMaxLines, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_TITLE_FONT_SIZE)
  const descriptionBlock = limitWrappedText(measuredDescriptionBlock, SHARE_CARD_OVERLAY_DESCRIPTION_MAX_LINES, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_DESCRIPTION_FONT_SIZE)
  const metaBlocks = meta.map((value) => {
    const block = measureWrappedText(value, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_META_FONT_SIZE, SHARE_CARD_META_LINE_HEIGHT)
    return limitWrappedText(block, SHARE_CARD_OVERLAY_META_MAX_LINES, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_META_FONT_SIZE)
  })
  const metaLines = metaBlocks.flatMap((block) => block.lines)
  const authorBlock = measureWrappedText(author, SHARE_CARD_AUTHOR_WIDTH, SHARE_CARD_AUTHOR_FONT_SIZE, SHARE_CARD_AUTHOR_LINE_HEIGHT)
  const dateBlock = measureWrappedText(date ? `发布于 ${date}` : '来自私家E院', SHARE_CARD_AUTHOR_WIDTH, SHARE_CARD_DATE_FONT_SIZE, SHARE_CARD_DATE_LINE_HEIGHT)

  const hasDescription = descriptionBlock.lines.some((line) => line.trim())
  const hasMeta = metaLines.length > 0
  const metaHeight = metaLines.length * SHARE_CARD_META_LINE_HEIGHT
  const descriptionGap = hasDescription ? SHARE_CARD_ACTIVITY_OVERLAY_DESCRIPTION_GAP : 0
  const metaGap = hasMeta
    ? (data.type === 'post' ? SHARE_CARD_POST_DESCRIPTION_META_GAP : SHARE_CARD_ACTIVITY_OVERLAY_META_GAP)
    : 0
  const overlayHeight = SHARE_CARD_ACTIVITY_OVERLAY_PADDING_TOP
    + SHARE_CARD_CATEGORY_LINE_HEIGHT
    + SHARE_CARD_ACTIVITY_OVERLAY_TITLE_GAP
    + titleBlock.height
    + descriptionGap
    + descriptionBlock.height
    + metaGap
    + metaHeight
    + SHARE_CARD_ACTIVITY_OVERLAY_PADDING_BOTTOM
  const overlayTop = Math.max(0, hero.height - overlayHeight)
  const panelTop = overlayTop
  const panelHeight = overlayHeight
  const panelBottom = hero.height
  const activityOverlayTop = overlayTop
  const activityOverlayHeight = overlayHeight
  const categoryTop = overlayTop + SHARE_CARD_ACTIVITY_OVERLAY_PADDING_TOP
  const titleTop = categoryTop + SHARE_CARD_CATEGORY_LINE_HEIGHT + SHARE_CARD_ACTIVITY_OVERLAY_TITLE_GAP
  const descriptionTop = titleTop + titleBlock.height + descriptionGap
  const metaTop = descriptionTop + descriptionBlock.height + metaGap
  const authorTop = panelBottom + SHARE_CARD_AUTHOR_TOP_GAP
  const authorTextTop = authorTop + Math.max(0, (SHARE_CARD_AVATAR_SIZE - authorBlock.height - dateBlock.height - 4) / 2)
  const dateTop = authorTextTop + authorBlock.height + 4
  const authorBlockHeight = Math.max(
    SHARE_CARD_AVATAR_SIZE,
    (authorTextTop - authorTop) + authorBlock.height + 4 + dateBlock.height,
  )
  const brandBlockHeight = SHARE_CARD_FOOTER_BRAND_BLOCK_HEIGHT
  const naturalBrandBlockTop = authorTop + authorBlockHeight + SHARE_CARD_FOOTER_TOP_GAP
  // Keep the established minimum canvas height without leaving the footer
  // floating above the bottom edge on compact cards. Long content still wins
  // because its natural flow position is larger than this minimum anchor.
  const brandOffsetY = SHARE_CARD_BRAND_OFFSET_Y
  const qrOffsetY = SHARE_CARD_QR_OFFSET_Y
  const footerVisualHeight = Math.max(brandOffsetY + brandBlockHeight, qrOffsetY + SHARE_CARD_QR_FRAME_SIZE)
  const footerAnchorMin = SHARE_CARD_HEIGHT - SHARE_CARD_FOOTER_BOTTOM_PADDING - footerVisualHeight
  const footerAnchorTop = Math.max(naturalBrandBlockTop, footerAnchorMin)
  let brandBlockTop = footerAnchorTop + brandOffsetY
  let qrTop = Math.max(authorTop + authorBlockHeight + 16, naturalBrandBlockTop + qrOffsetY, footerAnchorTop + qrOffsetY)
  if (data.type === 'post') {
    // Keep the established QR size while giving posts an exact shared bottom
    // edge for the QR and brand groups. Only long cards need extra footer flow
    // to keep that edge below the author block.
    const minBrandTopForQr = authorTop + authorBlockHeight + 16 + SHARE_CARD_QR_FRAME_SIZE - brandBlockHeight
    brandBlockTop = Math.max(brandBlockTop, minBrandTopForQr)
    qrTop = brandBlockTop + brandBlockHeight - SHARE_CARD_QR_FRAME_SIZE
  }
  const brandLogoTop = brandBlockTop + (brandBlockHeight - SHARE_CARD_FOOTER_LOGO_SIZE) / 2
  const brandTextTop = brandBlockTop + (brandBlockHeight - SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT) / 2
  const brandBlockBottom = brandBlockTop + brandBlockHeight
  const qrBottom = qrTop + SHARE_CARD_QR_FRAME_SIZE
  const footerContentBottom = Math.max(brandBlockBottom, qrBottom)
  // The minimum canvas height is part of the final flow, rather than a
  // separate empty area below it. This keeps the reported/API height equal to
  // the actual PNG bottom while preserving the minimum 1440px contract.
  const footerBottom = Math.max(SHARE_CARD_HEIGHT, footerContentBottom + SHARE_CARD_FOOTER_BOTTOM_PADDING)
  const height = footerBottom

  return {
    width: SHARE_CARD_WIDTH,
    height,
    heroHeight: hero.height,
    panelTop,
    panelHeight,
    panelBottom,
    contentCardBottom: panelBottom,
    overlayTop,
    overlayHeight,
    activityOverlayTop,
    activityOverlayHeight,
    categoryTop,
    titleTop,
    descriptionTop,
    metaTop,
    authorTop,
    authorTextTop,
    dateTop,
    qrTop,
    qrBottom,
    brandBlockTop,
    brandBlockBottom,
    brandBlockHeight,
    brandLogoTop,
    brandTextTop,
    footerBottom,
    title,
    description,
    author,
    date,
    meta,
    titleLines: titleBlock.lines,
    descriptionLines: descriptionBlock.lines,
    metaLines,
    authorLines: authorBlock.lines,
    dateLines: dateBlock.lines,
    authorBlockHeight,
    heroOrientation: hero.orientation,
  }
}
