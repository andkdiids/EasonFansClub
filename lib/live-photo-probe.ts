/**
 * Media inspection. Client-declared MIME/name/duration is never trusted:
 * container magic bytes, MP4 boxes and metadata are read directly.
 * Pure module — no Node-only or third-party imports, so it can be unit tested
 * and bundled for the browser.
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

type Box = { type: string; start: number; end: number; header: number }

function ascii(bytes: Uint8Array, start: number, length: number) {
  let text = ''
  for (let index = start; index < Math.min(bytes.length, start + length); index += 1) {
    text += String.fromCharCode(bytes[index])
  }
  return text
}

function u16(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.length) return 0
  return (bytes[offset] << 8) | bytes[offset + 1]
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
    result.push({ type, start: cursor, end: cursor + size, header })
    cursor += size
  }
  return result
}

function children(bytes: Uint8Array, box: Box) {
  return boxes(bytes, box.start + box.header, box.end)
}

function child(bytes: Uint8Array, box: Box, type: string) {
  return children(bytes, box).find((item) => item.type === type)
}

/**
 * Walk a nested path. Real files keep `hdlr` under `trak/mdia/hdlr`; a direct
 * child lookup silently reports every track as unknown, which is exactly how a
 * valid clip ended up rejected with "cannot read the video frame size".
 */
function descend(bytes: Uint8Array, box: Box, path: readonly string[]): Box | undefined {
  let cursor: Box | undefined = box
  for (const type of path) {
    if (!cursor) return undefined
    cursor = child(bytes, cursor, type)
  }
  return cursor
}

function handlerType(bytes: Uint8Array, trak: Box) {
  const hdlr = descend(bytes, trak, ['mdia', 'hdlr']) ?? child(bytes, trak, 'hdlr')
  if (!hdlr) return ''
  return ascii(bytes, hdlr.start + hdlr.header + 8, 4)
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
  return ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'm4v ', 'avc1', 'dash', 'msdh'].includes(brand)
    || brand.startsWith('mp4')
    || brand.startsWith('3gp')
    ? 'mp4'
    : 'unknown'
}

export function parseMp4DurationMs(bytes: Uint8Array): number {
  const top = boxes(bytes, 0, bytes.length)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return 0
  const mvhd = child(bytes, moov, 'mvhd')
  if (!mvhd) return 0
  const offset = mvhd.start + mvhd.header
  const version = bytes[offset]
  const timescaleOffset = version === 1 ? offset + 20 : offset + 12
  const durationOffset = version === 1 ? offset + 24 : offset + 16
  const timescale = u32(bytes, timescaleOffset)
  if (!timescale) return 0
  const duration = version === 1 ? u64(bytes, durationOffset) : u32(bytes, durationOffset)
  if (!Number.isFinite(duration)) return 0
  const ms = Math.round((duration / timescale) * 1000)
  // Guard against garbage boxes: a live photo clip is seconds, not days.
  if (ms <= 0 || ms > 24 * 3600 * 1000) return 0
  return ms
}

const VISUAL_SAMPLE_ENTRIES = ['avc1', 'avc3', 'hvc1', 'hev1', 'mp4v', 'av01', 'vp09', 'encv', 'dvh1', 'dvhe']

function trackDisplaySize(bytes: Uint8Array, trak: Box) {
  const tkhd = child(bytes, trak, 'tkhd')
  if (!tkhd) return undefined
  const base = tkhd.start + tkhd.header
  const version = bytes[base]
  const widthOffset = version === 1 ? base + 88 : base + 76
  const matrixOffset = version === 1 ? base + 52 : base + 40
  if (widthOffset + 8 > tkhd.end) return undefined
  const width = Math.round(u32(bytes, widthOffset) / 0x10000)
  const height = Math.round(u32(bytes, widthOffset + 4) / 0x10000)
  if (width <= 0 || height <= 0) return undefined
  const b = fixed16(bytes, matrixOffset + 4)
  const c = fixed16(bytes, matrixOffset + 12)
  return Math.abs(b) > 0.5 || Math.abs(c) > 0.5
    ? { width: height, height: width }
    : { width, height }
}

/** Coded size straight from the sample description, used when `tkhd` carries
 * no display size (some Android encoders leave it zero). */
