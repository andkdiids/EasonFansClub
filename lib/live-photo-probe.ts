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
  const text = latin1Text(bytes, 2 * 1024 * 1024)
  const match = text.match(/(?:com\.apple\.quicktime\.content\.identifier|ContentIdentifier)[\x00-\x20:=]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match?.[1]
}

/** Decode bytes as latin1 without building one string per character. */
export function latin1Text(bytes: Uint8Array, limit = bytes.length) {
  const end = Math.min(bytes.length, limit)
  const chunk = 8192
  let text = ''
  for (let offset = 0; offset < end; offset += chunk) {
    text += String.fromCharCode(...bytes.subarray(offset, Math.min(end, offset + chunk)))
  }
  return text
}

const MOTION_PHOTO_XMP_BYTES = 512 * 1024
const MOTION_PHOTO_TAIL_BYTES = 2 * 1024 * 1024

/**
 * Length in bytes of the MP4 appended after the still image.
 *
 * Google stores it as `GCamera:MicroVideoOffset`, Samsung as an
 * `Item:Length` on the `video/mp4` entry of `Container:Directory`. Both count
 * bytes from the end of the file, which is exactly what a `Blob.slice` needs.
 */
export function motionPhotoTrailerLength(head: Uint8Array): number | undefined {
  return motionPhotoTrailerLengthFromText(latin1Text(head, MOTION_PHOTO_XMP_BYTES))
}

