import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { compressAnimatedStickerToWebp } from '@/lib/sticker-upload'

function crc32(type: string, data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of Buffer.concat([Buffer.from(type, 'ascii'), data])) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  output.write(type, 4, 4, 'ascii')
  data.copy(output, 8)
  output.writeUInt32BE(crc32(type, data), 8 + data.length)
  return output
}

function apngFrameControl(sequence: number, delay: number): Buffer {
  const output = Buffer.alloc(26)
  output.writeUInt32BE(sequence, 0)
  output.writeUInt32BE(2, 4)
  output.writeUInt32BE(2, 8)
  output.writeUInt32BE(0, 12)
  output.writeUInt32BE(0, 16)
  output.writeUInt16BE(delay, 20)
  output.writeUInt16BE(100, 22)
  output[24] = 0
  output[25] = 0
  return output
}

function makeApngFrame(color: [number, number, number, number]): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])
  const row = Buffer.from([0, ...color, ...color])
  const raw = Buffer.concat([row, row])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function makeAnimatedApng(): Buffer {
  const first = makeApngFrame([255, 0, 0, 255])
  const second = makeApngFrame([0, 0, 255, 255])
  const readIdat = (png: Buffer) => {
    let offset = 8
    while (offset + 12 <= png.length) {
      const size = png.readUInt32BE(offset)
      const type = png.toString('ascii', offset + 4, offset + 8)
      if (type === 'IDAT') return png.subarray(offset + 8, offset + 8 + size)
      offset += 12 + size
    }
    throw new Error('missing IDAT')
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])
  const acTl = Buffer.alloc(8)
  acTl.writeUInt32BE(2, 0)
  acTl.writeUInt32BE(0, 4)
  const secondFdAt = Buffer.alloc(4 + readIdat(second).length)
  secondFdAt.writeUInt32BE(2, 0)
  readIdat(second).copy(secondFdAt, 4)
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('acTL', acTl),
    chunk('fcTL', apngFrameControl(0, 5)),
    chunk('IDAT', readIdat(first)),
    chunk('fcTL', apngFrameControl(1, 5)),
    chunk('fdAT', secondFdAt),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function makeAnimatedGif(): Buffer {
  const frame = (color: 0 | 1, delay: number) => Buffer.from([
    0x21, 0xf9, 0x04, 0x00, delay & 0xff, (delay >> 8) & 0xff, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00,
    0x02, 0x03, ...(color === 0 ? [0x04, 0x00, 0x01] : [0x4c, 0x49, 0x05]), 0x00,
  ])
  return Buffer.concat([
    Buffer.from('GIF89a', 'ascii'),
    Buffer.from([0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00]),
    frame(0, 5),
    frame(1, 5),
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
    const payloadSize = Math.min(255, Math.max(1, remaining - 3))
    chunks.push(Buffer.from([0x21, 0xfe, payloadSize]))
    chunks.push(Buffer.alloc(payloadSize))
    chunks.push(Buffer.from([0x00]))
    remaining -= payloadSize + 4
  }
  return Buffer.concat([body, ...chunks, trailer])
}

test('animated GIF compression keeps animation and reduces a large input', async () => {
  const input = padGif(makeAnimatedGif(), 10 * 1024 * 1024)
  const inputMetadata = await sharp(input, { animated: true }).metadata()
  const output = await compressAnimatedStickerToWebp(input, inputMetadata, 'gif')
  const outputMetadata = await sharp(output, { animated: true }).metadata()

  assert.equal(inputMetadata.format, 'gif')
  assert.equal(inputMetadata.pages, 2)
  assert.equal(outputMetadata.format, 'webp')
  assert.equal(outputMetadata.pages, 2)
  assert.ok(output.length < 2 * 1024 * 1024)
  assert.ok(output.length < input.length)
})

test('animated APNG compression keeps animation when Sharp cannot read APNG pages directly', async () => {
  const input = makeAnimatedApng()
  const inputMetadata = await sharp(input, { animated: true }).metadata()
  const output = await compressAnimatedStickerToWebp(input, inputMetadata, 'png')
  const outputMetadata = await sharp(output, { animated: true }).metadata()

  assert.equal(inputMetadata.format, 'png')
  assert.equal(outputMetadata.format, 'webp')
  assert.equal(outputMetadata.pages, 2)
  assert.equal(outputMetadata.delay?.length, 2)
})