function sampleEntrySize(bytes: Uint8Array, trak: Box) {
  const stsd = descend(bytes, trak, ['mdia', 'minf', 'stbl', 'stsd'])
  if (!stsd) return undefined
  const entries = boxes(bytes, stsd.start + stsd.header + 8, stsd.end)
  for (const entry of entries) {
    if (!VISUAL_SAMPLE_ENTRIES.includes(entry.type)) continue
    const width = u16(bytes, entry.start + entry.header + 24)
    const height = u16(bytes, entry.start + entry.header + 26)
    if (width > 0 && height > 0) return { width, height }
  }
  return undefined
}

export function parseMp4VideoSize(bytes: Uint8Array): { width: number; height: number } {
  const top = boxes(bytes, 0, bytes.length)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return { width: 0, height: 0 }
  const tracks = children(bytes, moov).filter((box) => box.type === 'trak')
  let unlabelled: { width: number; height: number } | undefined
  for (const track of tracks) {
    const handler = handlerType(bytes, track)
    if (handler && handler !== 'vide') continue
    const size = trackDisplaySize(bytes, track) ?? sampleEntrySize(bytes, track)
    if (!size) continue
    // A track without a readable handler is only used when nothing better shows up.
    if (!handler) {
      if (!unlabelled) unlabelled = size
      continue
    }
    return size
  }
  return unlabelled ?? { width: 0, height: 0 }
}

export function hasAudioTrack(bytes: Uint8Array) {
  const top = boxes(bytes, 0, bytes.length)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) return false
  return children(bytes, moov).some((track) => track.type === 'trak' && handlerType(bytes, track) === 'soun')
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
// The clip is appended to the still image, so the container header of even a
// long Motion Photo lives inside this window. Only used when the XMP offset is
// missing or does not land on a valid box boundary.
const MOTION_PHOTO_TAIL_BYTES = 16 * 1024 * 1024

export type MotionPhotoMetadata = {
  /** The metadata itself claims this still is a motion photo. */
  marker: boolean
  /** Bytes of the clip, measured from the end of the file. */
  videoLength?: number
  /** Clip plus its own padding, also measured from the end. */
  paddedLength?: number
  /** True when the length came from an item that declares itself the video. */
  declaredByDirectory?: boolean
}

function safePositiveNumber(value: string | undefined) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Google and Samsung both describe the clip as a directory item, but attribute
 * order, padding and the item namespace differ between versions and vendors.
 * Reading item blocks individually is more robust than one fixed regex.
 */
export function motionPhotoMetadata(text: string): MotionPhotoMetadata {
  let videoLength = safePositiveNumber(text.match(/MicroVideoOffset\s*=\s*"(\d+)"/i)?.[1])
  let padding: number | undefined
  let declaredByDirectory = false

  if (!videoLength) {
    for (const block of text.split(/Container:Item\b/i).slice(1)) {
      const slice = block.slice(0, 600)
      const isVideo = /Item:Semantic\s*=\s*"(?:MotionPhoto|Video)"/i.test(slice)
        || /Item:Mime(?:Type)?\s*=\s*"video\//i.test(slice)
      if (!isVideo) continue
      const length = safePositiveNumber(slice.match(/Item:Length\s*=\s*"(\d+)"/i)?.[1])
      if (!length) continue
      videoLength = length
      padding = safePositiveNumber(slice.match(/Item:Padding\s*=\s*"(\d+)"/i)?.[1])
      declaredByDirectory = true
      break
    }
  }

  const marker = videoLength !== undefined
    || /MotionPhoto\s*=\s*"?1"?/i.test(text)
    || /GCamera:MotionPhoto(?:Version)?\s*=\s*"?\d/i.test(text)
    || /Container:Directory/i.test(text)
    || /MotionPhoto_Data/i.test(text)

  if (videoLength === undefined) return { marker }
  return {
    marker,
    videoLength,
    paddedLength: videoLength + (padding ?? 0),
    declaredByDirectory,
  }
}

function legacyMotionPhotoOffset(text: string) {
  const legacy = text.match(/MotionPhotoMetadata[\s\S]{0,1200}?(?:VideoOffset|MediaOffset)"?\s*:?="?(\d+)/i)
  return safePositiveNumber(legacy?.[1])
}

/**
 * Length in bytes of the MP4 appended after the still image, measured from the
 * end of the file — exactly what a `Blob.slice` needs.
 */
