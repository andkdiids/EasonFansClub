import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifySelection,
  findEmbeddedMotionVideo,
  findTrailingMp4Start,
  motionPhotoTrailerLength,
  hasAudioTrack,
  inspectSelection,
  parseMp4DurationMs,
  parseMp4VideoSize,
  probeLivePhotoUpload,
  summarizeSelection,
} from '../lib/live-photo-probe.ts'

function u32(value: number) {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function asciiBytes(value: string) {
  return new Uint8Array(Array.from(value).map((char) => char.charCodeAt(0)))
}

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function box(type: string, payload: Uint8Array) {
  return concat(u32(8 + payload.length), asciiBytes(type), payload)
}

function ftyp(brand: string, compatible = brand) {
  return box('ftyp', concat(asciiBytes(brand), u32(0), asciiBytes(compatible)))
}

function mvhd(timescale: number, duration: number) {
  const payload = new Uint8Array(24)
  payload.set(u32(timescale), 12)
  payload.set(u32(duration), 16)
  return box('mvhd', payload)
}

function hdlr(handler: string) {
  const payload = new Uint8Array(12)
  payload.set(asciiBytes(handler), 8)
  return box('hdlr', payload)
}

function tkhd(width: number, height: number) {
  const payload = new Uint8Array(84)
  payload.set(u32(Math.round(width * 0x10000)), 76)
  payload.set(u32(Math.round(height * 0x10000)), 80)
  payload.set(u32(0x10000), 40)
  payload.set(u32(0x10000), 56)
  return box('tkhd', payload)
}

function mp4(durationMs = 2400, width = 1080, height = 1920) {
  // Real files nest `hdlr` inside `mdia` (`trak/mdia/hdlr`). The previous
  // fixture put it directly under `trak`, which is exactly why a parser that
  // only looked at direct children passed every test and still failed on every
  // real phone clip with "cannot read the video frame size".
  const video = box('trak', concat(tkhd(width, height), box('mdia', hdlr('vide'))))
  const audio = box('trak', concat(tkhd(0, 0), box('mdia', hdlr('soun'))))
  return concat(ftyp('isom'), box('moov', concat(mvhd(1000, durationMs), video, audio)))
}

function movWithIdentifier(identifier: string) {
  const text = `com.apple.quicktime.content.identifier=${identifier}`
  return concat(ftyp('qt  '), box('uuid', asciiBytes(text)), box('moov', mvhd(1000, 2000)))
}

function jpegWithXmp(xmp = '') {
  const app1 = concat(asciiBytes(xmp), new Uint8Array(8))
  return concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), u32(app1.length + 2), app1, new Uint8Array([0xff, 0xd9]))
}

function appleStill(identifier: string) {
  return jpegWithXmp(`<x:xmpmeta>ContentIdentifier=${identifier}</x:xmpmeta>`)
}

function pngHead() {
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), new Uint8Array(16))
}

function webpHead() {
  return concat(asciiBytes('RIFF'), u32(120), asciiBytes('WEBPVP8 '), new Uint8Array(8))
}

function googleMotionPhoto(clip = mp4()) {
  const offset = clip.length
  const still = jpegWithXmp(`<rdf:Description GCamera:MotionPhoto="1" GCamera:MicroVideoOffset="${offset}"/>`)
  return concat(still, clip)
}

function samsungMotionPhoto(clip = mp4()) {
  const offset = clip.length
  const still = jpegWithXmp(
    '<Container:Directory><rdf:Seq><rdf:li><Container:Item Item:Mime="image/jpeg" Item:Length="0" Item:Semantic="Primary"/></rdf:li>'
    + `<rdf:li><Container:Item Item:Mime="video/mp4" Item:Length="${offset}" Item:Semantic="MotionPhoto"/></rdf:li></rdf:Seq></Container:Directory>`,
  )
  return concat(still, clip)
}

test('plain stills stay plain: detection never upgrades a normal photo', () => {
  const plain = inspectSelection({ head: jpegWithXmp(), size: 32, mime: 'image/jpeg' })
  assert.equal(plain.kind, 'image')
  assert.equal(plain.missingPairedVideo, undefined)
  assert.equal(plain.pairing, undefined)

  // PNG/WebP/GIF/AVIF are not parsed here but must keep uploading as images.
  for (const [head, mime] of [[pngHead(), 'image/png'], [webpHead(), 'image/webp']] as const) {
    const result = inspectSelection({ head, size: head.length, mime })
    assert.equal(result.kind, 'image', `${mime} must stay a normal image`)
  }

  const heic = concat(ftyp('heic', 'mif1'), new Uint8Array(24))
  assert.equal(inspectSelection({ head: heic, size: heic.length, mime: 'image/heic' }).kind, 'image')
})