function motionPhotoTrailerLengthFromText(text: string): number | undefined {
  const google = text.match(/MicroVideoOffset\s*=\s*"(\d+)"/i)
  if (google) {
    const value = Number(google[1])
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  // Samsung: <Container:Item Item:Mime="video/mp4" Item:Length="1234" .../>
  const samsung = text.match(/Item:Mime\s*=\s*"video\/mp4"[\s\S]{0,400}?Item:Length\s*=\s*"(\d+)"/i)
    || text.match(/Item:Length\s*=\s*"(\d+)"[\s\S]{0,400}?Item:Mime\s*=\s*"video\/mp4"/i)
  if (samsung) {
    const value = Number(samsung[1])
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  return undefined
}

/**
 * Locate the start of a trailing MP4 inside the last bytes of a file.
 * Used when the metadata marks a motion photo but carries no explicit offset.
 */
export function findTrailingMp4Start(tail: Uint8Array): number | undefined {
  const limit = tail.length - 8
  for (let index = 4; index <= limit; index += 1) {
    if (tail[index] !== 0x66 || tail[index + 1] !== 0x74 || tail[index + 2] !== 0x79 || tail[index + 3] !== 0x70) continue
    const boxStart = index - 4
    // A stray "ftyp" inside JPEG metadata cannot form a box chain that ends
    // exactly at the end of the file, so require the whole tail to parse.
    if (!isBoxChainToEof(tail, boxStart)) continue
    if (detectVideoContainer(tail.slice(boxStart, boxStart + 64)) === 'unknown') continue
    return boxStart
  }
  return undefined
}

function isBoxChainToEof(bytes: Uint8Array, start: number) {
  let cursor = start
  while (cursor + 8 <= bytes.length) {
    const size = u32(bytes, cursor)
    if (size === 0) return cursor + 8 <= bytes.length
    if (size < 8 || cursor + size > bytes.length) return false
    cursor += size
  }
  return cursor === bytes.length
}

/** Google/Samsung Motion Photo stores the paired MP4 at the end of the file;
 * XMP carries its length as MicroVideoOffset or Container:Directory length. */
export function findEmbeddedMotionVideo(bytes: Uint8Array): Uint8Array | undefined {
  const text = latin1Text(bytes, MOTION_PHOTO_XMP_BYTES)
  const trailer = motionPhotoTrailerLengthFromText(text)
  if (trailer && trailer > 0 && trailer < bytes.length) {
    const start = bytes.length - trailer
    if (detectVideoContainer(bytes.slice(start, start + 64)) !== 'unknown') return bytes.slice(start)
  }
  const marked = /MotionPhoto\s*=\s*"?1"?/i.test(text)
    || /GCamera:MotionPhoto/i.test(text)
    || /Container:Directory/i.test(text)
  if (!marked) {
    // Legacy layout: a MotionPhotoMetadata block that only carries an offset.
    const legacy = text.match(/MotionPhotoMetadata[\s\S]{0,1200}?(?:VideoOffset|MediaOffset)"?\s*:?="?(\d+)/i)
    if (!legacy) return undefined
    const length = Number(legacy[1])
    if (!Number.isSafeInteger(length) || length <= 0 || length >= bytes.length) return undefined
    const start = bytes.length - length
    if (detectVideoContainer(bytes.slice(start, start + 64)) === 'unknown') return undefined
    return bytes.slice(start)
  }
  const window = bytes.subarray(Math.max(0, bytes.length - MOTION_PHOTO_TAIL_BYTES))
  const start = findTrailingMp4Start(window)
  if (start === undefined) return undefined
  return bytes.slice(bytes.length - window.length + start)
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
  // A motion photo already contains its clip: counting the extracted bytes again
  // would reject a file that is itself inside the upload limit.
  const measuredBytes = embedded ? input.cover.byteLength : input.cover.byteLength + videoBytes.byteLength
  if (measuredBytes > input.maxUploadBytes) {
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

/* ------------------------------------------------------------------ *
 * Selection classification
 *
 * Used by the shared image picker to decide, before any compression, which
 * of the files the user picked are native live photos. Pure and dependency
 * free so it can be unit tested and bundled for the browser.
 * ------------------------------------------------------------------ */

export type SelectionKind = 'image' | 'live-photo' | 'video' | 'unsupported'
export type SelectionPairing = 'MOTION_PHOTO' | 'APPLE'

export type SelectionBytes = {
  /** Head of the original file (container + XMP live here). */
  head: Uint8Array
  /** Tail of the original file; only needed for MOV metadata stored at the end. */
  tail?: Uint8Array
  /** Full original size in bytes, used to sanity check the trailer offset. */
  size?: number
  /** Declared MIME. Only used as a hint for containers we do not parse —
   * it never upgrades a file to a live photo. */
  mime?: string
}

export type InspectedSelection = {
  kind: SelectionKind
  pairing?: SelectionPairing
  /** Trailing bytes owned by the paired MP4 (motion photo only). */
  trailerBytes?: number
  appleIdentifier?: string
  /** Set when the still is a confirmed Apple live photo with no paired MOV. */
  missingPairedVideo?: boolean
  imageContainer: ImageContainer
  videoContainer: VideoContainer
}

export type ClassifiedSelection = InspectedSelection & {
  /** Index of the paired video inside the same selection, when applicable. */
  pairedVideoIndex?: number
  /** Plain photo that is objectively a live photo, just without its clip. */
  notifyMissingVideo?: boolean
}

function findIdentifier(bytes?: Uint8Array) {
  if (!bytes?.length) return undefined
  const value = extractAppleContentIdentifier(bytes)
  return value ? value.trim().toLowerCase() : undefined
}

/**
 * A motion photo keeps a full MP4 after the still image. The XMP offset tells
 * us how many bytes from the end belong to the clip; the server re-verifies the
 * real container before transcoding, so a bogus offset can never produce a LIVE
 * badge on its own.
 */
function motionPhotoTrailer(input: SelectionBytes, imageContainer: ImageContainer) {
  if (imageContainer !== 'jpeg') return undefined
  const trailer = motionPhotoTrailerLength(input.head)
  if (!trailer) return undefined
  const size = input.size ?? 0
  // The clip has to sit inside the file, with the still image in front of it.
  if (size > 0 && trailer >= size) return undefined
  return trailer
}

export function inspectSelection(input: SelectionBytes): InspectedSelection {
  const imageContainer = detectImageContainer(input.head)
  const videoContainer = detectVideoContainer(input.head)

  if (videoContainer !== 'unknown' && imageContainer === 'unknown') {
    return {
      kind: 'video',
      imageContainer,
      videoContainer,
      appleIdentifier: findIdentifier(input.tail) ?? findIdentifier(input.head),
    }
  }
  if (imageContainer === 'unknown') {
    // PNG/WebP/GIF/AVIF are valid attachments that this module does not parse.
    // They keep flowing through the normal image pipeline untouched.
    const declared = (input.mime || '').toLowerCase()
    if (declared.startsWith('image/')) return { kind: 'image', imageContainer, videoContainer }
    return { kind: 'unsupported', imageContainer, videoContainer }
  }

  const trailerBytes = motionPhotoTrailer(input, imageContainer)
  if (trailerBytes) {
    return { kind: 'live-photo', pairing: 'MOTION_PHOTO', trailerBytes, imageContainer, videoContainer }
  }

  const appleIdentifier = findIdentifier(input.head) ?? findIdentifier(input.tail)
  if (appleIdentifier) {
    // The still claims a paired clip. Until that exact clip shows up in the
    // same selection it is only a normal photo, and it must stay one.
    return { kind: 'image', imageContainer, videoContainer, appleIdentifier, missingPairedVideo: true }
  }
  return { kind: 'image', imageContainer, videoContainer }
}

/**
 * Classify everything the file picker returned in one go, then pair Apple
 * stills with their MOV by the real content identifier — never by file name or
 * by similar duration.
 */
export function classifySelection(inputs: readonly SelectionBytes[]): ClassifiedSelection[] {
  const inspected = inputs.map((input) => inspectSelection(input))
  const videoByAppleId = new Map<string, number>()
  inspected.forEach((item, index) => {
    if (item.kind !== 'video' || !item.appleIdentifier) return
    if (!videoByAppleId.has(item.appleIdentifier)) videoByAppleId.set(item.appleIdentifier, index)
  })

  return inspected.map((item) => {
    if (item.kind !== 'image' || !item.missingPairedVideo || !item.appleIdentifier) {
      return { ...item, notifyMissingVideo: false }
    }
    const pairedVideoIndex = videoByAppleId.get(item.appleIdentifier)
    if (pairedVideoIndex === undefined) return { ...item, notifyMissingVideo: true }
    return {
      ...item,
      kind: 'live-photo' as const,
      pairing: 'APPLE' as const,
      missingPairedVideo: false,
      pairedVideoIndex,
      notifyMissingVideo: false,
    }
  })
}

export const LIVE_PHOTO_MISSING_VIDEO_NOTICE = '当前浏览器未提供完整实况资源，将作为普通照片上传。'

export type SelectionSummary = {
  accepted: number
  livePhotos: number
  skippedVideos: number
  unsupported: number
  missingVideoNotice: boolean
}

export function summarizeSelection(items: readonly ClassifiedSelection[]): SelectionSummary {
  const pairedVideoIndexes = new Set<number>()
  for (const item of items) {
    if (item.pairedVideoIndex !== undefined) pairedVideoIndexes.add(item.pairedVideoIndex)
  }
  const skippedVideos = items.filter((item, index) => item.kind === 'video' && !pairedVideoIndexes.has(index)).length
  return {
    accepted: items.filter((item) => item.kind === 'image' || item.kind === 'live-photo').length,
    livePhotos: items.filter((item) => item.kind === 'live-photo').length,
    skippedVideos,
    unsupported: items.filter((item) => item.kind === 'unsupported').length,
    missingVideoNotice: items.some((item) => item.notifyMissingVideo === true),
  }
}
