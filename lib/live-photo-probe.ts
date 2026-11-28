/**
 * Server-side media inspection. Client-declared MIME/name/duration is never
 * trusted: container magic bytes, MP4 boxes and metadata are read directly.
 * Pure module — no Node-only or third-party imports, so it can be unit tested.
 */

export type ImageContainer = 'jpeg' | 'heic' | 'unknown'
export type VideoContainer = 'mp4' | 'mov' | 'unknown'
export type LivePhotoPairing = 'APPLE' | 'MOTION_PHOTO' | 'MANUAL'

export type LivePhotoProbeInput = {
  cover: Uint8Array
  video?: Uint8Array | null
  /** True when the user explicitly paired cover and video in the browser. */
  manualPairing?: boolean
  maxDurationSeconds: number
  maxUploadBytes: number
}

export type LivePhotoProbeResult = {
  ok: boolean
  code?: 'FEATURE_DISABLED' | 'EMPTY_FILE' | 'TOO_LARGE' | 'UNSUPPORTED_IMAGE' | 'UNSUPPORTED_VIDEO' | 'DURATION_UNKNOWN' | 'VIDEO_TOO_LONG' | 'INVALID_DIMENSIONS' | 'MOTION_PHOTO_INVALID'
  message?: string
  imageContainer: ImageContainer
  videoContainer: VideoContainer
  pairing: LivePhotoPairing
  durationMs: number
  width: number
  height: number
  hasAudio: boolean
  embeddedVideo?: Uint8Array
  appleIdentifier?: string
}

type Box = { type: string; start: number; end: number }

function ascii(bytes: Uint8Array, start: number, length: number) {
  let text = ''
  for (let index = start; index < Math.min(bytes.length, start + length); index += 1) {
    text += String.fromCharCode(bytes[index])
  }
  return text
}

function u32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.length) return 0
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function u64(bytes: Uint8Array, offset: number) {
  const high = u32(bytes, offset)
  const low = u32(bytes, offset + 4)
  return high * 0x100000000 + low
}

function fixed16(bytes: Uint8Array, offset: number) {
  const raw = u32(bytes, offset)
  const signed = raw > 0x7fffffff ? raw - 0x100000000 : raw
  return signed / 0x10000
}

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const result: Box[] = []
  let cursor = start
  while (cursor + 8 <= end) {
    let size = u32(bytes, cursor)
    const type = ascii(bytes, cursor + 4, 4)
    let header = 8
    if (size === 1) {
      if (cursor + 16 > end) break
      size = u64(bytes, cursor + 8)
      header = 16
    } else if (size === 0) {
      size = end - cursor
    }
    if (!Number.isFinite(size) || size < header || cursor + size > end) break
    result.push({ type, start: cursor, end: cursor + size })
    cursor += size
    void header
  }
  return result
}

function findBox(bytes: Uint8Array, box: Box, type: string): Box | undefined {
  if (box.type === type) return box
  return boxes(bytes, box.start + 8, box.end).find((child) => child.type === type)
}

export function detectImageContainer(bytes: Uint8Array | null | undefined): ImageContainer {
  if (!bytes || bytes.length < 12) return 'unknown'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (ascii(bytes, 4, 4) !== 'ftyp') return 'unknown'
  const brand = ascii(bytes, 8, 4)
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand.toLowerCase()) ? 'heic' : 'unknown'
}

