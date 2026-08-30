import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET } from '../app/api/share/wechat-logo-v2.png/route'
import { WECHAT_SHARE_IMAGE_PATH, WECHAT_SHARE_IMAGE_SIZE, wechatShareImageConstants } from '@/lib/wechat-share-image'

test('WeChat logo thumbnail is an opaque light-background PNG and leaves the official asset untouched', async () => {
  const sourceMetadata = await sharp(readFileSync('app/icon.png')).metadata()
  assert.equal(sourceMetadata.format, 'png')
  assert.equal(sourceMetadata.hasAlpha, true)

  const response = await GET()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')

  const body = Buffer.from(await response.arrayBuffer())
  const metadata = await sharp(body).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, WECHAT_SHARE_IMAGE_SIZE)
  assert.equal(metadata.height, WECHAT_SHARE_IMAGE_SIZE)
  assert.equal(metadata.channels, 4)
  assert.equal(metadata.hasAlpha, true)

  const stats = await sharp(body).stats()
  assert.equal(stats.channels[3]?.min, 255)
  assert.equal(stats.channels[3]?.max, 255)

  const raw = await sharp(body).ensureAlpha().raw().toBuffer()
  assert.deepEqual([...raw.subarray(0, 4)], [245, 245, 245, 255])
  assert.deepEqual(wechatShareImageConstants.path, WECHAT_SHARE_IMAGE_PATH)
})

test('versioned WeChat thumbnail bypasses login in middleware', async () => {
  const { middleware } = await import('../middleware')
  const response = await middleware(new NextRequest(`https://ecfc.fans${WECHAT_SHARE_IMAGE_PATH}`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('location'), null)
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
})