test('Google motion photo is recognised from its XMP offset, not from the name', () => {
  const clip = mp4()
  const file = googleMotionPhoto(clip)
  assert.equal(motionPhotoTrailerLength(file), clip.length)
  const result = inspectSelection({ head: file, size: file.length, mime: 'image/jpeg' })
  assert.equal(result.kind, 'live-photo')
  assert.equal(result.pairing, 'MOTION_PHOTO')
  assert.equal(result.trailerBytes, clip.length)

  const extracted = findEmbeddedMotionVideo(file)
  assert.ok(extracted, 'the appended clip must be recoverable from the original bytes')
  assert.equal(extracted!.length, clip.length)
  assert.equal(parseMp4DurationMs(extracted!), 2400)
})

test('Samsung motion photo is recognised from the Container:Directory length', () => {
  const clip = mp4(3000)
  const file = samsungMotionPhoto(clip)
  assert.equal(motionPhotoTrailerLength(file), clip.length)
  const result = inspectSelection({ head: file, size: file.length, mime: 'image/jpeg' })
  assert.equal(result.kind, 'live-photo')
  assert.equal(result.pairing, 'MOTION_PHOTO')
})

test('a marker without an offset still finds the trailing MP4 box', () => {
  const clip = mp4()
  const file = concat(jpegWithXmp('<rdf:Description GCamera:MotionPhoto="1"/>'), clip)
  assert.equal(motionPhotoTrailerLength(file), undefined)
  const start = findTrailingMp4Start(file.subarray(file.length - clip.length))
  assert.equal(start, 0, 'the box starts exactly at the tail window')
  const extracted = findEmbeddedMotionVideo(file)
  assert.ok(extracted)
  assert.equal(extracted!.length, clip.length)
})

