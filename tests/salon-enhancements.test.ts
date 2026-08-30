import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { buildSalonFeedWhere, SALON_CATEGORIES, salonPublicBaseWhere, supportsOriginal } from '@/lib/salon'
import { SALON_MAX_FILE_SIZE, SALON_MAX_FILES, validateSalonFiles } from '@/lib/salon-upload'
import {
  calculateSalonWatermarkLayout,
  createSalonWatermarkSvg,
  createSalonWatermarkText,
  SALON_WATERMARK_POSITIONS,
} from '@/lib/salon-watermark'
import { createImageVariants } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { imageOriginalObjectPath } from '@/lib/image-variants'
import { shareCardApiPath } from '@/lib/share-card'

const read = (path: string) => readFileSync(path, 'utf8')
const mb = 1024 * 1024

test('沙龙多图限制按单文件校验，不设置总容量 20MB 上限', () => {
  assert.equal(validateSalonFiles([
    { name: 'one.jpg', size: 8 * mb },
    { name: 'two.jpg', size: 7 * mb },
    { name: 'three.jpg', size: 9 * mb },
  ]).ok, true)
  const oversized = validateSalonFiles([{ name: 'IMG_1234.JPG', size: SALON_MAX_FILE_SIZE + 1 }])
  assert.equal(oversized.ok, false)
  assert.match(oversized.error || '', /IMG_1234\.JPG.*超过 20MB/)
  assert.equal(validateSalonFiles(Array.from({ length: SALON_MAX_FILES }, (_, index) => ({ name: `${index}.jpg`, size: 19 * mb }))).ok, true)
  const tooMany = validateSalonFiles(Array.from({ length: SALON_MAX_FILES + 1 }, (_, index) => ({ name: `${index}.jpg`, size: mb })))
  assert.equal(tooMany.ok, false)
  assert.match(tooMany.error || '', /最多上传 9 张/)
  const route = read('app/api/salon/posts/route.ts')
  assert.match(route, /validateSalonFiles/)
  assert.doesNotMatch(route, /MAX_TOTAL_SIZE|reduce\(.*size|totalSize/i)
})

test('保留原图的沙龙上传仍同时生成 display WebP', async () => {
  const original = Buffer.from('original-jpeg-bytes')
  const generated = { format: 'jpeg', source: Buffer.from('source-webp'), variants: { card: Buffer.from('card-webp') } }
  const uploaded: Array<{ key: string; body: Buffer; contentType: string }> = []
  const result = await uploadImageVariantFamily({
    sourceObjectPath: 'salon/user-1/post-wallpaper/1-upload/source.webp',
    original,
    originalContentType: 'image/jpeg',
    preserveOriginal: true,
    generated,
    upload: async (input) => { uploaded.push(input); return `https://media.ecfc.fans/${input.key}` },
  })
  assert.equal(result.originalObjectKey, imageOriginalObjectPath('salon/user-1/post-wallpaper/1-upload/source.webp'))
  assert.ok(result.originalUrl)
  assert.equal(uploaded.some(({ key }) => key.endsWith('/original')), true)
  assert.equal(uploaded.some(({ key }) => key.endsWith('/source.webp')), true)
})

test('沙龙壁纸上传对象保持原图并单独生成 display WebP，上传顺序使用 sortOrder', async () => {
  const sourceObjectPath = 'salon/user-1/post-1/1-upload/source.webp'
  const original = Buffer.from('original-jpeg-bytes')
  const generated = { format: 'jpeg', source: Buffer.from('source-webp'), variants: { card: Buffer.from('card-webp') } }
  const uploaded: Array<{ key: string; body: Buffer; contentType: string }> = []
  const result = await uploadImageVariantFamily({
    sourceObjectPath,
    original,
    originalContentType: 'image/jpeg',
    generated,
    upload: async (input) => { uploaded.push(input); return `https://media.ecfc.fans/${input.key}` },
  })
  assert.equal(uploaded[0]?.key, imageOriginalObjectPath(sourceObjectPath))
  assert.notEqual(result.originalObjectKey, result.sourceObjectKey)
  assert.deepEqual(uploaded[0]?.body, original)
  assert.equal(uploaded[0]?.contentType, 'image/jpeg')
  assert.equal(SALON_CATEGORIES.includes('TIME_TRAVEL'), true)
  assert.equal(supportsOriginal('CONCERT'), true)
  assert.equal(supportsOriginal('MOBILE_WALLPAPER'), true)
  assert.equal(supportsOriginal('DESKTOP_WALLPAPER'), true)
  assert.equal(supportsOriginal('TIME_TRAVEL'), true)
  assert.match(read('app/api/salon/posts/route.ts'), /for \(const \[index, image\] of inspected\.entries\(\)\)/)
  assert.match(read('app/api/salon/posts/route.ts'), /sortOrder: index/)
})

test('沙龙原图是否持久化严格跟随分类策略，展示版本仍单独生成 WebP', async () => {
  const original = Buffer.from('original-jpeg-bytes')
  const generated = { format: 'jpeg', source: Buffer.from('source-webp'), variants: { card: Buffer.from('card-webp') } }
  for (const category of SALON_CATEGORIES) {
    const uploaded: Array<{ key: string; body: Buffer; contentType: string }> = []
    const result = await uploadImageVariantFamily({
      sourceObjectPath: `salon/user-1/${category.toLowerCase()}/source.webp`,
      original,
      originalContentType: 'image/jpeg',
      preserveOriginal: supportsOriginal(category),
      generated,
      upload: async (input) => { uploaded.push(input); return `https://media.ecfc.fans/${input.key}` },
    })
    assert.equal(Boolean(result.originalObjectKey), supportsOriginal(category))
    assert.equal(Boolean(result.originalUrl), supportsOriginal(category))
    assert.equal(uploaded.some(({ key }) => key.endsWith('/original')), supportsOriginal(category))
    assert.equal(uploaded.some(({ key }) => key.endsWith('/source.webp')), true)
  }
})

test('任一 display 变体上传失败时会等待其余上传结束并清理已上传对象', async () => {
  const uploaded: string[] = []
  const removed: string[] = []
  await assert.rejects(() => uploadImageVariantFamily({
    sourceObjectPath: 'salon/user-1/post-2/1-upload/source.webp',
    original: Buffer.from('original'),
    originalContentType: 'image/jpeg',
    generated: { format: 'jpeg', source: Buffer.from('source'), variants: { card: Buffer.from('card'), large: Buffer.from('large') } },
    upload: async ({ key }) => {
      if (key.endsWith('/card.webp')) throw new Error('CARD_UPLOAD_FAILED')
      if (key.endsWith('/large.webp')) await new Promise((resolve) => setTimeout(resolve, 10))
      uploaded.push(key)
      return `https://media.ecfc.fans/${key}`
    },
    remove: async (key) => { removed.push(key) },
  }), /CARD_UPLOAD_FAILED/)
  assert.deepEqual(removed.sort(), uploaded.sort())
  assert.ok(removed.some((key) => key.endsWith('/large.webp')))
})

test('水印使用公开 UID 与昵称，支持八个位置、动态边距和透明度', () => {
  const text = createSalonWatermarkText(903, 'Andkdids')
  assert.match(text, /903/)
  assert.match(text, /Andkdids/)
  assert.doesNotMatch(text, /cmsu|cuid/i)
  for (const position of SALON_WATERMARK_POSITIONS) {
    const layout = calculateSalonWatermarkLayout(6000, 4000, { text, opacity: 50, position })
    assert.ok(layout.x >= layout.padding && layout.x <= layout.width - layout.padding)
    assert.ok(layout.y >= layout.padding && layout.y <= layout.height - layout.padding)
    assert.match(createSalonWatermarkSvg(6000, 4000, { text, opacity: 50, position }), new RegExp(`text-anchor="${layout.textAnchor}"`))
  }
  assert.notEqual(
    createSalonWatermarkSvg(1000, 1000, { text, opacity: 10, position: 'BOTTOM_RIGHT' }),
    createSalonWatermarkSvg(1000, 1000, { text, opacity: 100, position: 'BOTTOM_RIGHT' }),
  )
})

test('水印实际只写入 display WebP，输入原图 buffer 不变', async () => {
  const original = await sharp({ create: { width: 360, height: 240, channels: 3, background: { r: 36, g: 70, b: 90 } } }).jpeg({ quality: 90 }).toBuffer()
  const originalSnapshot = Buffer.from(original)
  const plain = await createImageVariants(original, { sourceMaxWidth: 360, variants: ['large'] })
  const watermarked = await createImageVariants(original, {
    sourceMaxWidth: 360,
    variants: ['large'],
    watermark: { text: createSalonWatermarkText(903, 'Andkdids'), opacity: 50, position: 'BOTTOM_RIGHT' },
  })
  assert.deepEqual(original, originalSnapshot)
  assert.notDeepEqual(watermarked.source, plain.source)
  assert.notDeepEqual(watermarked.variants.large, plain.variants.large)
  const metadata = await sharp(original).metadata()
  assert.equal(metadata.width, 360)
  assert.equal(metadata.height, 240)
})

test('沙龙全部分类复用公开基础条件且不隐式绑定演唱会分类', () => {
  const all = buildSalonFeedWhere()
  const allRecord = all as Record<string, unknown>
  assert.deepEqual(all, salonPublicBaseWhere)
  assert.equal(allRecord.category, undefined)
  assert.equal(all.status, 'APPROVED')
  assert.equal(allRecord.concert, undefined)
  assert.deepEqual(all.OR, salonPublicBaseWhere.OR)
  assert.equal(buildSalonFeedWhere({ category: 'CONCERT' }).category, 'CONCERT')
  assert.equal(buildSalonFeedWhere({ category: 'MOBILE_WALLPAPER' }).category, 'MOBILE_WALLPAPER')
  assert.equal(buildSalonFeedWhere({ category: 'DESKTOP_WALLPAPER' }).category, 'DESKTOP_WALLPAPER')
  assert.equal(buildSalonFeedWhere({ category: 'TIME_TRAVEL' }).category, 'TIME_TRAVEL')
  assert.equal(buildSalonFeedWhere({ category: 'TIME_TRAVEL' }).concert, undefined)
})

test('时光倒流二十年是独立的可审核分类并沿用统一详情/分享路径', () => {
  assert.equal(SALON_CATEGORIES.at(-1), 'TIME_TRAVEL')
  assert.match(read('components/salon/SalonHome.tsx'), /时光倒流二十年/)
  assert.match(read('components/salon/SalonUploadForm.tsx'), /requiresConcert = category === 'CONCERT'/)
  assert.match(read('components/salon/SalonUploadForm.tsx'), /if \(requiresConcert\) body\.set\('concertId'/)
  assert.match(read('components/salon/SalonDetail.tsx'), /\/salon\//)
  assert.match(read('lib/share-card-service.ts'), /SALON_CATEGORY_LABELS\[post\.category\]/)
})

test('沙龙详情使用统一分享系统、display 首图与独立浏览量接口', () => {
  assert.equal(shareCardApiPath({ type: 'salon', contentId: 'salon-1' }), '/api/salon/posts/salon-1/share-card')
  const detail = read('components/salon/SalonDetail.tsx')
  const shareService = read('lib/share-card-service.ts')
  const viewRoute = read('app/api/salon/posts/[postId]/view/route.ts')
  const downloadRoute = read('app/api/salon/media/[mediaId]/original/route.ts')
  assert.match(detail, /<ShareButton data=\{shareCardData\} label="分享"/)
  assert.match(detail, /src=\{activeMedia\.previewUrl\}/)
  assert.match(detail, /SalonViewCounter postId=\{post\.id\}/)
  assert.match(shareService, /type: 'salon'/)
  assert.match(viewRoute, /updateMany\(\{ where: visibleSalonWhere, data: \{ viewCount: \{ increment: 1 \} \} \}\)/)
  assert.match(downloadRoute, /findUnique\(\{/)
  assert.match(downloadRoute, /getCosObject\(objectKey\)/)
  assert.match(downloadRoute, /if \(!supportsOriginal\(media\.post\.category\)\)/)
  assert.doesNotMatch(downloadRoute, /searchParams\.get\(['"]url['"]\)/)
  assert.match(detail, /originalUrl: null/)
  assert.match(detail, /downloadUrl: supportsOriginal\(post\.category\) && media\.originalAvailable \? .*mode=download/)
  assert.match(read('app/api/admin/salon/route.ts'), /originalAvailable/)
  assert.doesNotMatch(downloadRoute, /imageOriginalObjectPath/)
})

test('沙龙列表卡片把点赞留在左侧，浏览量和评论固定在右侧且按浏览量在前', () => {
  const home = read('components/salon/SalonHome.tsx')
  const statsCss = read('app/globals.css')
  assert.match(home, /salon-gallery-stats-row[\s\S]*SalonLikeButton[\s\S]*salon-card-stats[\s\S]*salon-view-stat[\s\S]*评论/)
  assert.match(statsCss, /\.salon-gallery-stats-row \{[\s\S]*justify-content: space-between/)
  assert.match(home, /<span className="salon-view-stat">[\s\S]*<span>\{post\.viewCount \|\| 0\}<\/span><\/span><span>评论/)
})

test('没有显式原图对象键的历史媒体不会把展示 source 路径当作原图', () => {
  const feed = read('lib/salon.ts')
  const downloadRoute = read('app/api/salon/media/[mediaId]/original/route.ts')
  assert.doesNotMatch(feed, /imageOriginalObjectPath\(media\.storageKey\)/)
  assert.doesNotMatch(downloadRoute, /imageOriginalObjectPath\(storageKey\)/)
  assert.match(feed, /return media\.originalObjectKey\?\.trim\(\) \|\| null/)
})

test('沙龙 Schema 只增加最小浏览量、原图元数据和水印字段，迁移不含破坏性语句', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260830200000_add_salon_media_watermark_views/migration.sql')
  assert.match(schema, /model SalonPost \{[\s\S]*?viewCount\s+Int\s+@default\(0\)/)
  assert.match(schema, /model SalonPostMedia \{[\s\S]*?originalObjectKey\s+String\?/)
  assert.match(schema, /watermarkEnabled\s+Boolean\s+@default\(false\)/)
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i)
  assert.match(migration, /ADD COLUMN `viewCount`/)
})
