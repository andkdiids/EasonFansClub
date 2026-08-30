import { sanitizeShareCardText, shareCardTypeLabel, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'

/** Default Hero height used when an image has no readable dimensions. */
export const SHARE_CARD_HERO_HEIGHT = 660
export const SHARE_CARD_PORTRAIT_HERO_HEIGHT = Math.round(SHARE_CARD_WIDTH * 4 / 3)
export const SHARE_CARD_LANDSCAPE_MIN_HERO_HEIGHT = 360
/** Kept as a compatibility constant; the real panel top follows the Hero. */
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
  categoryTop: number
  titleTop: number
  descriptionTop: number
  metaTop: number
  authorTop: number
  authorTextTop: number
  dateTop: number
  qrTop: number
  brandBlockTop: number
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
    for (const character of Array.from(paragraph)) {
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
  const lines = wrapShareCardText(value, maxWidth, fontSize)
  return { lines, lineHeight, height: lines.length * lineHeight }
}

function visibleMeta(data: ShareCardData) {
  return data.meta
    .map(({ label, value }) => ({ label: normalizeCardText(label), value: normalizeCardText(value) }))
    .filter(({ label, value }) => label && value)
    .slice(0, 3)
    .map(({ label, value }) => `${label}：${value}`)
}

/** Single flow layout shared by the API response, server renderer, and local fallback. */
export function calculateShareCardLayout(data: ShareCardData, dimensions?: ShareCardImageDimensions | null): ShareCardLayout {
  const hero = shareCardHeroDimensions(data, dimensions)
  const title = normalizeCardText(data.title) || shareCardTypeLabel(data.type)
  const description = normalizeCardText(data.description) || '扫码查看完整内容'
  const author = normalizeCardText(data.author) || '私家E院'
  const date = normalizeCardText(data.date)
  const meta = visibleMeta(data)
  const titleBlock = measureWrappedText(title, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_TITLE_FONT_SIZE, SHARE_CARD_TITLE_LINE_HEIGHT)
  const descriptionBlock = measureWrappedText(description, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_DESCRIPTION_FONT_SIZE, SHARE_CARD_DESCRIPTION_LINE_HEIGHT)
  const metaBlocks = meta.map((value) => measureWrappedText(value, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_META_FONT_SIZE, SHARE_CARD_META_LINE_HEIGHT))
  const metaLines = metaBlocks.flatMap((block) => block.lines)
  const authorBlock = measureWrappedText(author, SHARE_CARD_AUTHOR_WIDTH, SHARE_CARD_AUTHOR_FONT_SIZE, SHARE_CARD_AUTHOR_LINE_HEIGHT)
  const dateBlock = measureWrappedText(date ? `发布于 ${date}` : '来自私家E院', SHARE_CARD_AUTHOR_WIDTH, SHARE_CARD_DATE_FONT_SIZE, SHARE_CARD_DATE_LINE_HEIGHT)

  const panelTop = hero.height
  const categoryTop = panelTop + 48
  const titleTop = categoryTop + SHARE_CARD_CATEGORY_LINE_HEIGHT + 20
  const descriptionTop = titleTop + titleBlock.height + 22
  const metaTop = descriptionTop + descriptionBlock.height + (metaLines.length ? 24 : 0)
  const metaHeight = metaLines.length * SHARE_CARD_META_LINE_HEIGHT
  const panelBottom = metaTop + metaHeight + SHARE_CARD_CONTENT_BOTTOM_PADDING
  const panelHeight = panelBottom - panelTop
  const authorTop = panelBottom + SHARE_CARD_AUTHOR_TOP_GAP
  const authorTextTop = authorTop + Math.max(0, (SHARE_CARD_AVATAR_SIZE - authorBlock.height - dateBlock.height - 4) / 2)
  const dateTop = authorTextTop + authorBlock.height + 4
  const authorBlockHeight = Math.max(
    SHARE_CARD_AVATAR_SIZE,
    (authorTextTop - authorTop) + authorBlock.height + 4 + dateBlock.height,
  )
  const brandBlockHeight = SHARE_CARD_FOOTER_BRAND_BLOCK_HEIGHT
  const footerVisualHeight = Math.max(brandBlockHeight, SHARE_CARD_QR_FRAME_SIZE)
  const naturalBrandBlockTop = authorTop + authorBlockHeight + SHARE_CARD_FOOTER_TOP_GAP
  // Keep the established minimum canvas height without leaving the footer
  // floating above the bottom edge on compact cards. Long content still wins
  // because its natural flow position is larger than this minimum anchor.
  const brandBlockTop = Math.max(naturalBrandBlockTop, SHARE_CARD_HEIGHT - footerVisualHeight - SHARE_CARD_FOOTER_BOTTOM_PADDING)
  const qrTop = brandBlockTop
  const brandLogoTop = brandBlockTop + (brandBlockHeight - SHARE_CARD_FOOTER_LOGO_SIZE) / 2
  const brandTextTop = brandBlockTop + (brandBlockHeight - SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT) / 2
  const footerBottom = Math.max(brandBlockTop + brandBlockHeight, qrTop + SHARE_CARD_QR_FRAME_SIZE) + SHARE_CARD_FOOTER_BOTTOM_PADDING
  const height = Math.max(SHARE_CARD_HEIGHT, footerBottom)

  return {
    width: SHARE_CARD_WIDTH,
    height,
    heroHeight: hero.height,
    panelTop,
    panelHeight,
    panelBottom,
    contentCardBottom: panelBottom,
    categoryTop,
    titleTop,
    descriptionTop,
    metaTop,
    authorTop,
    authorTextTop,
    dateTop,
    qrTop,
    brandBlockTop,
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
