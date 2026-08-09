import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { getFfmpegPath } from '@/lib/guess-song-audio'
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

function encodePngFramesAsGif(frames: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-framerate',
      '8',
      '-i',
      'pipe:0',
      '-filter_complex',
      '[0:v]fps=8,split[paletteSource][imageSource];[paletteSource]palettegen=max_colors=128[palette];[imageSource][palette]paletteuse=dither=sierra2_4a[gif]',
      '-map',
      '[gif]',
      '-loop',
      '0',
      '-f',
      'gif',
      'pipe:1',
    ], { windowsHide: true })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(output))
      else reject(new Error(`FFmpeg GIF encode failed: ${Buffer.concat(errors).toString('utf8')}`))
    })
    child.stdin.end(Buffer.concat(frames))
  })
}

async function makeRealisticAnimatedGif(): Promise<Buffer> {
  const frames = await Promise.all(Array.from({ length: 8 }, (_, frameIndex) => {
    const armOffset = frameIndex % 2 === 0 ? -18 : 18
    const stepOffset = frameIndex % 2 === 0 ? 0 : 10
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#172554" />
            <stop offset="1" stop-color="#0f766e" />
          </linearGradient>
        </defs>
        <rect width="320" height="320" fill="url(#sky)" />
        <circle cx="38" cy="42" r="3" fill="#fef08a" />
        <circle cx="278" cy="58" r="2" fill="#fef08a" />
        <circle cx="236" cy="30" r="2" fill="#fef08a" />
        <rect x="22" y="236" width="276" height="4" rx="2" fill="#99f6e4" opacity=".7" />
        <text x="160" y="42" fill="#fef3c7" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle">EASON LIVE</text>
        <circle cx="160" cy="112" r="34" fill="#fbbf24" />
        <circle cx="149" cy="106" r="4" fill="#172554" />
        <circle cx="171" cy="106" r="4" fill="#172554" />
        <path d="M148 124 Q160 135 172 124" fill="none" stroke="#172554" stroke-width="5" stroke-linecap="round" />
        <path d="M160 146 L160 214" stroke="#f8fafc" stroke-width="16" stroke-linecap="round" />
        <path d="M160 160 L${118 + armOffset} 190" stroke="#f8fafc" stroke-width="12" stroke-linecap="round" />
        <path d="M160 160 L${202 - armOffset} 190" stroke="#f8fafc" stroke-width="12" stroke-linecap="round" />
        <path d="M160 214 L${140 - stepOffset} 264" stroke="#f8fafc" stroke-width="14" stroke-linecap="round" />
        <path d="M160 214 L${180 + stepOffset} 264" stroke="#f8fafc" stroke-width="14" stroke-linecap="round" />
        <text x="160" y="298" fill="#ccfbf1" font-family="sans-serif" font-size="18" text-anchor="middle">KEEP MOVING</text>
      </svg>`
    return sharp(Buffer.from(svg)).png().toBuffer()
  }))
  return encodePngFramesAsGif(frames)
}

test('suspiciously small animated output is warned about and source animation is preserved', async () => {
  const input = padGif(makeAnimatedGif(), 10 * 1024 * 1024)
  const inputMetadata = await sharp(input, { animated: true }).metadata()
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  let output: Buffer
  try {
    output = await compressAnimatedStickerToWebp(input, inputMetadata, 'gif')
  } finally {
    console.warn = originalWarn
  }
  const outputMetadata = await sharp(output, { animated: true }).metadata()

  assert.equal(inputMetadata.format, 'gif')
  assert.equal(inputMetadata.pages, 2)
  assert.equal(outputMetadata.format, 'gif')
  assert.equal(outputMetadata.pages, 2)
  assert.equal(output.length, input.length)
  assert.equal(warnings.length, 1)
})

test('realistic animated GIF with a moving person and text keeps readable multi-frame output', async () => {
  const input = await makeRealisticAnimatedGif()
  const inputMetadata = await sharp(input, { animated: true }).metadata()
  const output = await compressAnimatedStickerToWebp(input, inputMetadata, 'gif')
  const outputMetadata = await sharp(output, { animated: true }).metadata()

  assert.equal(inputMetadata.format, 'gif')
  assert.ok((inputMetadata.pages || 0) >= 8)
  assert.equal(outputMetadata.format, 'webp')
  assert.equal(outputMetadata.pages, inputMetadata.pages)
  assert.ok((outputMetadata.width || 0) <= 320)
  assert.ok((outputMetadata.pageHeight || outputMetadata.height || 0) <= 320)
  assert.ok(output.length > input.length * 0.01)
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
