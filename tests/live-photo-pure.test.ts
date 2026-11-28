import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LIVE_PHOTO_CONFIG, normalizeLivePhotoConfig, publicLivePhotoConfig } from '../lib/live-photo-config.ts'
import { resolveByteRange } from '../lib/live-photo-range.ts'
import { isLivePhotoMarker, livePhotoIdFromMarker, toLivePhotoMarker } from '../lib/live-photo-markers.ts'
import {
  detectImageContainer, detectVideoContainer, extractAppleContentIdentifier,
  findEmbeddedMotionVideo, hasAudioTrack, parseMp4DurationMs, parseMp4VideoSize, probeLivePhotoUpload,
} from '../lib/live-photo-probe.ts'

function box(type: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + payload.length)
  const size = result.length
  result[0] = (size >>> 24) & 0xff
  result[1] = (size >>> 16) & 0xff
  result[2] = (size >>> 8) & 0xff
  result[3] = size & 0xff
  result.set(Array.from(type).map((char) => char.charCodeAt(0)), 4)
  result.set(payload, 8)
  return result
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function u32(value: number) {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function ftyp(brand: string) {
  return box('ftyp', concat(new Uint8Array(Array.from(brand).map((char) => char.charCodeAt(0))), u32(0), u32(512)))
}

function mvhd(timescale: number, duration: number) {
  const payload = new Uint8Array(24)
  payload.set(u32(timescale), 12)
  payload.set(u32(duration), 16)
  return box('mvhd', payload)
}

function hdlr(handler: string) {
  const payload = new Uint8Array(12)
  payload.set(Array.from(handler).map((char) => char.charCodeAt(0)), 8)
  return box('hdlr', payload)
}

function tkhd(width: number, height: number, rotated = false) {
  const payload = new Uint8Array(84)
  payload.set(u32(Math.round(width * 0x10000)), 76)
  payload.set(u32(Math.round(height * 0x10000)), 80)
  payload.set(u32(0x10000), 40)
  payload.set(u32(0x10000), 56)
  if (rotated) payload.set(u32(0x10000), 44)
  return box('tkhd', payload)
}

function mp4(durationMs: number, width = 1080, height = 1920, rotated = false, withAudio = true) {
  const videoTrack = box('trak', concat(tkhd(width, height, rotated), hdlr('vide')))
  const audioTrack = withAudio ? box('trak', concat(tkhd(0, 0), hdlr('soun'))) : new Uint8Array()
  return concat(ftyp('isom'), box('moov', concat(mvhd(1000, durationMs), videoTrack, audioTrack)))
}

function jpeg(marker = '') {
  const extra = Array.from(marker).map((char) => char.charCodeAt(0))
  return concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), u32(extra.length + 10), new Uint8Array(extra), new Uint8Array(8))
}

test('media container detection uses magic bytes, not client MIME', () => {
  assert.equal(detectImageContainer(jpeg()), 'jpeg')
  assert.equal(detectImageContainer(concat(ftyp('heic'), new Uint8Array(4))), 'heic')
  assert.equal(detectVideoContainer(mp4(1000)), 'mp4')
  assert.equal(detectVideoContainer(concat(ftyp('qt  '), new Uint8Array(4))), 'mov')
  assert.equal(detectVideoContainer(new Uint8Array(64)), 'unknown')
})

test('MP4 duration and video size are read from real boxes', () => {
  const video = mp4(4200, 1080, 1920)
  assert.equal(parseMp4DurationMs(video), 4200)
  assert.deepEqual(parseMp4VideoSize(video), { width: 1080, height: 1920 })
  assert.equal(hasAudioTrack(video), true)
  const rotated = mp4(4200, 1080, 1920, true, false)
  assert.deepEqual(parseMp4VideoSize(rotated), { width: 1920, height: 1080 })
  assert.equal(hasAudioTrack(rotated), false)
})

test('Apple pairing identifier can be extracted from both paired resources', () => {
  const identifier = 'B75B1F1A-1234-4ABC-9DEF-0123456789AB'
  const cover = jpeg(`com.apple.quicktime.content.identifier=${identifier}`)
  const video = concat(mp4(1200), new Uint8Array(Array.from(`com.apple.quicktime.content.identifier=${identifier}`).map((char) => char.charCodeAt(0))))
  assert.equal(extractAppleContentIdentifier(cover), identifier)
  const result = probeLivePhotoUpload({ cover, video, maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(result.ok, true)
  assert.equal(result.pairing, 'APPLE')
})

test('manual pairing and Google Motion Photo offset are supported', () => {
  const manual = probeLivePhotoUpload({ cover: jpeg(), video: mp4(2000), manualPairing: true, maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(manual.ok, true)
  assert.equal(manual.pairing, 'MANUAL')

  const embedded = mp4(1500)
  const xmp = Array.from(`<x:xmpmeta>MicroVideoOffset="${embedded.length}"</x:xmpmeta>`).map((char) => char.charCodeAt(0))
  const motionPhoto = concat(jpeg(), new Uint8Array(xmp), embedded)
  const detected = findEmbeddedMotionVideo(motionPhoto)
  assert.ok(detected)
  const result = probeLivePhotoUpload({ cover: motionPhoto, maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(result.ok, true)
  assert.equal(result.pairing, 'MOTION_PHOTO')
})

test('overlong and unreadable videos are rejected instead of auto-trimmed', () => {
  const long = probeLivePhotoUpload({ cover: jpeg(), video: mp4(6000), maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(long.ok, false)
  assert.equal(long.code, 'VIDEO_TOO_LONG')
  const unknown = probeLivePhotoUpload({ cover: jpeg(), video: concat(ftyp('isom'), new Uint8Array(64)), maxDurationSeconds: 5, maxUploadBytes: 30 * 1024 * 1024 })
  assert.equal(unknown.code, 'DURATION_UNKNOWN')
})

test('video Range requests are parsed safely', () => {
  assert.deepEqual(resolveByteRange(null, 100), { start: 0, end: 99, total: 100 })
  assert.deepEqual(resolveByteRange('bytes=10-19', 100), { start: 10, end: 19, total: 100 })
  assert.deepEqual(resolveByteRange('bytes=0-', 100), { start: 0, end: 99, total: 100 })
  assert.deepEqual(resolveByteRange('bytes=-20', 100), { start: 80, end: 99, total: 100 })
  assert.equal(resolveByteRange('bytes=100-', 100), null)
  assert.equal(resolveByteRange('bytes=20-10', 100), null)
})

test('config is clamped and marker helpers round-trip', () => {
  const config = normalizeLivePhotoConfig({ enabled: false, maxDurationSeconds: 999, transcodeConcurrency: 99, quality: 1, keepAudio: 'no' })
  assert.equal(config.enabled, false)
  assert.equal(config.maxDurationSeconds, 15)
  assert.equal(config.transcodeConcurrency, 2)
  assert.equal(config.quality, 18)
  assert.equal(config.keepAudio, DEFAULT_LIVE_PHOTO_CONFIG.keepAudio)
  assert.equal(publicLivePhotoConfig(config).maxFps, 30)
  const marker = toLivePhotoMarker('asset_12345678')
  assert.equal(isLivePhotoMarker(marker), true)
  assert.equal(livePhotoIdFromMarker(marker), 'asset_12345678')
  assert.equal(livePhotoIdFromMarker('[[live-photo:bad id]]'), null)
})
