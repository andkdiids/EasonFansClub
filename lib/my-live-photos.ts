import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Prisma } from '@prisma/client'
import sharp, { type Metadata, type OutputInfo } from 'sharp'
import { isAnimatedImageInput } from '@/lib/image-webp'
import { prisma } from '@/lib/prisma'
import { deleteFromCos, describeCosError } from '@/lib/tencent-cos'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { MY_LIVE_PHOTO_LIMITS, type MyLivePhotoCategoryValue } from '@/lib/my-live-photo-types'
import { myLivePhotoOrderBy, myLivePhotoSelect, serializeMyLivePhotos } from '@/lib/my-live-photo-data'

export { MY_LIVE_PHOTO_LIMITS } from '@/lib/my-live-photo-types'

export const MY_LIVE_PHOTO_MAX_FILE_SIZE = 12 * 1024 * 1024
export const MY_LIVE_PHOTO_MAX_REQUEST_SIZE = MY_LIVE_PHOTO_MAX_FILE_SIZE * MY_LIVE_PHOTO_LIMITS.LIVE + 128 * 1024
export const MY_LIVE_PHOTO_MAX_INPUT_PIXELS = 40_000_000
export const MY_LIVE_PHOTO_MAX_EDGE = 2400
export const MY_LIVE_PHOTO_WEBP_QUALITY = 82

export const MY_LIVE_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

const MIME_FORMATS = new Map<string, string>([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
])

type ProcessedMyLivePhoto = {
  buffer: Buffer
  width: number
  height: number
  watermarked: boolean
}

export class MyLivePhotoRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'MyLivePhotoRequestError'
  }
}

export function parseMyLivePhotoCategory(value: unknown): MyLivePhotoCategoryValue | null {
  return value === 'TICKET' || value === 'LIVE' ? value : null
}

export function parseMyLivePhotoWatermark(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return false
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function isCjkLike(value: string) {
  const codePoint = value.codePointAt(0) || 0
  return (codePoint >= 0x2e80 && codePoint <= 0x9fff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0x3040 && codePoint <= 0x30ff)
}

function glyphUnits(value: string) {
  return Array.from(value).reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.35
    if (isCjkLike(character)) return total + 1
    const codePoint = character.codePointAt(0) || 0
    if (codePoint > 0xffff) return total + 1.1
    return total + 0.62
  }, 0)
}

