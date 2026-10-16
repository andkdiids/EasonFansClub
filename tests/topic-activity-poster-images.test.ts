import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'

let directory = ''
let backgroundUrl = ''
let firstImageUrl = ''
let secondImageUrl = ''
let transparentImageUrl = ''
let exactPosterUrl = ''

before(async () => {
  const uploads = join(process.cwd(), 'public', 'uploads')
  await mkdir(uploads, { recursive: true })
  directory = await mkdtemp(join(uploads, 'topic-poster-images-test-'))
  const save = async (name: string, image: Buffer) => {
    await writeFile(join(directory, name), image)
    return `/uploads/${basename(directory)}/${name}`
  }
  backgroundUrl = await save('background.png', await sharp(Buffer.from('<svg width="1800" height="900"><rect width="600" height="900" fill="#aa0000"/><rect x="600" width="600" height="900" fill="#228844"/><rect x="1200" width="600" height="900" fill="#0000aa"/></svg>')).png().toBuffer())
  firstImageUrl = await save('first.png', await sharp({ create: { width: 240, height: 120, channels: 4, background: '#e32030' } }).png().toBuffer())
  secondImageUrl = await save('second.png', await sharp({ create: { width: 120, height: 240, channels: 4, background: '#2030e3' } }).png().toBuffer())
  transparentImageUrl = await save('transparent.png', await sharp(Buffer.from('<svg width="200" height="200"><rect x="60" y="60" width="80" height="80" fill="#ee22dd"/></svg>')).png().toBuffer())
  exactPosterUrl = await save('exact-poster.png', await sharp(Buffer.from('<svg width="1080" height="1920"><rect width="1080" height="1920" fill="#112233"/><rect width="60" height="60" fill="#ee2233"/><rect x="1020" y="1860" width="60" height="60" fill="#2244ee"/></svg>')).png().toBuffer())
})

after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

const snapshot = (imageUrl?: string, customBackground?: string) => ({
  activityTitle: '天使的礼物', title: '我的测试结果', description: '这是当前命中的结果说明。',
  score: 1, maxScore: 1, nickname: '测试会员', imageUrl,
  poster: { backgroundUrl: customBackground ?? null, showNickname: true, showQrCode: false },
})

async function pixel(png: Buffer, left: number, top: number) {
  return [...await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
}

async function colorBounds(png: Buffer, color: readonly number[]) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, right = -1, top = info.height, bottom = -1, count = 0
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * info.channels
    if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 3)) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++
    }
  }
  return { left, right, top, bottom, count, width: right - left + 1, height: bottom - top + 1 }
}

test('empty images retain the blue fallback at the real 1080x1920 output size', async () => {
  const png = await renderTopicV2Poster(snapshot(), 'activity-images')
  const metadata = await sharp(png).metadata()
  assert.equal(metadata.format, 'png')
  assert.deepEqual([metadata.width, metadata.height], [1080, 1920])
  assert.deepEqual(await pixel(png, 0, 0), [16, 44, 72])
  assert.deepEqual(await pixel(png, 540, 1200), [16, 44, 72], 'no empty result frame or panel')
})

test('configured background reads real stored bytes and uses centred cover cropping', async () => {
  const png = await renderTopicV2Poster(snapshot(undefined, backgroundUrl), 'activity-images')
  for (const [x, y] of [[0, 0], [1079, 0], [0, 1919], [1079, 1919]]) {
    assert.deepEqual(await pixel(png, x, y), [34, 136, 68], 'wide image must crop its edges rather than stretch or add letterboxing')
  }
})

test('result poster fills the full canvas, never a central thumbnail', async () => {
  const png = await renderTopicV2Poster(snapshot(firstImageUrl), 'activity-images')
  const bounds = await colorBounds(png, [227, 32, 48])
  assert.ok(bounds.count > 1_500_000)
  assert.deepEqual([bounds.left, bounds.right, bounds.top, bounds.bottom], [0, 1079, 0, 1919])
  assert.deepEqual(await pixel(png, 0, 0), [227, 32, 48])
})

