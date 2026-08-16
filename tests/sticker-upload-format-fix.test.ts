import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import {
  STICKER_COVER_ANIMATED_MESSAGE,
  STICKER_COVER_UNSUPPORTED_FORMAT_MESSAGE,
  STICKER_FILE_UNRECOGNIZED_MESSAGE,
  STICKER_IMAGE_UNSUPPORTED_FORMAT_MESSAGE,
  StickerUploadError,
  convertStaticStickerToWebp,
  validateStickerImageBuffer,
} from '@/lib/sticker-upload'

const read = (path: string) => readFileSync(path, 'utf8')

async function makeStaticImage(format: 'jpeg' | 'png' | 'webp') {
  const image = sharp({
    create: {
      width: 640,
      height: 640,
      channels: 3,
      background: { r: 28, g: 72, b: 112 },
    },
  })
  if (format === 'jpeg') return image.jpeg().toBuffer()
  if (format === 'png') return image.png().toBuffer()
  return image.webp().toBuffer()
}

function makeAnimatedGif(): Buffer {
  const frame = (color: 0 | 1) => Buffer.from([
    0x21, 0xf9, 0x04, 0x00, 0x05, 0x00, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00,
    0x02, 0x03, ...(color === 0 ? [0x04, 0x00, 0x01] : [0x4c, 0x49, 0x05]), 0x00,
  ])
  return Buffer.concat([
    Buffer.from('GIF89a', 'ascii'),
    Buffer.from([0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00]),
    frame(0),
    frame(1),
    Buffer.from([0x3b]),
  ])
}

async function makeAnimatedWebp() {
  const frameSize = 2
  const frameCount = 2
  const raw = Buffer.alloc(frameSize * frameSize * 4 * frameCount)
  raw.fill(255, 0, frameSize * frameSize * 4)
  for (let index = frameSize * frameSize * 4; index < raw.length; index += 4) {
    raw[index] = 24
    raw[index + 1] = 96
    raw[index + 2] = 160
    raw[index + 3] = 255
  }
  return sharp(raw, {
    raw: {
      width: frameSize,
      height: frameSize * frameCount,
      pageHeight: frameSize,
      channels: 4,
    },
  }).webp({ delay: [100, 100], loop: 0 }).toBuffer()
}

test('static JPEG, PNG, and WebP cover bytes are accepted even with empty multipart MIME', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const result = await validateStickerImageBuffer({
      kind: 'cover',
      buffer: await makeStaticImage(format),
      source: {
        field: 'cover',
        originalName: format === 'jpeg' ? 'cover.jpg' : 'cover.' + format,
        mimeType: '',
      },
    })
    assert.equal(result.format, format)
    assert.equal(result.animated, false)
  }
})

test('static JPEG, PNG, and WebP cover processing produces a valid WebP payload', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const output = await convertStaticStickerToWebp(await makeStaticImage(format))
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.format, 'webp')
  }
})

test('GIF and Animated WebP covers are rejected with a precise dynamic-cover message', async () => {
  for (const buffer of [makeAnimatedGif(), await makeAnimatedWebp()]) {
    await assert.rejects(
      validateStickerImageBuffer({
        kind: 'cover',
        buffer,
        source: { field: 'cover', originalName: 'cover.webp', mimeType: 'image/webp' },
      }),
      (error: unknown) => error instanceof StickerUploadError && error.message === STICKER_COVER_ANIMATED_MESSAGE,
    )
  }
})

test('known non-static cover formats and undecodable files receive distinct errors', async () => {
  const tiff = await sharp({
    create: {
      width: 640,
      height: 640,
      channels: 3,
      background: { r: 28, g: 72, b: 112 },
    },
  }).tiff().toBuffer()
  await assert.rejects(
    validateStickerImageBuffer({
      kind: 'cover',
      buffer: tiff,
      source: { field: 'cover', originalName: 'cover.tiff', mimeType: 'image/tiff' },
    }),
    (error: unknown) => error instanceof StickerUploadError && error.message === STICKER_COVER_UNSUPPORTED_FORMAT_MESSAGE,
  )

  await assert.rejects(
    validateStickerImageBuffer({
      kind: 'cover',
      buffer: Buffer.from('not an image'),
      source: { field: 'cover', originalName: 'cover.jpg', mimeType: '' },
    }),
    (error: unknown) => error instanceof StickerUploadError && error.message === STICKER_FILE_UNRECOGNIZED_MESSAGE,
  )
})

test('GIF and Animated WebP sticker bytes remain valid body uploads', async () => {
  const gif = await validateStickerImageBuffer({
    kind: 'sticker',
    buffer: makeAnimatedGif(),
    source: { field: 'stickerFiles', originalName: 'a.gif', mimeType: '' },
  })
  const webp = await validateStickerImageBuffer({
    kind: 'sticker',
    buffer: await makeAnimatedWebp(),
    source: { field: 'stickerFiles', originalName: 'a.webp', mimeType: 'image/webp' },
  })
  assert.equal(gif.format, 'gif')
  assert.equal(gif.animated, true)
  assert.equal(webp.format, 'webp')
  assert.equal(webp.animated, true)
  assert.notEqual(STICKER_IMAGE_UNSUPPORTED_FORMAT_MESSAGE, STICKER_COVER_ANIMATED_MESSAGE)
})

test('upload validation uses Sharp bytes, normalized MIME helpers, and diagnostic context', () => {
  const lib = read('lib/sticker-upload.ts')
  const uploader = read('app/stickers/upload/StickerPackUploader.tsx')
  const constraints = read('lib/sticker-upload-constraints.ts')

  assert.match(lib, /validateStickerImageBuffer/)
  assert.match(lib, /logImageValidationFailure/)
  assert.match(lib, /detectedFormat/)
  assert.match(lib, /STICKER_FILE_UNRECOGNIZED_MESSAGE/)
  assert.match(lib, /STICKER_COVER_ANIMATED_MESSAGE/)
  assert.match(lib, /sharp\(input, \{[\s\S]*animated: true/)
  assert.doesNotMatch(lib, /STICKER_STATIC_MIME_TYPES\.includes\(metadata\.format/)
  assert.match(uploader, /new File\(\[file\], file\.name/)
  assert.match(uploader, /type: mime/)
  assert.match(uploader, /accept=\{STATIC_IMAGE_ACCEPT\}/)
  assert.match(constraints, /normalizeImageMime/)
  assert.match(constraints, /image\/jpg/)
})

test('all sticker APIs pass filename and MIME diagnostics without hard-rejecting browser MIME', () => {
  const uploadPack = read('app/api/stickers/upload-pack/route.ts')
  const upload = read('app/api/stickers/upload/route.ts')
  const admin = read('app/api/admin/stickers/route.ts')
  const edit = read('app/api/stickers/my/[packId]/route.ts')

  for (const route of [uploadPack, upload, admin, edit]) {
    assert.doesNotMatch(route, /isStickerMimeAllowed\(/)
  }
  assert.match(uploadPack, /field: 'cover'/)
  assert.match(uploadPack, /field: 'stickerFiles'/)
  assert.match(upload, /originalName: file\.name/)
  assert.match(admin, /mimeType: file\.type/)
  assert.match(edit, /originalName: coverFile\.name/)
})
