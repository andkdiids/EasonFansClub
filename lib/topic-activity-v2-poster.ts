import sharp, { type OverlayOptions } from 'sharp'
import QRCode from 'qrcode'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getCosObject } from '@/lib/tencent-cos'
import { TopicActivityV2Error } from '@/lib/topic-activity-v2'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function escaped(value: unknown) { return String(value || '').replace(/[<>&"']/gu, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]!)) }
function wrap(value: unknown, count: number, maximum: number) {
  const text = Array.from(String(value || '').replace(/\r/gu, ''))
  const result: string[] = []
  for (let position = 0; position < text.length && result.length < maximum; position += count) result.push(text.slice(position, position + count).join(''))
  if (text.length > count * maximum) result[result.length - 1] += '…'
  return result
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
export async function renderTopicV2Poster(snapshotValue: unknown, activityId: string, suppliedBackground?: Buffer) {
  const snapshot = record(snapshotValue), config = record(snapshot.poster)
  const width = typeof config.width === 'number' ? config.width : 1080
  const height = typeof config.height === 'number' ? config.height : 1920
  if (![width, height].every((size) => Number.isInteger(size) && size >= 256 && size <= 4096)) throw new TopicActivityV2Error('POSTER_SIZE_INVALID', '海报尺寸无效', 400)
  const scale = Math.min(width, height * 0.7)
  const margin = Math.round(width * 0.08), headingSize = Math.max(12, Math.round(scale * 0.055)), bodySize = Math.max(8, Math.round(scale * 0.03))
  const headingLines = Math.max(1, Math.min(3, Math.floor(height * 0.15 / (headingSize * 1.5))))
  const bodyLines = Math.max(1, Math.min(14, Math.floor(height * 0.3 / (bodySize * 1.65))))
  const heading = wrap(snapshot.title, Math.max(8, Math.floor((width - margin * 2) / headingSize)), headingLines).map((line, index) => '<text x="' + margin + '" y="' + (height * 0.28 + index * headingSize * 1.5) + '" font-size="' + headingSize + '" font-weight="700">' + escaped(line) + '</text>').join('')
  const body = wrap(snapshot.description, Math.max(10, Math.floor((width - margin * 2) / bodySize)), bodyLines).map((line, index) => '<text x="' + margin + '" y="' + (height * 0.46 + index * bodySize * 1.65) + '" font-size="' + bodySize + '">' + escaped(line) + '</text>').join('')
  const label = typeof snapshot.score === 'number' ? '得分 ' + snapshot.score + ' / ' + snapshot.maxScore : '我的测试结果'
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect x="' + margin / 2 + '" y="' + height * 0.12 + '" width="' + (width - margin) + '" height="' + height * 0.75 + '" fill="white" opacity=".92"/><g fill="#142c44" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif"><text x="' + margin + '" y="' + height * 0.19 + '" font-size="' + bodySize + '">' + escaped(snapshot.activityTitle) + '</text>' + heading + body + '<text x="' + margin + '" y="' + height * 0.82 + '" font-size="' + bodySize + '">' + escaped(label) + '</text><text x="' + margin + '" y="' + height * 0.92 + '" font-size="' + bodySize + '">' + escaped(config.showNickname ? snapshot.nickname : '私家E院') + '</text></g></svg>')
  const background = suppliedBackground || (typeof config.backgroundUrl === 'string' ? await backgroundBytes(config.backgroundUrl) : typeof snapshot.imageUrl === 'string' ? await backgroundBytes(snapshot.imageUrl) : null)
  if (background && background.length > 20 * 1024 * 1024) throw new TopicActivityV2Error('POSTER_BACKGROUND_TOO_LARGE', '背景图片过大', 400)
  const canvas = background ? sharp(background, { limitInputPixels: 20_000_000 }).resize(width, height, { fit: 'cover' }) : sharp({ create: { width, height, channels: 4, background: '#e9eff4' } })
  const layers: OverlayOptions[] = [{ input: svg, top: 0, left: 0 }]
  if (config.showQrCode) {
    const qrSize = Math.round(Math.min(width * 0.14, height * 0.14))
    const qr = await QRCode.toBuffer('https://ecfc.fans/activities/' + encodeURIComponent(activityId), { width: qrSize, margin: 1 })
    layers.push({ input: qr, left: width - margin - qrSize, top: Math.round(height * 0.84) })
  }
  return canvas.composite(layers).png().toBuffer()
}