export function detectVideoContainer(bytes: Uint8Array | null | undefined): VideoContainer {
  if (!bytes || bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return 'unknown'
  const brand = ascii(bytes, 8, 4).trim().toLowerCase()
  if (brand === 'qt' || brand === 'qt  ') return 'mov'
  return ['isom', 'iso2', 'mp41', 'mp42', 'm4v ', 'avc1'].includes(brand) || brand.startsWith('mp4') ? 'mp4' : 'unknown'
}

export function parseMp4DurationMs(bytes: Uint8Array): number {
  const top = boxes(bytes, 0, bytes.length)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return 0
  const mvhd = findBox(bytes, moov, 'mvhd')
  if (!mvhd) return 0
  const offset = mvhd.start + 8
  const version = bytes[offset]
  const timescaleOffset = version === 1 ? offset + 20 : offset + 12
  const durationOffset = version === 1 ? offset + 24 : offset + 16
  const timescale = u32(bytes, timescaleOffset)
  if (!timescale) return 0
  const duration = version === 1 ? u64(bytes, durationOffset) : u32(bytes, durationOffset)
  if (!Number.isFinite(duration) || duration > 0x7fffffff) return 0
  return Math.round((duration / timescale) * 1000)
}

export function parseMp4VideoSize(bytes: Uint8Array): { width: number; height: number } {
  const top = boxes(bytes, 0, bytes.length)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return { width: 0, height: 0 }
  const tracks = boxes(bytes, moov.start + 8, moov.end).filter((box) => box.type === 'trak')
  for (const track of tracks) {
    const hdlr = findBox(bytes, track, 'hdlr')
    if (!hdlr || ascii(bytes, hdlr.start + 16, 4) !== 'vide') continue
    const tkhd = findBox(bytes, track, 'tkhd')
    if (!tkhd) continue
    const base = tkhd.start + 8
    const version = bytes[base]
    const widthOffset = version === 1 ? base + 88 : base + 76
    const matrixOffset = version === 1 ? base + 52 : base + 40
    const width = Math.round(u32(bytes, widthOffset) / 0x10000)
    const height = Math.round(u32(bytes, widthOffset + 4) / 0x10000)
    if (width <= 0 || height <= 0) continue
    const b = fixed16(bytes, matrixOffset + 4)
    const c = fixed16(bytes, matrixOffset + 12)
    return Math.abs(b) > 0.5 || Math.abs(c) > 0.5
      ? { width: height, height: width }
      : { width, height }
  }
  return { width: 0, height: 0 }
}

export function hasAudioTrack(bytes: Uint8Array) {
  const top = boxes(bytes, 0, bytes.length)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return false
  return boxes(bytes, moov.start + 8, moov.end).some((track) => {
    if (track.type !== 'trak') return false
    const hdlr = findBox(bytes, track, 'hdlr')
    return !!hdlr && ascii(bytes, hdlr.start + 16, 4) === 'soun'
  })
}

export function extractAppleContentIdentifier(bytes: Uint8Array): string | undefined {
  const text = Array.from(bytes.slice(0, Math.min(bytes.length, 2 * 1024 * 1024)))
    .map((byte) => String.fromCharCode(byte)).join('')
  const match = text.match(/(?:com\.apple\.quicktime\.content\.identifier|ContentIdentifier)[\x00-\x20:=]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match?.[1]
}

/** Google/Samsung Motion Photo stores the paired MP4 at the end of the file;
 * XMP carries its length as MicroVideoOffset/VideoOffset. */
export function findEmbeddedMotionVideo(bytes: Uint8Array): Uint8Array | undefined {
  const text = Array.from(bytes.slice(0, Math.min(bytes.length, 512 * 1024)))
    .map((byte) => String.fromCharCode(byte)).join('')
  const offsetMatch = text.match(/MicroVideoOffset="(\d+)"/i)
    || text.match(/MotionPhotoMetadata[\s\S]{0,1200}?(?:VideoOffset|MediaOffset)"?\s*:?="?(\d+)/i)
  if (!offsetMatch) return undefined
  const offset = Number(offsetMatch[1])
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= bytes.length) return undefined
  const start = bytes.length - offset
  if (detectVideoContainer(bytes.slice(start, start + 64)) === 'unknown') return undefined
  return bytes.slice(start)
}

export function probeLivePhotoUpload(input: LivePhotoProbeInput): LivePhotoProbeResult {
  const imageContainer = detectImageContainer(input.cover)
  const embedded = imageContainer === 'jpeg' ? findEmbeddedMotionVideo(input.cover) : undefined
  const videoBytes = input.video?.byteLength ? input.video : embedded
  const videoContainer = detectVideoContainer(videoBytes)
  const appleCover = extractAppleContentIdentifier(input.cover)
  const appleVideo = videoBytes ? extractAppleContentIdentifier(videoBytes) : undefined
  const pairing: LivePhotoPairing = embedded
    ? 'MOTION_PHOTO'
    : appleCover && appleVideo && appleCover === appleVideo
      ? 'APPLE'
      : 'MANUAL'

  const base: LivePhotoProbeResult = {
    ok: false,
    imageContainer,
    videoContainer,
    pairing,
    durationMs: 0,
    width: 0,
    height: 0,
    hasAudio: false,
    ...(embedded ? { embeddedVideo: embedded } : {}),
    ...(appleCover ? { appleIdentifier: appleCover } : {}),
  }

  if (!input.cover.byteLength || !videoBytes?.byteLength) {
    return { ...base, code: 'EMPTY_FILE', message: '静态封面与配对视频不能为空' }
  }
  if (input.cover.byteLength + videoBytes.byteLength > input.maxUploadBytes) {
    return { ...base, code: 'TOO_LARGE', message: '原始配对文件超过上传上限' }
  }
  if (imageContainer === 'unknown') {
    return { ...base, code: 'UNSUPPORTED_IMAGE', message: '仅支持 JPEG、HEIC 或 HEIF 静态封面' }
  }
  if (videoContainer === 'unknown') {
    return { ...base, code: 'UNSUPPORTED_VIDEO', message: '动态资源必须是 MOV 或 MP4 容器' }
  }
  const durationMs = parseMp4DurationMs(videoBytes)
  if (!durationMs) {
    return { ...base, code: 'DURATION_UNKNOWN', message: '无法读取视频真实时长，拒绝上传' }
  }
  if (durationMs > input.maxDurationSeconds * 1000) {
    return { ...base, code: 'VIDEO_TOO_LONG', message: `视频时长超过 ${input.maxDurationSeconds} 秒，请手动裁剪后再上传` }
  }
  const size = parseMp4VideoSize(videoBytes)
  if (size.width <= 0 || size.height <= 0) {
    return { ...base, code: 'INVALID_DIMENSIONS', message: '无法读取视频画面尺寸' }
  }
  return {
    ...base,
    ok: true,
    durationMs,
    width: size.width,
    height: size.height,
    hasAudio: hasAudioTrack(videoBytes),
  }
}
