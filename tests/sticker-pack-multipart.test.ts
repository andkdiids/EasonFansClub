import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import {
  parseStickerPackMultipart,
  removeStickerMultipartTempDirectory,
} from '@/lib/sticker-pack-multipart'
import { compressAnimatedStickerToWebp } from '@/lib/sticker-upload'

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

function padGif(input: Buffer, targetSize: number): Buffer {
  if (input.length >= targetSize) return input
  const trailer = input.subarray(input.length - 1)
  const body = input.subarray(0, input.length - 1)
  const chunks: Buffer[] = []
  let remaining = targetSize - input.length
  while (remaining > 0) {
    const payloadSize = Math.min(255, Math.max(1, remaining - 4))
    chunks.push(Buffer.from([0x21, 0xfe, payloadSize]))
    chunks.push(Buffer.alloc(payloadSize))
    chunks.push(Buffer.from([0x00]))
    remaining -= payloadSize + 4
  }
  return Buffer.concat([body, ...chunks, trailer])
}

test('streams a 10MB animated GIF multipart request and preserves its frames', async () => {
  const gif = padGif(makeAnimatedGif(), 10 * 1024 * 1024)
  const form = new FormData()
  form.append('name', '流式解析测试')
  form.append('description', 'multipart regression')
  form.append('type', 'GIF')
  for (let index = 0; index < 6; index += 1) {
    form.append('stickerNames', `S${index}`)
    const source = index === 0 ? gif : makeAnimatedGif()
    const fileBytes = new Uint8Array(new ArrayBuffer(source.byteLength))
    fileBytes.set(source)
    form.append(
      'stickerFiles',
      new File([fileBytes], `frame-${index}.gif`, { type: 'image/gif' }),
    )
  }

  const request = new Request('http://localhost/api/stickers/upload-pack', {
    method: 'POST',
    body: form,
  })
  const parsed = await parseStickerPackMultipart(request)

  try {
    const stickerFiles = parsed.files
      .filter((file) => file.fieldName === 'stickerFiles')
      .sort((left, right) => left.ordinal - right.ordinal)
    assert.equal(parsed.fields.get('name')?.[0], '流式解析测试')
    assert.equal(stickerFiles.length, 6)
    assert.ok(stickerFiles[0].size >= 10 * 1024 * 1024)
    assert.equal(stickerFiles[0].mimeType, 'image/gif')

    const parsedGif = await readFile(stickerFiles[0].path)
    assert.equal(parsedGif.subarray(0, 6).toString('ascii'), 'GIF89a')
    const sourceMetadata = await sharp(parsedGif, { animated: true }).metadata()
    const compressed = await compressAnimatedStickerToWebp(parsedGif, sourceMetadata, 'gif')
    const outputMetadata = await sharp(compressed, { animated: true }).metadata()

    assert.equal(sourceMetadata.pages, 2)
    assert.equal(outputMetadata.pages, 2)
    assert.ok(compressed.length > 0)
  } finally {
    await removeStickerMultipartTempDirectory(parsed.tempDirectory)
  }
})
