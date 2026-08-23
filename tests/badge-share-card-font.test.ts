import assert from 'node:assert/strict'
import { statSync, readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { BADGE_SHARE_FONT_FAMILY, BADGE_SHARE_FONT_STACK, createBadgeShareTextLayer } from '@/lib/badge-share-card'

test('分享卡使用仓库内非空 CJK 字体且保留跨平台 emoji fallback', () => {
  assert.ok(statSync('public/fonts/NotoSansSC-VF.ttf').size > 1_000_000)
  assert.equal(BADGE_SHARE_FONT_FAMILY, 'Noto Sans SC')
  assert.match(BADGE_SHARE_FONT_STACK, /Noto Color Emoji.*Apple Color Emoji.*Segoe UI Emoji/)
  const source = readFileSync('lib/badge-share-card.ts', 'utf8')
  assert.match(source, /fontfile:\s*BADGE_SHARE_FONT_PATH/)
  assert.match(source, /Buffer\.from\(svg, 'utf8'\)/)
})

test('中文勋章、昵称、标点和 emoji 可进入实际 Sharp/Pango 像素渲染', async () => {
  const layer = await createBadgeShareTextLayer({
    text: '私家E院 · 百日挂号｜小鹿🎖 中文标点：“荣誉”',
    top: 0,
    width: 800,
    fontSize: 32,
    color: '#173d4d',
    weight: 700,
  })
  const metadata = await sharp(layer.input).metadata()
  assert.equal(metadata.format, 'png')
  assert.ok((metadata.width || 0) > 100)
  assert.ok((metadata.height || 0) > 20)
})

test('分享卡不是浏览器截图链路，无需依赖 document.fonts.ready', () => {
  const source = readFileSync('lib/badge-share-card.ts', 'utf8')
  assert.match(source, /sharp\(Buffer\.from\(svg, 'utf8'\)\)\.composite\(textLayers\)/)
  assert.doesNotMatch(source, /html2canvas|foreignObject|document\.fonts/)
})