export function motionPhotoTrailerLength(head: Uint8Array): number | undefined {
  const text = latin1Text(head, MOTION_PHOTO_XMP_BYTES)
  const meta = motionPhotoMetadata(text)
  return meta.paddedLength ?? legacyMotionPhotoOffset(text)
}

/** True when the container metadata claims this still image has a clip. */
export function claimsMotionPhoto(bytes: Uint8Array) {
  if (detectImageContainer(bytes) !== 'jpeg') return false
  return motionPhotoMetadata(latin1Text(bytes, MOTION_PHOTO_XMP_BYTES)).marker
}

export type Mp4Chain = {
  /** Offset just past the last fully parsed box. */
  end: number
  hasMoov: boolean
  hasVideoTrack: boolean
}

/**
 * Walk a box chain from `start`.
 *
 * Vendor blocks, padding and Samsung's own trailer may follow the clip, so the
 * chain does not have to reach the end of the file byte-exactly — requiring
 * that rejected real motion photos. It still has to begin with a video `ftyp`,
 * parse cleanly and contain a movie header with a video track, so random
 * `ftyp` bytes inside JPEG metadata can never pass.
 */
export function mp4Chain(bytes: Uint8Array, start: number): Mp4Chain | undefined {
  if (start < 0 || start + 16 > bytes.length) return undefined
  if (ascii(bytes, start + 4, 4) !== 'ftyp') return undefined
  if (detectVideoContainer(bytes.subarray(start, start + 64)) === 'unknown') return undefined
  let cursor = start
  let parsed = 0
  let hasMoov = false
  while (cursor + 8 <= bytes.length) {
    const size = u32(bytes, cursor)
    const type = ascii(bytes, cursor + 4, 4)
    let header = 8
    let actual = size
    if (size === 1) {
      if (cursor + 16 > bytes.length) break
      actual = u64(bytes, cursor + 8)
      header = 16
    } else if (size === 0) {
      // "extends to the end of the file" is only meaningful for a real box.
      // Zero padding after the clip would otherwise be swallowed as one.
      if (!/^(mdat|free|skip|moov|wide|mfra)$/.test(type)) break
      actual = bytes.length - cursor
    }
    if (!Number.isFinite(actual) || actual < header || cursor + actual > bytes.length) break
    if (type === 'moov') hasMoov = true
    parsed += 1
    cursor += actual
  }
  if (!parsed || !hasMoov) return undefined
  const size = parseMp4VideoSize(bytes.subarray(start, cursor))
  return { end: cursor, hasMoov, hasVideoTrack: size.width > 0 && size.height > 0 }
}

/**
 * Locate the start of a trailing MP4 inside the last bytes of a file.
 * Used when the metadata marks a motion photo but carries no explicit offset.
 */
export function findTrailingMp4Start(tail: Uint8Array): number | undefined {
  for (let index = 4; index + 8 <= tail.length; index += 1) {
    if (tail[index] !== 0x66 || tail[index + 1] !== 0x74 || tail[index + 2] !== 0x79 || tail[index + 3] !== 0x70) continue
    const boxStart = index - 4
    if (mp4Chain(tail, boxStart)) return boxStart
  }
  return undefined
}

