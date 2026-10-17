import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { TOP_VISUAL_SAFE_ZONE, TOPIC_POSTER_SIZE, topicPosterFooter, topicPosterQr } from '@/lib/topic-activity-v2-poster-layout'

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
  const { width, height } = TOPIC_POSTER_SIZE
  exactPosterUrl = await save('exact-poster.png', await sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#112233"/><rect width="60" height="60" fill="#ee2233"/><rect x="${width - 60}" y="${height - 60}" width="60" height="60" fill="#2244ee"/></svg>`)).png().toBuffer())
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

test('empty images retain the blue fallback at the shared 1080x1440 output size', async () => {
  const png = await renderTopicV2Poster(snapshot(), 'activity-images')
  const metadata = await sharp(png).metadata()
  assert.equal(metadata.format, 'png')
  assert.deepEqual([metadata.width, metadata.height], [TOPIC_POSTER_SIZE.width, TOPIC_POSTER_SIZE.height])
  assert.deepEqual(await pixel(png, 0, 0), [16, 44, 72])
  assert.deepEqual(await pixel(png, Math.floor(TOPIC_POSTER_SIZE.width / 2), TOP_VISUAL_SAFE_ZONE - 1), [16, 44, 72], 'the protected hero remains the fallback background')
})

test('configured background reads real stored bytes and uses centred cover cropping', async () => {
  const png = await renderTopicV2Poster(snapshot(undefined, backgroundUrl), 'activity-images')
  const mid = Math.floor(TOPIC_POSTER_SIZE.width / 2), last = TOPIC_POSTER_SIZE.width - 1, bottom = TOPIC_POSTER_SIZE.height - 1
  assert.deepEqual(await pixel(png, 0, 0), [170, 0, 0], 'cover cropping retains the left source edge')
  assert.deepEqual(await pixel(png, mid, 0), [34, 136, 68], 'cover cropping retains the center source band')
  assert.deepEqual(await pixel(png, last, 0), [0, 0, 170], 'cover cropping retains the right source edge')
  assert.deepEqual(await pixel(png, mid, bottom), [34, 136, 68], 'the background fills the bottom edge without letterboxing')
})

test('legacy result image remains a full-canvas fallback when no shared background exists', async () => {
  const png = await renderTopicV2Poster(snapshot(firstImageUrl), 'activity-images')
  const bounds = await colorBounds(png, [227, 32, 48])
  assert.ok(bounds.count > TOPIC_POSTER_SIZE.width * TOPIC_POSTER_SIZE.height * 0.5, 'the background remains full canvas behind the information cards')
  assert.deepEqual([bounds.left, bounds.right, bounds.top, bounds.bottom], [0, TOPIC_POSTER_SIZE.width - 1, 0, TOPIC_POSTER_SIZE.height - 1])
  assert.deepEqual(await pixel(png, 0, 0), [227, 32, 48])
})

test('the configured activity background is shared and takes precedence over every result image', async () => {
  const first = await renderTopicV2Poster(snapshot(firstImageUrl, backgroundUrl), 'activity-images')
  const second = await renderTopicV2Poster(snapshot(secondImageUrl, backgroundUrl), 'activity-images')
  assert.deepEqual(await pixel(first, Math.floor(TOPIC_POSTER_SIZE.width / 2), 0), [34, 136, 68])
  assert.deepEqual(await pixel(second, Math.floor(TOPIC_POSTER_SIZE.width / 2), 0), [34, 136, 68])
  assert.deepEqual(first, second, 'per-result images must not change the common activity poster background')
})

test('the shared activity background stays visible even when a legacy result image is transparent', async () => {
  const png = await renderTopicV2Poster(snapshot(transparentImageUrl, backgroundUrl), 'activity-images')
  assert.deepEqual(await pixel(png, 0, 0), [170, 0, 0])
  assert.deepEqual(await pixel(png, Math.floor(TOPIC_POSTER_SIZE.width / 2), 0), [34, 136, 68])
})

test('nickname toggle changes only footer content and supports bounded long names', async () => {
  const value = snapshot()
  value.nickname = '很长的会员昵称用于检查海报文字不会超出画布'.repeat(3)
  const on = await renderTopicV2Poster(value, 'activity-images')
  const off = await renderTopicV2Poster({ ...value, poster: { ...value.poster, showNickname: false } }, 'activity-images')
  assert.notDeepEqual(on, off, 'the optional identity panel is omitted when the nickname is hidden')
  assert.deepEqual(await pixel(on, TOPIC_POSTER_SIZE.width - 1, TOPIC_POSTER_SIZE.height - 1), [16, 44, 72])
})

test('QR enabled is decodable from the actual PNG and points to the exact activity', async () => {
  const value = snapshot(firstImageUrl, backgroundUrl)
  const png = await renderTopicV2Poster({ ...value, poster: { ...value.poster, showQrCode: true } }, 'activity with spaces')
  const { left, top, size } = topicPosterQr({ showNickname: true, showQrCode: true })
  const { data, info } = await sharp(png).extract({ left, top, width: size, height: size }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))
  assert.equal(new QRCodeReader().decode(bitmap).getText(), 'https://ecfc.fans/activities/activity%20with%20spaces')
  const off = await renderTopicV2Poster(value, 'activity with spaces')
  assert.deepEqual(await pixel(off, left + 6, top + 5), [34, 136, 68], 'QR disabled leaves the configured background visible without a white placeholder')
})

test('exact 3:4 shared background preserves all corners and has the common brand footer', async () => {
  const png = await renderTopicV2Poster({ ...snapshot(exactPosterUrl), poster: { backgroundUrl: null, showNickname: false, showQrCode: false } }, 'activity-images')
  assert.deepEqual(await pixel(png, 0, 0), [238, 34, 51])
  assert.deepEqual(await pixel(png, TOPIC_POSTER_SIZE.width - 1, TOPIC_POSTER_SIZE.height - 1), [34, 68, 238])
  const brand = topicPosterFooter({ showNickname: false, showQrCode: false })
  const footer = await sharp(png).extract({ left: brand.left, top: brand.top, width: brand.width, height: brand.height }).png().toBuffer()
  assert.ok((await sharp(footer).stats()).channels.some((channel) => channel.stdev > 0), 'V4 footer is rendered even with a supplied background')
})

test('a configured activity background fails closed instead of silently switching to a result image', async () => {
  await assert.rejects(renderTopicV2Poster(snapshot(firstImageUrl, '/uploads/legacy-image-no-longer-exists.png'), 'activity-images'), { code: 'POSTER_BACKGROUND_UNAVAILABLE' })
})

test('result assets reject external, private and temporary URLs without fetching them', async () => {
  for (const imageUrl of ['blob:https://ecfc.fans/x', 'file:///tmp/a.png', 'C:\\a.png', 'https://evil.invalid/a.png', '/cos/topic-activity/private/a.png', '/uploads/%2e%2e/a.png']) {
    await assert.rejects(renderTopicV2Poster(snapshot(imageUrl), 'activity-images'), { code: 'POSTER_RESULT_IMAGE_UNAVAILABLE' })
  }
})