test('each result poster takes precedence over legacy background without mixing', async () => {
  const first = await renderTopicV2Poster(snapshot(firstImageUrl, backgroundUrl), 'activity-images')
  const second = await renderTopicV2Poster(snapshot(secondImageUrl, backgroundUrl), 'activity-images')
  assert.ok((await colorBounds(first, [227, 32, 48])).count > 10_000)
  assert.equal((await colorBounds(first, [32, 48, 227])).count, 0)
  const secondBounds = await colorBounds(second, [32, 48, 227])
  assert.ok(secondBounds.count > 1_500_000)
  assert.deepEqual([secondBounds.left, secondBounds.top, secondBounds.right, secondBounds.bottom], [0, 0, 1079, 1919])
  assert.equal((await colorBounds(second, [227, 32, 48])).count, 0)
  assert.deepEqual(await pixel(first, 0, 0), [227, 32, 48])
  assert.deepEqual(await pixel(second, 0, 0), [32, 48, 227])
})

test('transparent result posters do not cause the legacy background to be composited', async () => {
  const png = await renderTopicV2Poster(snapshot(transparentImageUrl, backgroundUrl), 'activity-images')
  const bounds = await colorBounds(png, [238, 34, 221])
  assert.ok(bounds.count > 10_000)
  const rgba = await sharp(png).extract({ left: 0, top: 0, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()
  assert.equal(rgba[3], 0)
})

test('nickname toggle changes only footer content and supports bounded long names', async () => {
  const value = snapshot()
  value.nickname = '很长的会员昵称用于检查海报文字不会超出画布'.repeat(3)
  const on = await renderTopicV2Poster(value, 'activity-images')
  const off = await renderTopicV2Poster({ ...value, poster: { ...value.poster, showNickname: false } }, 'activity-images')
  const region = { left: 96, top: 1600, width: 888, height: 100 }
  assert.notDeepEqual(await sharp(on).extract(region).raw().toBuffer(), await sharp(off).extract(region).raw().toBuffer())
  assert.deepEqual(await pixel(on, 1079, 1665), [16, 44, 72])
})

test('QR enabled is decodable from the actual PNG and points to the exact activity', async () => {
  const value = snapshot(firstImageUrl, backgroundUrl)
  const png = await renderTopicV2Poster({ ...value, poster: { ...value.poster, showQrCode: true } }, 'activity with spaces')
  const { data, info } = await sharp(png).extract({ left: 744, top: 1545, width: 240, height: 240 }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))
  assert.equal(new QRCodeReader().decode(bitmap).getText(), 'https://ecfc.fans/activities/activity%20with%20spaces')
  const off = await renderTopicV2Poster(value, 'activity with spaces')
  assert.deepEqual(await pixel(off, 750, 1550), [227, 32, 48], 'QR disabled leaves no white placeholder')
})

test('exact 9:16 result image preserves all corners without a frame, crop or duplicate footer brand', async () => {
  const png = await renderTopicV2Poster({ ...snapshot(exactPosterUrl), poster: { backgroundUrl: null, showNickname: false, showQrCode: false } }, 'activity-images')
  assert.deepEqual(await pixel(png, 0, 0), [238, 34, 51])
  assert.deepEqual(await pixel(png, 1079, 1919), [34, 68, 238])
  const footer = await sharp(png).extract({ left: 90, top: 1780, width: 800, height: 70 }).png().toBuffer()
  assert.deepEqual(await sharp(footer).stats().then((stats) => stats.channels.map((channel) => channel.stdev)), [0, 0, 0, 0])
})

test('a valid result poster does not read or fail because of a stale legacy global path', async () => {
  const png = await renderTopicV2Poster(snapshot(firstImageUrl, '/uploads/legacy-image-no-longer-exists.png'), 'activity-images')
  assert.deepEqual(await pixel(png, 0, 0), [227, 32, 48])
})

test('result assets reject external, private and temporary URLs without fetching them', async () => {
  for (const imageUrl of ['blob:https://ecfc.fans/x', 'file:///tmp/a.png', 'C:\\a.png', 'https://evil.invalid/a.png', '/cos/topic-activity/private/a.png', '/uploads/%2e%2e/a.png']) {
    await assert.rejects(renderTopicV2Poster(snapshot(imageUrl), 'activity-images'), { code: 'POSTER_RESULT_IMAGE_UNAVAILABLE' })
  }
})
