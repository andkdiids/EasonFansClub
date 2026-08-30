import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import manifest from '../app/manifest'

function pngDimensions(path: string) {
  const file = readFileSync(path)
  assert.deepEqual([...file.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} must be PNG`)
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  }
}

test('official browser, app and Apple icon files keep their expected dimensions', () => {
  assert.deepEqual(pngDimensions('app/icon.png'), { width: 512, height: 512 })
  assert.deepEqual(pngDimensions('app/apple-icon.png'), { width: 180, height: 180 })
  const favicon = readFileSync('app/favicon.ico')
  assert.deepEqual([...favicon.subarray(0, 4)], [0, 0, 1, 0], 'favicon.ico must use the ICO signature')
})

test('manifest exposes separate transparent any and backgrounded maskable icons', () => {
  const entries = manifest().icons || []
  assert.deepEqual(entries, [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ])
  assert.equal(manifest().display, 'standalone')
  assert.equal(manifest().start_url, '/community')
})

test('derived PWA icon files have the declared sizes and maskable files have an opaque background', async () => {
  assert.deepEqual(pngDimensions('public/icons/icon-192.png'), { width: 192, height: 192 })
  assert.deepEqual(pngDimensions('public/icons/icon-512.png'), { width: 512, height: 512 })
  assert.deepEqual(pngDimensions('public/icons/maskable-192.png'), { width: 192, height: 192 })
  assert.deepEqual(pngDimensions('public/icons/maskable-512.png'), { width: 512, height: 512 })
  const anyIcon = await sharp('public/icons/icon-192.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const maskableIcon = await sharp('public/icons/maskable-192.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(anyIcon.data[3], 0, 'transparent any icon should keep a transparent canvas corner')
  assert.equal(maskableIcon.data[3], 255, 'maskable icon should use an opaque canvas corner')
})
