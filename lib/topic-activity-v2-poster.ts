import sharp, { type OverlayOptions } from 'sharp'
import QRCode from 'qrcode'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getCosObject } from '@/lib/tencent-cos'
import { TopicActivityV2Error } from '@/lib/topic-activity-v2'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function escaped(value: unknown) { return String(value || '').replace(/[<>&"']/gu, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]!)) }
const POSTER_WIDTH = 1080
const POSTER_HEIGHT = 1920
const POSTER_MARGIN = 96
let posterFontConfig: Promise<void> | null = null

function wrap(value: unknown, count: number, maximum: number) {
  const paragraphs = String(value || '').replace(/\r/gu, '').split('\n')
  const result: string[] = []
  let truncated = false
  for (const paragraph of paragraphs) {
    const text = Array.from(paragraph)
    if (!text.length && result.length < maximum) { result.push(''); continue }
    for (let position = 0; position < text.length; position += count) {
      if (result.length >= maximum) { truncated = true; break }
      result.push(text.slice(position, position + count).join(''))
    }
    if (truncated) break
  }
  if (truncated && result.length) result[result.length - 1] += '…'
  return result
}

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

function renderLines(lines: string[], x: number, firstBaseline: number, fontSize: number, lineHeight: number, weight: number) {
  return lines.map((line, index) => `<text x="${x}" y="${firstBaseline + index * lineHeight}" font-size="${fontSize}" font-weight="${weight}">${escaped(line)}</text>`).join('')
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
  const width = POSTER_WIDTH, height = POSTER_HEIGHT, margin = POSTER_MARGIN
  // Stored attempts keep their own immutable image and options; never read today's test config here.
  // A result poster is the complete visual, with the old global background retained only as fallback.
  const resultImage = await posterImage(snapshot.imageUrl, 'RESULT_IMAGE')
  const background = resultImage || suppliedBackground || await posterImage(config.backgroundUrl, 'BACKGROUND')
  if (background && background.length > 20 * 1024 * 1024) throw new TopicActivityV2Error('POSTER_BACKGROUND_TOO_LARGE', '背景图片过大', 400)
  await ensurePosterFontConfig().catch(() => { throw new TopicActivityV2Error('POSTER_FONT_UNAVAILABLE', '海报中文字体暂不可用，请稍后重试', 503) })
  const heading = wrap(snapshot.title || '测试结果', 12, 2)
  const body = String(snapshot.description || '').trim() ? wrap(snapshot.description, 22, 9) : []
  const activityTitle = wrap(snapshot.activityTitle || snapshot.testTitle || '私家E院话题活动', 22, 2)
  const score = typeof snapshot.score === 'number' && Number.isFinite(snapshot.score)
    ? `得分 ${snapshot.score}${typeof snapshot.maxScore === 'number' && Number.isFinite(snapshot.maxScore) ? ` / ${snapshot.maxScore}` : ''}`
    : ''
  const showNickname = config.showNickname !== false
  const showQrCode = config.showQrCode === true
  const nicknameCharacters = Array.from(String(snapshot.nickname || '私家E院会员'))
  const nicknameLimit = showQrCode ? 14 : 22
  const nickname = showNickname ? nicknameCharacters.slice(0, nicknameCharacters.length > nicknameLimit ? nicknameLimit - 1 : nicknameLimit).join('') + (nicknameCharacters.length > nicknameLimit ? '…' : '') : ''
  const activityTitleBaseline = 210
  const headingBaseline = activityTitleBaseline + activityTitle.length * 54 + 80
  const bodyBaseline = headingBaseline + heading.length * 94 + 80
  const bodyBottom = body.length ? bodyBaseline + (body.length - 1) * 62 + 12 : bodyBaseline - 40
  const scoreBaseline = bodyBottom + 72
  const activityTitleSvg = background ? '' : renderLines(activityTitle, margin, activityTitleBaseline, 40, 54, 550)
  const bodySvg = renderLines(body, margin, bodyBaseline, 40, 62, 450)
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Noto Sans SC, sans-serif" fill="#fff" stroke="#071624" stroke-opacity=".56" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${activityTitleSvg}${renderLines(heading, margin, headingBaseline, 72, 94, 750)}${bodySvg}${score ? `<text x="${margin}" y="${scoreBaseline}" font-size="48" font-weight="650">${escaped(score)}</text>` : ''}${nickname ? `<text x="${margin}" y="1665" font-size="40" font-weight="600">${escaped(nickname)}</text>` : ''}${background ? '' : `<text x="${margin}" y="1820" font-size="34" font-weight="600">私家E院 · ECFC</text>`}</g></svg>`
  const svg = Buffer.from(svgText)
  const canvas = background
    ? sharp(background, { limitInputPixels: 20_000_000 }).rotate().resize(width, height, { fit: 'cover', position: 'centre' })
    : sharp({ create: { width, height, channels: 4, background: '#102c48' } })
  const layers: OverlayOptions[] = [{ input: svg, top: 0, left: 0 }]
  if (showQrCode) {
    const qrSize = 216
    const qrPlatePadding = 12
    const qr = await QRCode.toBuffer('https://ecfc.fans/activities/' + encodeURIComponent(activityId), { width: qrSize, margin: 4, errorCorrectionLevel: 'H' })
    const plateSize = qrSize + qrPlatePadding * 2
    const left = width - margin - plateSize
    const top = 1545
    layers.push({ input: { create: { width: plateSize, height: plateSize, channels: 4, background: '#ffffff' } }, left, top })
    layers.push({ input: qr, left: left + qrPlatePadding, top: top + qrPlatePadding })
  }
  return canvas.composite(layers).png().toBuffer()
}