function estimatedTextWidth(value: string, fontSize: number) {
  return Math.ceil(glyphUnits(value) * fontSize * 1.08)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fitWatermarkText(username: string, uid: number, width: number, height: number) {
  const minDimension = Math.max(1, Math.min(width, height))
  const safeMargin = Math.max(2, Math.round(minDimension * 0.025))
  let fontSize = clamp(Math.round(minDimension * 0.032), 10, 88)
  const minFontSize = Math.max(8, Math.floor(fontSize * 0.55))
  const innerPadding = () => Math.max(2, Math.round(fontSize * 0.34))
  const maxOverlayWidth = Math.max(1, width - safeMargin * 2)
  const maxContentWidth = () => Math.max(1, maxOverlayWidth - innerPadding() * 2)
  const preferredContentWidth = () => Math.min(maxContentWidth(), Math.max(80, Math.round(width * 0.46)))
  const uidText = `UID:${uid}`
  const separator = '  '
  const cleanUsername = username.trim() || '用户'
  let displayUsername = cleanUsername
  let text = `${displayUsername}${separator}${uidText}`

  while (fontSize > minFontSize && estimatedTextWidth(text, fontSize) > preferredContentWidth()) fontSize -= 1

  if (estimatedTextWidth(text, fontSize) > maxContentWidth()) {
    const usernameCharacters = Array.from(cleanUsername)
    while (usernameCharacters.length > 1) {
      const candidate = `${usernameCharacters.join('')}…${separator}${uidText}`
      if (estimatedTextWidth(candidate, fontSize) <= maxContentWidth()) {
        displayUsername = `${usernameCharacters.join('')}…`
        text = candidate
        break
      }
      usernameCharacters.pop()
    }
  }

  while (estimatedTextWidth(text, fontSize) > maxContentWidth() && fontSize > 8) fontSize -= 1

  const contentWidth = Math.min(maxContentWidth(), estimatedTextWidth(text, fontSize))
  const padding = innerPadding()
  const overlayWidth = Math.min(maxOverlayWidth, contentWidth + padding * 2)
  const overlayHeight = Math.min(
    Math.max(1, height - safeMargin * 2),
    Math.ceil(fontSize * 1.7 + padding * 2),
  )
  const overlayLeft = Math.max(safeMargin, width - overlayWidth - safeMargin)
  const overlayTop = Math.max(safeMargin, height - overlayHeight - safeMargin)

  return {
    text,
    displayUsername,
    fontSize,
    padding,
    safeMargin,
    overlayWidth,
    overlayHeight,
    overlayLeft,
    overlayTop,
  }
}

/**
 * 水印中文字体解析。
 *
 * 中文显示异常的根因：sharp 的 SVG 渲染（librsvg / resvg，走系统 fontconfig）
 * 只在「服务器实际安装」的字体里挑选字形。原 font-family 把 Arial 排在最前，
 * 而 Linux 服务器上 Microsoft YaHei / PingFang / Noto CJK 通常并未安装，
 * 中文回退链耗尽后落到无 CJK 字形的默认字体，于是变成方框/乱码。
 *
 * 这里把中文字体提到最前，并在运行时探测服务器已安装的 CJK 字体，
 * 让真正可用的中文字体排在第一位。若服务器完全没有中文字体，
 * 仍需运维安装（见要求 #5，优先 NotoSansCJK-Regular.ttc）。
 */

type CjkFontCandidate = { family: string; paths: readonly string[] }

const CJK_FONT_CANDIDATES: readonly CjkFontCandidate[] = [
  {
    family: 'Noto Sans CJK SC',
    paths: [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
      '/usr/share/fonts/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
      '/usr/share/fonts/google-noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/google-noto-cjk/NotoSansCJKsc-Regular.otf',
      'C:/Windows/Fonts/NotoSansCJK-Regular.ttc',
      '/System/Library/Fonts/Supplemental/NotoSansCJK-Regular.ttc',
    ],
  },
  {
    family: 'Noto Sans SC',
    paths: [
      '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf',
      'C:/Windows/Fonts/NotoSansSC-Regular.ttf',
      '/System/Library/Fonts/Supplemental/NotoSansSC-Regular.ttf',
    ],
  },
  {
    family: 'Source Han Sans SC',
    paths: [
      '/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf',
      '/usr/share/fonts/adobe-source-han-sans/SourceHanSansSC-Regular.otf',
    ],
  },
  {
    family: 'Microsoft YaHei',
    paths: [
      'C:/Windows/Fonts/msyh.ttc',
      'C:/Windows/Fonts/msyhbd.ttc',
      '/usr/share/fonts/truetype/windows/msyh.ttc',
    ],
  },
  {
    family: 'PingFang SC',
    paths: ['/System/Library/Fonts/PingFang.ttc'],
  },
  {
    family: 'WenQuanYi Micro Hei',
    paths: [
      '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
      '/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc',
    ],
  },
  {
    family: 'WenQuanYi Zen Hei',
    paths: ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc'],
  },
  {
    family: 'Heiti SC',
    paths: ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc'],
  },
  {
    family: 'SimHei',
    paths: ['C:/Windows/Fonts/simhei.ttf'],
  },
]

const EMOJI_FONT_CANDIDATES: readonly CjkFontCandidate[] = [
  {
    family: 'Noto Color Emoji',
    paths: [
      '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
      '/usr/share/fonts/opentype/noto/NotoColorEmoji.ttf',
      'C:/Windows/Fonts/NotoColorEmoji.ttf',
      '/System/Library/Fonts/Apple Color Emoji.ttc',
    ],
  },
  {
    family: 'Apple Color Emoji',
    paths: ['/System/Library/Fonts/Apple Color Emoji.ttc'],
  },
  {
    family: 'Segoe UI Emoji',
    paths: ['C:/Windows/Fonts/seguiemj.ttf'],
  },
]

function safeExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

export function detectInstalledCjkFamilies(): string[] {
  const installed: string[] = []
  for (const candidate of [...CJK_FONT_CANDIDATES, ...EMOJI_FONT_CANDIDATES]) {
    if (candidate.paths.some(safeExists)) installed.push(candidate.family)
  }
  return installed
}

export function isCjkFontAvailable(): boolean {
  return CJK_FONT_CANDIDATES.some((candidate) => candidate.paths.some(safeExists))
}

let cachedWatermarkFontFamily: string | null = null

/**
 * 返回水印使用的 font-family 列表：已安装的中文字体优先排在前面，
 * 其后补列其余候选中文字体，再补 emoji 字体，最后回退到通用 sans-serif。
 * 这样在「服务器已安装某中文字体」时能正确渲染中文；若都未安装，
 * 仍向渲染器请求这些家族名（fontconfig 可能通过其它途径识别），
 * 但真正的修复仍依赖运维安装中文字体。
 */
export function resolveCjkWatermarkFontFamily(): string {
  if (cachedWatermarkFontFamily) return cachedWatermarkFontFamily
  const installed = new Set(detectInstalledCjkFamilies())
  const cjkOrdered = [
    ...CJK_FONT_CANDIDATES.filter((c) => installed.has(c.family)).map((c) => c.family),
    ...CJK_FONT_CANDIDATES.filter((c) => !installed.has(c.family)).map((c) => c.family),
  ]
  const emojiOrdered = EMOJI_FONT_CANDIDATES.map((c) => c.family)
  cachedWatermarkFontFamily = [...cjkOrdered, ...emojiOrdered, 'sans-serif'].join(', ')
  return cachedWatermarkFontFamily
}

export function buildMyLivePhotoWatermarkSvg({ username, uid, width, height }: { username: string; uid: number; width: number; height: number }) {
  const fitted = fitWatermarkText(username, uid, width, height)
  const escapedText = escapeXml(fitted.text)
  const baseline = Math.min(fitted.overlayHeight - fitted.padding, fitted.padding + fitted.fontSize)
  const radius = Math.max(2, Math.round(fitted.fontSize * 0.24))
  const strokeWidth = Math.max(0.5, fitted.fontSize * 0.045)
  const fontFamily = resolveCjkWatermarkFontFamily()
  const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n'
  const svg = `${xmlDeclaration}<svg xmlns="http://www.w3.org/2000/svg" width="${fitted.overlayWidth}" height="${fitted.overlayHeight}" viewBox="0 0 ${fitted.overlayWidth} ${fitted.overlayHeight}"><rect x="0" y="0" width="${fitted.overlayWidth}" height="${fitted.overlayHeight}" rx="${radius}" fill="#000" fill-opacity="0.28"/><text x="${fitted.overlayWidth - fitted.padding}" y="${baseline}" text-anchor="end" fill="#fff" stroke="#000" stroke-opacity="0.34" stroke-width="${strokeWidth}" paint-order="stroke" font-family="${fontFamily}" font-size="${fitted.fontSize}" font-weight="600">${escapedText}</text></svg>`
  return {
    svg,
    text: fitted.text,
    fontSize: fitted.fontSize,
    left: fitted.overlayLeft,
    top: fitted.overlayTop,
    width: fitted.overlayWidth,
    height: fitted.overlayHeight,
  }
}

function invalidImage(message: string): never {
  throw new MyLivePhotoRequestError(400, message)
}

/**
 * Normalize one still image exactly once into the public My Live representation.
 * Sharp rotates before resizing, then composites the optional identity watermark
 * into raw pixels before the final WebP encode.
 */
export async function processMyLivePhoto(input: Buffer, declaredMimeType: string, watermark: boolean, identity?: { username: string; uid: number }): Promise<ProcessedMyLivePhoto> {
  if (!Buffer.isBuffer(input) || input.byteLength === 0) invalidImage('图片内容为空')
  if (input.byteLength > MY_LIVE_PHOTO_MAX_FILE_SIZE) invalidImage('图片不能超过 12MB')

  const expectedFormat = MIME_FORMATS.get(declaredMimeType)
  if (!expectedFormat || !MY_LIVE_PHOTO_MIME_TYPES.has(declaredMimeType)) invalidImage('仅支持 JPG、PNG、WebP 或 AVIF 静态图片')

  let metadata: Metadata
  try {
    metadata = await sharp(input, { failOn: 'error', limitInputPixels: MY_LIVE_PHOTO_MAX_INPUT_PIXELS }).metadata()
  } catch {
    invalidImage('图片无法解析，请换一张有效图片')
  }

  if (metadata.format !== expectedFormat) invalidImage('图片 MIME 类型与真实格式不一致')
  if (!metadata.width || !metadata.height || metadata.width < 1 || metadata.height < 1) invalidImage('图片尺寸无效')
  if (metadata.width * metadata.height > MY_LIVE_PHOTO_MAX_INPUT_PIXELS) invalidImage('图片像素过大，请换一张尺寸较小的照片')
  if (isAnimatedImageInput(input, metadata)) invalidImage('My Live 只支持静态图片，不支持动图')
  if (watermark && !identity) invalidImage('水印身份信息不可用，请稍后重试')

  let normalized: { data: Buffer; info: OutputInfo }
  try {
    normalized = await sharp(input, { failOn: 'error', limitInputPixels: MY_LIVE_PHOTO_MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MY_LIVE_PHOTO_MAX_EDGE, height: MY_LIVE_PHOTO_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch {
    invalidImage('图片处理失败，请换一张有效图片')
  }

  const width = normalized.info.width
  const height = normalized.info.height
  const channels = normalized.info.channels as 1 | 2 | 3 | 4
  if (!width || !height || !channels || channels < 1 || channels > 4) invalidImage('图片处理后的尺寸无效')

  let output = sharp(normalized.data, { raw: { width, height, channels } })
  if (watermark && identity) {
    const overlay = buildMyLivePhotoWatermarkSvg({ username: identity.username, uid: identity.uid, width, height })
    output = output.composite([{ input: Buffer.from(overlay.svg), left: overlay.left, top: overlay.top }])
  }

  try {
    return {
      buffer: await output.webp({ quality: MY_LIVE_PHOTO_WEBP_QUALITY, effort: 4 }).toBuffer(),
      width,
      height,
      watermarked: watermark,
    }
  } catch {
    throw new MyLivePhotoRequestError(422, '图片转换为 WebP 失败，请检查图片后重试')
  }
}

export async function getMyLiveWatermarkIdentity(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, uid: true } })
  if (!user) throw new MyLivePhotoRequestError(401, '当前登录用户不存在或已失效')
  return user
}

async function lockAttendance(tx: Prisma.TransactionClient, userId: string, attendanceId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM UserMusicConcert
    WHERE id = ${attendanceId} AND userId = ${userId}
    LIMIT 1
    FOR UPDATE
  `
  return Boolean(rows[0]?.id)
}

function limitFor(category: MyLivePhotoCategoryValue) {
  return MY_LIVE_PHOTO_LIMITS[category]
}

function cleanupUploadKeys(keys: readonly string[], context: string) {
  return Promise.all(keys.map(async (storageKey) => {
    try {
      await deleteFromCos(storageKey)
    } catch (error) {
      console.error(`[music.live.photo.${context}.cleanup]`, { storageKey, error: describeCosError(error) })
    }
  }))
}

export async function uploadMyLivePhotos(params: {
  userId: string
  attendanceId: string
  category: MyLivePhotoCategoryValue
  watermark: boolean
  photos: readonly ProcessedMyLivePhoto[]
}) {
  if (!params.photos.length) throw new MyLivePhotoRequestError(400, '请选择至少一张图片')
  if (params.photos.length > limitFor(params.category)) throw new MyLivePhotoRequestError(409, `${params.category === 'TICKET' ? '票根' : '现场'}最多上传${limitFor(params.category)}张`)

  const uploadedKeys: string[] = []
  let committed = false
  try {
    const uploaded = [] as Array<{ storageKey: string; imageUrl: string; processed: ProcessedMyLivePhoto }>
    for (const processed of params.photos) {
      const storageKey = `my-live/${params.userId}/${params.attendanceId}/${randomUUID()}.webp`
      const imageUrl = await uploadSiteImage({ key: storageKey, body: processed.buffer, contentType: 'image/webp' })
      uploadedKeys.push(storageKey)
      uploaded.push({ storageKey, imageUrl, processed })
    }

    const allPhotos = await prisma.$transaction(async (tx) => {
      if (!await lockAttendance(tx, params.userId, params.attendanceId)) {
        throw new MyLivePhotoRequestError(404, '我的现场记录不存在')
      }

      const [totalCount, categoryCount] = await Promise.all([
        tx.myLivePhoto.count({ where: { attendanceId: params.attendanceId } }),
        tx.myLivePhoto.count({ where: { attendanceId: params.attendanceId, category: params.category } }),
      ])
      const categoryLimit = limitFor(params.category)
      if (categoryCount + uploaded.length > categoryLimit) {
        throw new MyLivePhotoRequestError(409, `${params.category === 'TICKET' ? '票根' : '现场'}最多上传${categoryLimit}张`)
      }
      if (totalCount + uploaded.length > MY_LIVE_PHOTO_LIMITS.TOTAL) {
        throw new MyLivePhotoRequestError(409, '单个场次最多保存 8 张照片')
      }

      await Promise.all(uploaded.map((item, index) => tx.myLivePhoto.create({
        data: {
          userId: params.userId,
          attendanceId: params.attendanceId,
          category: params.category,
          imageUrl: item.imageUrl,
          storageKey: item.storageKey,
          width: item.processed.width,
          height: item.processed.height,
          sortOrder: categoryCount + index,
          watermarked: item.processed.watermarked,
        },
        select: myLivePhotoSelect,
      })))

      return tx.myLivePhoto.findMany({
        where: { attendanceId: params.attendanceId, userId: params.userId },
        orderBy: myLivePhotoOrderBy,
        select: myLivePhotoSelect,
      })
    }, { maxWait: 10_000, timeout: 15_000 })
    committed = true

    return serializeMyLivePhotos(allPhotos)
  } catch (error) {
    if (!committed && uploadedKeys.length) await cleanupUploadKeys(uploadedKeys, 'upload')
    if (error instanceof MyLivePhotoRequestError) throw error
    if (error instanceof SiteMediaStorageError) throw new MyLivePhotoRequestError(502, error.message)
    throw error
  }
}

export async function getOwnMyLivePhotos(userId: string, attendanceId: string) {
  await assertOwnMyLiveAttendance(userId, attendanceId)
  const photos = await prisma.myLivePhoto.findMany({ where: { attendanceId, userId }, orderBy: myLivePhotoOrderBy, select: myLivePhotoSelect })
  return serializeMyLivePhotos(photos)
}

export async function assertOwnMyLiveAttendance(userId: string, attendanceId: string) {
  const attendance = await prisma.userMusicConcert.findFirst({ where: { id: attendanceId, userId }, select: { id: true } })
  if (!attendance) throw new MyLivePhotoRequestError(404, '我的现场记录不存在')
}

export async function deleteOwnMyLivePhoto(userId: string, attendanceId: string, photoId: string) {
  const storageKey = await prisma.$transaction(async (tx) => {
    if (!await lockAttendance(tx, userId, attendanceId)) throw new MyLivePhotoRequestError(404, '我的现场记录不存在')
    const photo = await tx.myLivePhoto.findUnique({ where: { id: photoId }, select: { id: true, userId: true, attendanceId: true, category: true, storageKey: true } })
    if (!photo) throw new MyLivePhotoRequestError(404, '照片不存在')
    if (photo.userId !== userId || photo.attendanceId !== attendanceId) throw new MyLivePhotoRequestError(403, '无权操作这张照片')

    await tx.myLivePhoto.delete({ where: { id: photo.id } })
    const remaining = await tx.myLivePhoto.findMany({
      where: { attendanceId, category: photo.category },
      orderBy: myLivePhotoOrderBy,
      select: { id: true },
    })
    await Promise.all(remaining.map((item, index) => tx.myLivePhoto.update({ where: { id: item.id }, data: { sortOrder: index } })))
    return photo.storageKey
  }, { maxWait: 10_000, timeout: 15_000 })

  try {
    await deleteFromCos(storageKey)
  } catch (error) {
    console.error('[music.live.photo.delete.cos]', { storageKey, error: describeCosError(error) })
  }
}

export async function reorderOwnMyLivePhotos(userId: string, attendanceId: string, photoId: string, direction: 'previous' | 'next') {
  return prisma.$transaction(async (tx) => {
    if (!await lockAttendance(tx, userId, attendanceId)) throw new MyLivePhotoRequestError(404, '我的现场记录不存在')
    const photo = await tx.myLivePhoto.findUnique({ where: { id: photoId }, select: { id: true, userId: true, attendanceId: true, category: true } })
    if (!photo) throw new MyLivePhotoRequestError(404, '照片不存在')
    if (photo.userId !== userId || photo.attendanceId !== attendanceId) throw new MyLivePhotoRequestError(403, '无权操作这张照片')

    const photos = await tx.myLivePhoto.findMany({ where: { attendanceId, category: photo.category }, orderBy: myLivePhotoOrderBy, select: { id: true } })
    const currentIndex = photos.findIndex((item) => item.id === photoId)
    const targetIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= photos.length) {
      return serializeMyLivePhotos(await tx.myLivePhoto.findMany({ where: { attendanceId, category: photo.category }, orderBy: myLivePhotoOrderBy, select: myLivePhotoSelect }))
    }
    const reordered = [...photos]
    const [moved] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    await Promise.all(reordered.map((item, index) => tx.myLivePhoto.update({ where: { id: item.id }, data: { sortOrder: index } })))
    return serializeMyLivePhotos(await tx.myLivePhoto.findMany({ where: { attendanceId, category: photo.category }, orderBy: myLivePhotoOrderBy, select: myLivePhotoSelect }))
  }, { maxWait: 10_000, timeout: 15_000 })
}
