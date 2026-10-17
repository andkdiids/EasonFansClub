import sharp, { type OverlayOptions } from 'sharp'
import QRCode from 'qrcode'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getCosObject } from '@/lib/tencent-cos'
import { TopicActivityV2Error } from '@/lib/topic-activity-v2'
import { getMediaPublicBaseUrl, PUBLIC_COS_HOST } from '@/lib/media-url'
import { profileImageUrl } from '@/lib/images'
import { TOPIC_POSTER_AVATAR, TOPIC_POSTER_QR_BRAND, TOPIC_POSTER_SIZE, topicPosterLayout, topicPosterQr } from '@/lib/topic-activity-v2-poster-layout'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
let posterFontConfig: Promise<void> | null = null

function escapeXml(value: string) {
  return value.replace(/[<>&"']/gu, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]!))
}

async function ensurePosterFontConfig() {
  if (!posterFontConfig) {
    posterFontConfig = (async () => {
      const fontDirectory = path.resolve(process.cwd(), 'public/fonts')
      const fontFile = path.join(fontDirectory, 'NotoSansSC-VF.ttf')
      await access(fontFile)

      const configDirectory = path.join(os.tmpdir(), `ecfc-topic-poster-fontconfig-${process.pid}`)
      const cacheDirectory = path.join(configDirectory, 'cache')
      await mkdir(cacheDirectory, { recursive: true })
      const configFile = path.join(configDirectory, 'fonts.conf')
      const includeCandidates = [
        process.env.FONTCONFIG_FILE,
        process.env.FONTCONFIG_PATH ? path.join(process.env.FONTCONFIG_PATH, 'fonts.conf') : null,
        process.platform === 'win32' ? null : '/etc/fonts/fonts.conf',
      ].filter((value): value is string => Boolean(value) && path.resolve(value!) !== path.resolve(configFile))
      const includes: string[] = []
      for (const candidate of includeCandidates) {
        try {
          await access(candidate)
          if (!includes.includes(path.resolve(candidate))) includes.push(path.resolve(candidate))
        } catch { /* keep only configuration files that exist on this host */ }
      }
      const fontDirectories = [fontDirectory]
      if (process.platform === 'win32') fontDirectories.push(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts'))
      else fontDirectories.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.local/share/fonts'))
      const xml = [
        '<?xml version="1.0"?>',
        '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
        '<fontconfig>',
        ...includes.map((file) => `<include>${escapeXml(file.replace(/\\/gu, '/'))}</include>`),
        ...fontDirectories.map((directory) => `<dir>${escapeXml(path.resolve(directory).replace(/\\/gu, '/'))}</dir>`),
        `<cachedir>${escapeXml(cacheDirectory.replace(/\\/gu, '/'))}</cachedir>`,
        '</fontconfig>',
      ].join('\n')
      await writeFile(configFile, xml, 'utf8')
      process.env.FONTCONFIG_PATH = configDirectory
      process.env.FONTCONFIG_FILE = configFile
    })()
  }
  return posterFontConfig
}

/** Fixed storage namespaces only: no arbitrary HTTP fetch, cookies, or private API calls. */
async function backgroundBytes(value: string) {
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { throw new TopicActivityV2Error('POSTER_BACKGROUND_INVALID', '海报背景路径无效', 400) }
  if (decoded.includes('..') || decoded.includes('\\') || /[?#\x00]/u.test(decoded)) throw new TopicActivityV2Error('POSTER_BACKGROUND_INVALID', '海报背景路径无效', 400)
  const stored = decoded.match(/^\/(?:cos|cos-files|media)\/([A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif))$/iu)
  if (stored && /^(?:content|uploads|site-media|badges|activities|hero|banners|avatars|images)\//u.test(stored[1])) return getCosObject(stored[1])
  if (!/^\/(?:images|uploads)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)) throw new TopicActivityV2Error('POSTER_BACKGROUND_INVALID', '请选择现有公开图片作为背景', 400)
  const publicRoot = path.resolve(process.cwd(), 'public')
  const filename = path.resolve(publicRoot, '.' + decoded)
  if (!filename.startsWith(publicRoot + path.sep)) throw new TopicActivityV2Error('POSTER_BACKGROUND_INVALID', '海报背景路径无效', 400)
  return readFile(filename)
}

async function posterImage(value: unknown, kind: 'BACKGROUND' | 'RESULT_IMAGE') {
  if (typeof value !== 'string' || !value.trim()) return null
  let bytes: Buffer
  try { bytes = await backgroundBytes(value) }
  catch (cause) {
    if (cause instanceof TopicActivityV2Error && kind === 'BACKGROUND') throw cause
    throw new TopicActivityV2Error(`POSTER_${kind}_UNAVAILABLE`, kind === 'BACKGROUND' ? '海报背景暂不可用，请稍后重试' : '结果图片暂不可用，请稍后重试', 400)
  }
  if (bytes.length > 20 * 1024 * 1024) throw new TopicActivityV2Error(`POSTER_${kind}_TOO_LARGE`, kind === 'BACKGROUND' ? '背景图片过大' : '结果图片过大', 400)
  return bytes
}

export async function renderTopicV2Poster(snapshotValue: unknown, activityId: string, suppliedBackground?: Buffer) {
  const snapshot = record(snapshotValue), config = record(snapshot.poster)
  const { width, height } = TOPIC_POSTER_SIZE
  // The activity poster background is shared across all results. Older snapshots can
  // still carry a result image, so read that only when no shared background exists.
  const configuredBackground = await posterImage(config.backgroundUrl, 'BACKGROUND')
  const background = configuredBackground || suppliedBackground || await posterImage(snapshot.imageUrl, 'RESULT_IMAGE')
  if (background && background.length > 20 * 1024 * 1024) throw new TopicActivityV2Error('POSTER_BACKGROUND_TOO_LARGE', '背景图片过大', 400)
  await ensurePosterFontConfig().catch(() => { throw new TopicActivityV2Error('POSTER_FONT_UNAVAILABLE', '海报中文字体暂不可用，请稍后重试', 503) })
  const svg = Buffer.from(topicPosterLayout(snapshot))
  const canvas = background
    ? sharp(background, { limitInputPixels: 20_000_000 }).rotate().resize(width, height, { fit: 'cover', position: 'centre' })
    : sharp({ create: { width, height, channels: 4, background: '#102c48' } })
  const layers: OverlayOptions[] = [{ input: svg, top: 0, left: 0 }]
  if (config.showNickname === true) {
    const avatar = await posterAvatar(snapshot.avatarUrl)
    if (avatar) layers.push({ input: avatar, left: TOPIC_POSTER_AVATAR.left, top: TOPIC_POSTER_AVATAR.top })
  }
  if (config.showQrCode === true) {
    const qrPosition = topicPosterQr(config)
    const qrPlatePadding = TOPIC_POSTER_QR_BRAND.padding, qrSize = qrPosition.size - qrPlatePadding * 2
    const qr = await QRCode.toBuffer('https://ecfc.fans/activities/' + encodeURIComponent(activityId), { width: qrSize, margin: 4, errorCorrectionLevel: 'H' })
    const plateSize = qrSize + qrPlatePadding * 2
    const { left, top } = qrPosition
    layers.push({ input: { create: { width: plateSize, height: plateSize, channels: 4, background: '#ffffff' } }, left, top })
    layers.push({ input: qr, left: left + qrPlatePadding, top: top + qrPlatePadding })
    // Reuse the official PWA brand asset; only the QR centre is covered.
    const { logoSize, plateSize: logoPlateSize, radius } = TOPIC_POSTER_QR_BRAND
    const logo = await sharp(await readFile(path.join(process.cwd(), 'public/icons/icon-512.png')))
      .resize(logoSize, logoSize, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer()
    const logoPlate = Buffer.from(`<svg width="${logoPlateSize}" height="${logoPlateSize}"><rect width="${logoPlateSize}" height="${logoPlateSize}" rx="${radius}" fill="white"/></svg>`)
    layers.push({ input: logoPlate, left: left + (plateSize - logoPlateSize) / 2, top: top + (plateSize - logoPlateSize) / 2 })
    layers.push({ input: logo, left: left + (plateSize - logoSize) / 2, top: top + (plateSize - logoSize) / 2 })
  }
  return canvas.composite(layers).png().toBuffer()
}

/** Only resolve existing public media; an avatar must never become an SSRF fetch. */
async function posterAvatar(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    let stored = profileImageUrl(value)
    if (!stored) return null
    if (/^https?:/iu.test(stored)) {
      const url = new URL(stored), media = new URL(getMediaPublicBaseUrl())
      if (url.username || url.password || url.search || url.hash) return null
      if (url.origin === media.origin && url.pathname.startsWith(media.pathname.replace(/\/$/u, '') + '/')) stored = '/cos/' + url.pathname.slice(media.pathname.replace(/\/$/u, '').length + 1)
      else if (url.protocol === 'https:' && url.hostname === PUBLIC_COS_HOST && !url.port) stored = '/cos' + url.pathname
      else return null
    }
    const bytes = await backgroundBytes(stored)
    if (bytes.length > 4 * 1024 * 1024) return null
    const { size } = TOPIC_POSTER_AVATAR
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`)
    return await sharp(bytes, { limitInputPixels: 4_000_000 }).rotate().resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  } catch { return null /* missing/legacy avatars keep the local initial placeholder */ }
}
