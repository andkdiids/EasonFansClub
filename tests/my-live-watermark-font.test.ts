import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  buildMyLivePhotoWatermarkSvg,
  isCjkFontAvailable,
  resolveCjkWatermarkFontFamily,
} from '../lib/my-live-photos'

test('水印 font-family 以中文字体优先，不再以 Arial/Helvetica 开头', () => {
  const family = resolveCjkWatermarkFontFamily()
  assert.ok(family.length > 0)
  const first = family.split(',')[0]!.trim().toLowerCase()
  assert.notEqual(first, 'arial')
  assert.notEqual(first, 'helvetica')
  assert.doesNotMatch(family, /^\s*arial/i)
  // 必须包含至少一种已知中文字体，且中文字体在 sans-serif 之前
  assert.ok(/noto sans cjk|noto sans sc|microsoft yahei|pingfang|wenquanyi|source han|simhei|heiti/i.test(family))
  const cjkIndex = family.search(/noto sans cjk|noto sans sc|microsoft yahei|pingfang|wenquanyi|source han|simhei|heiti/i)
  const sansIndex = family.toLowerCase().lastIndexOf('sans-serif')
  assert.ok(cjkIndex >= 0 && cjkIndex < sansIndex, '中文字体应排在 sans-serif 回退之前')
})

test('水印 SVG 使用解析后的中文字体，且包含中文昵称原文（UTF-8 字面量）', () => {
  const { svg, text } = buildMyLivePhotoWatermarkSvg({ nickname: '范范Vanessa', uid: 11153, width: 1200, height: 1600 })
  assert.equal(text, '范范Vanessa  UID:11153')
  // font-family 中明确出现中文字体
  assert.match(svg, /font-family="[^"]*noto sans cjk|noto sans sc|microsoft yahei|wenquanyi|source han/i)
  // 中文以 UTF-8 字面量写入，不被转义为实体
  assert.match(svg, /范范Vanessa/)
  assert.doesNotMatch(svg, /&amp;范|&#/)
  // 显式 UTF-8 声明
  assert.match(svg, /<\?xml version="1\.0" encoding="UTF-8"\?>/)
})

test('昵称中的 XML 特殊字符被正确转义', () => {
  const { text, svg } = buildMyLivePhotoWatermarkSvg({ nickname: 'A&B<C>', uid: 1, width: 800, height: 600 })
  assert.equal(text, 'A&B<C>  UID:1')
  assert.match(svg, /A&amp;B&lt;C&gt;/)
  assert.doesNotMatch(svg, />A&B<C</)
})

test('emoji 昵称渲染不崩溃（emoji 字体按支持情况回退）', async () => {
  const base = await sharp({
    create: { width: 800, height: 600, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  }).png().toBuffer()
  const overlay = buildMyLivePhotoWatermarkSvg({ nickname: '范😀Vanessa', uid: 11153, width: 800, height: 600 })
  const out = await sharp(base)
    .composite([{ input: Buffer.from(overlay.svg), left: overlay.left, top: overlay.top }])
    .webp()
    .toBuffer()
  assert.ok(Buffer.isBuffer(out) && out.byteLength > 0)
  const meta = await sharp(out).metadata()
  assert.equal(meta.format, 'webp')
})

test('实际渲染：含中文昵称的水印可生成有效 WebP（不崩溃）', async () => {
  const base = await sharp({
    create: { width: 1200, height: 1600, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  }).png().toBuffer()
  const overlay = buildMyLivePhotoWatermarkSvg({ nickname: '范范Vanessa', uid: 11153, width: 1200, height: 1600 })
  const out = await sharp(base)
    .composite([{ input: Buffer.from(overlay.svg), left: overlay.left, top: overlay.top }])
    .webp()
    .toBuffer()
  assert.ok(Buffer.isBuffer(out))
  assert.ok(out.byteLength > 0)
  const meta = await sharp(out).metadata()
  assert.equal(meta.format, 'webp')
})

test('诊断：服务器是否已安装中文字体（仅日志，不强制失败）', () => {
  const available = isCjkFontAvailable()
  console.log('[watermark-font] CJK 字体是否已安装:', available)
  console.log('[watermark-font] 解析到的 font-family:', resolveCjkWatermarkFontFamily())
})