/** Google/Samsung Motion Photo stores the paired MP4 at the end of the file. */
export function findEmbeddedMotionVideo(bytes: Uint8Array): Uint8Array | undefined {
  const text = latin1Text(bytes, MOTION_PHOTO_XMP_BYTES)
  const meta = motionPhotoMetadata(text)
  const declared = meta.paddedLength ?? meta.videoLength ?? legacyMotionPhotoOffset(text)

  if (declared && declared < bytes.length) {
    const start = bytes.length - declared
    const chain = mp4Chain(bytes, start)
    // Trimming at the chain end drops vendor padding that would otherwise be
    // handed to the decoder as part of the clip.
    if (chain?.hasVideoTrack) return bytes.slice(start, chain.end)
  }

  const windowStart = Math.max(0, bytes.length - MOTION_PHOTO_TAIL_BYTES)
  const window = bytes.subarray(windowStart)
  for (let index = 4; index + 8 <= window.length; index += 1) {
    if (window[index] !== 0x66 || window[index + 1] !== 0x74 || window[index + 2] !== 0x79 || window[index + 3] !== 0x70) continue
    const start = windowStart + index - 4
    const chain = mp4Chain(bytes, start)
    if (!chain?.hasVideoTrack) continue
    return bytes.slice(start, chain.end)
  }
  return undefined
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
  const motionPhotoClaimed = imageContainer === 'jpeg'
    && motionPhotoMetadata(latin1Text(input.cover, MOTION_PHOTO_XMP_BYTES)).marker

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

  if (!input.cover.byteLength) {
    return { ...base, code: 'EMPTY_FILE', message: '图片内容为空' }
  }
  if (!videoBytes?.byteLength) {
    // A still that advertises a clip but has none is a different failure from
    // a plain photo sent to the live photo endpoint, and the user needs to see
    // the difference: one is retryable, the other means "upload as a photo".
    return motionPhotoClaimed
      ? { ...base, code: 'MOTION_PHOTO_INVALID', message: '未能从这张照片中读取动态视频' }
      : { ...base, code: 'EMPTY_FILE', message: '静态封面与配对视频不能为空' }
  }
  // A motion photo already contains its clip: counting the extracted bytes again
  // would reject a file that is itself inside the upload limit.
  const measuredBytes = embedded ? input.cover.byteLength : input.cover.byteLength + videoBytes.byteLength
  if (measuredBytes > input.maxUploadBytes) {
    return { ...base, code: 'TOO_LARGE', message: '原始文件超过上传上限' }
  }
  if (imageContainer === 'unknown') {
    return { ...base, code: 'UNSUPPORTED_IMAGE', message: '仅支持 JPEG、HEIC 或 HEIF 静态封面' }
  }
  if (videoContainer === 'unknown') {
    return { ...base, code: 'UNSUPPORTED_VIDEO', message: '动态资源必须是 MOV 或 MP4 容器' }
  }
  const durationMs = parseMp4DurationMs(videoBytes)
  if (!durationMs) {
    return { ...base, code: 'DURATION_UNKNOWN', message: '无法读取视频真实时长' }
  }
  if (durationMs > input.maxDurationSeconds * 1000) {
    return { ...base, code: 'VIDEO_TOO_LONG', message: `视频时长超过 ${input.maxDurationSeconds} 秒，无法直接上传` }
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
 * of the files the user picked are native live photos.
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
  /** Set when the still claims a clip but the head does not carry its length;
   * the server still has to extract and verify it. */
  motionPhotoClaimed?: boolean
  /** An XMP packet exists even when no motion-photo marker was recognised.
   * Diagnostics only: a vendor block we cannot read is not a live photo. */
  hasXmp?: boolean
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
    return { kind: 'live-photo', pairing: 'MOTION_PHOTO', trailerBytes, imageContainer, videoContainer, hasXmp: true }
  }

  const xmpText = imageContainer === 'jpeg' ? latin1Text(input.head, MOTION_PHOTO_XMP_BYTES) : ''
  // The Adobe XMP packet header is the reliable marker; vendor blocks without
  // it are plain XML and must not be reported as XMP present.
  const hasXmp = /http:\/\/ns\.adobe\.com\/xap\/1\.0\/|xmpmeta/i.test(xmpText)
  const meta = imageContainer === 'jpeg'
    ? motionPhotoMetadata(xmpText)
    : { marker: false }
  if (meta.marker) {
    const declared = meta.paddedLength ?? meta.videoLength
    const knownSize = input.size ?? 0
    // A length that cannot fit inside the file is a false claim: the photo is
    // provably not a motion photo, so it must not take the live photo path.
    if (declared && knownSize > 0 && declared >= knownSize) {
      return { kind: 'image', imageContainer, videoContainer, hasXmp }
    }
    // The still says it carries a clip but this 512KB head has no usable
    // length, so only the server can decide. Sending it down the live photo
    // path keeps the original bytes intact; the server extracts the clip or
    // reports a recoverable failure instead of silently flattening the file.
    return { kind: 'live-photo', pairing: 'MOTION_PHOTO', imageContainer, videoContainer, motionPhotoClaimed: true, hasXmp }
  }

  const appleIdentifier = findIdentifier(input.head) ?? findIdentifier(input.tail)
  if (appleIdentifier) {
    // The still claims a paired clip. Until that exact clip shows up in the
    // same selection it is only a normal photo, and it must stay one.
    return { kind: 'image', imageContainer, videoContainer, appleIdentifier, missingPairedVideo: true, hasXmp }
  }
  return { kind: 'image', imageContainer, videoContainer, hasXmp }
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