test('a forged offset cannot turn a still into a live photo', () => {
  const still = jpegWithXmp('<rdf:Description GCamera:MotionPhoto="1" GCamera:MicroVideoOffset="999"/>')
  // The claimed clip is larger than the file itself.
  assert.equal(inspectSelection({ head: still, size: still.length, mime: 'image/jpeg' }).kind, 'image')

  // An offset that lands inside the still bytes is rejected by the server too.
  const broken = concat(still, new Uint8Array(64))
  const probe = probeLivePhotoUpload({ cover: broken, maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(probe.ok, false, 'the server never trusts the client claim')
  assert.equal(probe.code, 'MOTION_PHOTO_INVALID', 'the still claims a clip that is not there, and the user is told so')
})

test('Apple still without its clip stays a normal photo with a single hint', () => {
  const identifier = '3f1c2b44-1111-2222-3333-444455556666'
  const still = appleStill(identifier)
  const result = inspectSelection({ head: still, size: still.length, mime: 'image/jpeg' })
  assert.equal(result.kind, 'image')
  assert.equal(result.appleIdentifier, identifier)
  assert.equal(result.missingPairedVideo, true)

  const classified = classifySelection([{ head: still, size: still.length, mime: 'image/jpeg' }])
  assert.equal(classified[0].kind, 'image')
  assert.equal(classified[0].notifyMissingVideo, true)
  assert.equal(classified[0].pairedVideoIndex, undefined)
})

test('Apple still pairs with its MOV by content identifier, never by file name', () => {
  const identifier = '3f1c2b44-1111-2222-3333-444455556666'
  const still = appleStill(identifier)
  const pairedMov = movWithIdentifier(identifier)
  const items = [
    { head: still, size: still.length, mime: 'image/jpeg' },
    { head: pairedMov, size: pairedMov.length, mime: 'video/quicktime' },
  ]
  const classified = classifySelection(items)
  assert.equal(classified[0].kind, 'live-photo')
  assert.equal(classified[0].pairing, 'APPLE')
  assert.equal(classified[0].pairedVideoIndex, 1)
  assert.equal(classified[0].notifyMissingVideo, false)

  const summary = summarizeSelection(classified)
  assert.equal(summary.accepted, 1, 'one live photo occupies exactly one media slot')
  assert.equal(summary.livePhotos, 1)
  assert.equal(summary.skippedVideos, 0, 'the paired clip is not an extra attachment')
})

test('a MOV with a different identifier is never paired', () => {
  const still = appleStill('3f1c2b44-1111-2222-3333-444455556666')
  const otherMov = movWithIdentifier('99999999-8888-7777-6666-555544443333')
  const classified = classifySelection([
    { head: still, size: still.length, mime: 'image/jpeg' },
    { head: otherMov, size: otherMov.length, mime: 'video/quicktime' },
  ])
  assert.equal(classified[0].kind, 'image')
  assert.equal(classified[0].notifyMissingVideo, true)
  const summary = summarizeSelection(classified)
  assert.equal(summary.skippedVideos, 1, 'an unrelated clip is skipped, not attached')
})

test('mixed selection keeps order and counts live photos as one slot each', () => {
  const plain = jpegWithXmp()
  const live = googleMotionPhoto()
  const heic = concat(ftyp('heic', 'mif1'), new Uint8Array(24))
  const classified = classifySelection([
    { head: plain, size: plain.length, mime: 'image/jpeg' },
    { head: live, size: live.length, mime: 'image/jpeg' },
    { head: heic, size: heic.length, mime: 'image/heic' },
  ])
  assert.deepEqual(classified.map((item) => item.kind), ['image', 'live-photo', 'image'])
  const summary = summarizeSelection(classified)
  assert.equal(summary.accepted, 3)
  assert.equal(summary.livePhotos, 1)
  assert.equal(summary.missingVideoNotice, false)
})

test('a corrupted motion photo fails on the server instead of publishing a fake LIVE', () => {
  const clip = mp4()
  const truncated = googleMotionPhoto(clip).slice(0, 40)
  const probe = probeLivePhotoUpload({ cover: truncated, maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(probe.ok, false)
})

test('an embedded clip is measured once against the upload limit', () => {
  const file = googleMotionPhoto()
  const justAbove = probeLivePhotoUpload({ cover: file, maxDurationSeconds: 5, maxUploadBytes: file.length + 8 })
  assert.equal(justAbove.ok, true, 'the original file fits, so the extracted clip must not be counted again')

  const justBelow = probeLivePhotoUpload({ cover: file, maxDurationSeconds: 5, maxUploadBytes: file.length - 1 })
  assert.equal(justBelow.ok, false)
  assert.equal(justBelow.code, 'TOO_LARGE', 'an oversized original is still refused')
})

test('a real mp4 hierarchy yields frame size, duration and audio', () => {
  const file = mp4(3024, 640, 360)
  assert.deepEqual(parseMp4VideoSize(file), { width: 640, height: 360 })
  assert.equal(parseMp4DurationMs(file), 3024)
  assert.equal(hasAudioTrack(file), true, 'audio lives in a sibling track whose handler is also nested')

  const portrait = mp4(2000, 1080, 1920)
  assert.deepEqual(parseMp4VideoSize(portrait), { width: 1080, height: 1920 })
})

test('coded frame size is read from the sample entry when tkhd is zero', () => {
  const avc1 = (() => {
    const payload = new Uint8Array(64)
    payload[24] = 0x05
    payload[25] = 0x00 // 1280
    payload[26] = 0x02
    payload[27] = 0xd0 // 720
    return box('avc1', payload)
  })()
  const trak = box('trak', concat(
    box('tkhd', new Uint8Array(84)),
    box('mdia', concat(hdlr('vide'), box('minf', box('stbl', box('stsd', concat(new Uint8Array(8), avc1)))))),
  ))
  const file = concat(ftyp('mp42'), box('moov', concat(mvhd(1000, 3000), trak)))
  assert.deepEqual(parseMp4VideoSize(file), { width: 1280, height: 720 })
})

test('a 64-bit box size does not stop the chain walk', () => {
  const large = box('mdat', new Uint8Array(32))
  const header64 = concat(u32(1), asciiBytes('mdat'), new Uint8Array(8))
  // Rewrite the 64-bit length field so the box parses as size=1 + u64.
  const length = 16 + 32
  header64.set(u32(length / 0x100000000), 8)
  header64.set(u32(length % 0x100000000), 12)
  const file = concat(ftyp('isom'), box('moov', concat(mvhd(1000, 2000), mp4().subarray(29))), header64, large.subarray(8))
  assert.equal(parseMp4DurationMs(file), 2000, 'the movie header before the large box is still read')
})

test('vendor blocks after the clip do not move the extraction boundary', () => {
  const clip = mp4(3000, 720, 1280)
  const still = jpegWithXmp(
    '<Container:Directory><rdf:Seq><rdf:li><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="'
    + clip.length
    + '" Item:Padding="0"/></rdf:li></rdf:Seq></Container:Directory>',
  )
  // Samsung handsets may append their own trailer after the MP4, so an offset
  // measured from the end of the file no longer lands on the clip. The extra
  // header at the front is skipped by the box chain, never concatenated.
  const file = concat(still, clip, asciiBytes('SEFH'), new Uint8Array(1012))
  const extracted = findEmbeddedMotionVideo(file)
  assert.ok(extracted)
  assert.equal(extracted!.length, clip.length)
  assert.deepEqual(Array.from(extracted!), Array.from(clip))

  const probe = probeLivePhotoUpload({ cover: file, maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(probe.ok, true)
  assert.equal(probe.width, 720)
  assert.equal(probe.height, 1280)
})

test('declared padding is measured with the clip, not as video', () => {
  const clip = mp4(3000)
  const padding = 512
  const still = jpegWithXmp(
    '<Container:Directory><rdf:Seq><rdf:li><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="'
    + clip.length
    + '" Item:Padding="'
    + padding
    + '"/></rdf:li></rdf:Seq></Container:Directory>',
  )
  const file = concat(still, clip, new Uint8Array(padding))
  assert.equal(motionPhotoTrailerLength(file), clip.length + padding)
  const extracted = findEmbeddedMotionVideo(file)
  assert.ok(extracted)
  assert.equal(extracted!.length, clip.length)
})
