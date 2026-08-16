import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import test from 'node:test'
import {
  buildMyLivePhotoWatermarkSvg,
  escapeXml,
  MY_LIVE_PHOTO_MAX_EDGE,
  MY_LIVE_PHOTO_MAX_FILE_SIZE,
  MY_LIVE_PHOTO_MAX_INPUT_PIXELS,
  MY_LIVE_PHOTO_WEBP_QUALITY,
  parseMyLivePhotoWatermark,
  processMyLivePhoto,
} from '../lib/my-live-photos'
import { MY_LIVE_PHOTO_LIMITS } from '../lib/my-live-photo-types'

const read = (path: string) => readFileSync(path, 'utf8')

async function makeImage(format: 'jpeg' | 'png', width = 600, height = 400, orientation?: number) {
  let image = sharp({ create: { width, height, channels: 3, background: { r: 35, g: 75, b: 120 } } })
  image = format === 'jpeg' ? image.jpeg() : image.png()
  return orientation ? image.withMetadata({ orientation }).toBuffer() : image.toBuffer()
}

test('照片模型绑定 attendanceId 并固定两类和排序字段', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model MyLivePhoto[\s\S]*attendanceId\s+String/)
  assert.match(schema, /model MyLivePhoto[\s\S]*category\s+MyLivePhotoCategory/)
  assert.match(schema, /enum MyLivePhotoCategory[\s\S]*TICKET[\s\S]*LIVE/)
  assert.match(schema, /@@index\(\[attendanceId, category, sortOrder, createdAt, id\]\)/)
})

test('migration只新增照片表和外键，不执行破坏性删除', () => {
  const sql = read('prisma/migrations/20260815153000_add_my_live_photos/migration.sql')
  assert.match(sql, /CREATE TABLE `MyLivePhoto`/)
  assert.match(sql, /`attendanceId` VARCHAR\(191\) NOT NULL/)
  assert.match(sql, /ON DELETE CASCADE/)
  assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b|DELETE FROM/i)
})

test('详情页按两个独立分类渲染并保留票根2张、现场6张、总计8张上限', () => {
  assert.deepEqual(MY_LIVE_PHOTO_LIMITS, { TICKET: 2, LIVE: 6, TOTAL: 8 })
  const panel = read('components/music/live/MyLivePhotoPanel.tsx')
  assert.match(panel, /PHOTO_CATEGORIES[^\n]*TICKET[^\n]*LIVE/)
  assert.match(panel, /categoryLimit\(category\)/)
  assert.match(panel, /添加票根/)
  assert.match(panel, /添加现场照片/)
  assert.match(read('lib/my-live-photos.ts'), /categoryCount \+ uploaded\.length > categoryLimit/)
  assert.match(read('lib/my-live-photos.ts'), /totalCount \+ uploaded\.length > MY_LIVE_PHOTO_LIMITS\.TOTAL/)
})

test('上传和读接口要求登录，且上传只通过当前用户的 attendanceId', () => {
  const route = read('app/api/music/live/attendance/[attendanceId]/photos/route.ts')
  assert.match(route, /export async function POST[\s\S]*requireUser\(\)/)
  assert.match(route, /getOwnMyLivePhotos\(guard\.user\.id, attendanceId\)/)
  assert.match(route, /uploadMyLivePhotos\(\{ userId: guard\.user\.id, attendanceId/)
  assert.match(read('lib/my-live-photos.ts'), /WHERE id = \$\{attendanceId\} AND userId = \$\{userId\}/)
})

test('删除和排序都会校验当前用户归属，不能操作其他用户照片', () => {
  const route = read('app/api/music/live/attendance/[attendanceId]/photos/[photoId]/route.ts')
  const service = read('lib/my-live-photos.ts')
  assert.match(route, /requireUser\(\)/)
  assert.match(service, /photo\.userId !== userId \|\| photo\.attendanceId !== attendanceId/)
  assert.match(service, /delete\(\{ where: \{ id: photo\.id \} \}\)/)
  assert.match(service, /reorderOwnMyLivePhotos[\s\S]*lockAttendance/)
})

test('MySQL事务中的attendance行锁使并发计数后创建不会超限', () => {
  const service = read('lib/my-live-photos.ts')
  assert.match(service, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(service, /FOR UPDATE/)
  assert.match(service, /tx\.myLivePhoto\.count\(\{ where: \{ attendanceId:/)
  assert.match(service, /tx\.myLivePhoto\.create\(/)
  assert.match(service, /deleteFromCos\(storageKey\)/)
})

test('客户端不能提交或决定水印用户名和UID', () => {
  const route = read('app/api/music/live/attendance/[attendanceId]/photos/route.ts')
  const panel = read('components/music/live/MyLivePhotoPanel.tsx')
  assert.match(route, /getMyLiveWatermarkIdentity\(guard\.user\.id\)/)
  assert.match(read('lib/my-live-photos.ts'), /select: \{ username: true, uid: true \}/)
  assert.match(read('lib/my-live-photos.ts'), /username: identity\.username, uid: identity\.uid/)
  assert.doesNotMatch(route, /form\.get\(['"]username|form\.get\(['"]uid/)
  assert.doesNotMatch(panel, /form\.append\(['"]username|form\.append\(['"]uid/)
})

test('watermark默认关闭且客户端上传按钮会在上传中禁用', () => {
  assert.equal(parseMyLivePhotoWatermark(undefined), false)
  assert.equal(parseMyLivePhotoWatermark('false'), false)
  assert.equal(parseMyLivePhotoWatermark('true'), true)
  const panel = read('components/music/live/MyLivePhotoPanel.tsx')
  assert.match(panel, /useState\(false\)/)
  assert.match(panel, /disabled=\{busy\}/)
  assert.match(panel, /上传中…/)
})

test('JPG和PNG最终都输出WebP并保留比例', async () => {
  const jpeg = await processMyLivePhoto(await makeImage('jpeg', 800, 400), 'image/jpeg', false)
  const png = await processMyLivePhoto(await makeImage('png', 400, 800), 'image/png', false)
  assert.equal((await sharp(jpeg.buffer).metadata()).format, 'webp')
  assert.equal((await sharp(png.buffer).metadata()).format, 'webp')
  assert.deepEqual([jpeg.width, jpeg.height], [800, 400])
  assert.deepEqual([png.width, png.height], [400, 800])
  assert.equal(jpeg.watermarked, false)
})

test('EXIF Orientation在缩放前由rotate修正，最长边受限', async () => {
  const oriented = await processMyLivePhoto(await makeImage('jpeg', 300, 500, 6), 'image/jpeg', false)
  assert.deepEqual([oriented.width, oriented.height], [500, 300])
  const large = await processMyLivePhoto(await makeImage('jpeg', 3000, 1200), 'image/jpeg', false)
  assert.ok(Math.max(large.width, large.height) <= MY_LIVE_PHOTO_MAX_EDGE)
})

test('真实格式和Sharp解码共同校验，伪造MIME、非法图片和动图不会绕过', async () => {
  const png = await makeImage('png')
  await assert.rejects(() => processMyLivePhoto(png, 'image/jpeg', false), /MIME|真实格式/)
  await assert.rejects(() => processMyLivePhoto(Buffer.from('not-an-image'), 'image/jpeg', false), /解析|有效图片/)
  const service = read('lib/my-live-photos.ts')
  assert.match(service, /isAnimatedImageInput\(input, metadata\)/)
  assert.match(service, /MY_LIVE_PHOTO_MAX_INPUT_PIXELS/)
})

test('水印false不改图，true写入最终WebP像素并动态计算字号', async () => {
  const input = await makeImage('jpeg', 600, 400)
  const plain = await processMyLivePhoto(input, 'image/jpeg', false)
  const marked = await processMyLivePhoto(input, 'image/jpeg', true, { username: '小鹿', uid: 72727 })
  assert.equal((await sharp(marked.buffer).metadata()).format, 'webp')
  assert.notDeepEqual(marked.buffer, plain.buffer)
  assert.equal(marked.watermarked, true)
  const overlay = buildMyLivePhotoWatermarkSvg({ username: '小鹿', uid: 72727, width: marked.width, height: marked.height })
  assert.match(overlay.text, /小鹿  UID:72727/)
  assert.ok(overlay.fontSize > 0)
})

test('水印支持中文英文特殊字符、完整UID和长用户名收缩', () => {
  const username = `陈奕迅&EF<hello>"test"'emoji😀`
  assert.equal(escapeXml(username), '陈奕迅&amp;EF&lt;hello&gt;&quot;test&quot;&apos;emoji😀')
  const overlay = buildMyLivePhotoWatermarkSvg({ username, uid: 72727, width: 900, height: 600 })
  assert.match(overlay.svg, /&amp;EF&lt;hello&gt;&quot;test&quot;&apos;/)
  assert.doesNotMatch(overlay.svg, /<hello>/)
  const long = buildMyLivePhotoWatermarkSvg({ username: '特别特别特别特别特别特别特别特别特别特别长的用户名', uid: 72727, width: 500, height: 500 })
  assert.match(long.text, /UID:72727/)
  assert.ok(long.left >= 0 && long.left + long.width <= 500)
  assert.ok(long.top >= 0 && long.top + long.height <= 500)
})

test('水印字体使用服务器字体回退而不是前端CSS overlay或提交大字体', () => {
  const service = read('lib/my-live-photos.ts')
  assert.match(service, /font-family="Arial, Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif"/)
  assert.match(service, /composite\(\[\{ input: Buffer\.from\(overlay\.svg\)/)
  assert.doesNotMatch(service, /watermarkUsername|watermarkUid/)
})

test('公开接口继承isPublic并且不返回storageKey，照片和记录一次查询取得', () => {
  const api = read('app/api/music/live/users/[uid]/route.ts')
  const page = read('app/user/[uid]/live/page.tsx')
  assert.match(api, /isPublic: true/)
  assert.match(api, /MyLivePhoto: \{ orderBy: myLivePhotoOrderBy, select: myLivePhotoSelect \}/)
  assert.match(api, /photos: serializeMyLivePhotos\(record\.MyLivePhoto\)/)
  assert.doesNotMatch(api, /storageKey/)
  assert.match(page, /MyLivePhotoPanel photos=\{serializeMyLivePhotos\(record\.MyLivePhoto\)\}/)
})

test('隐藏记录不会把图片地址发到公共响应，自己的接口仍可管理', () => {
  const publicApi = read('app/api/music/live/users/[uid]/route.ts')
  const ownApi = read('app/api/music/live/attendance/[attendanceId]/photos/route.ts')
  assert.match(publicApi, /UserMusicConcert:[\s\S]*where:[\s\S]*isPublic: true/)
  assert.match(ownApi, /getOwnMyLivePhotos\(guard\.user\.id, attendanceId\)/)
  assert.doesNotMatch(read('lib/music-personal-live.ts'), /MyLivePhoto|serializeMyLivePhotos/)
})

test('My Live 列表不读取或渲染完整照片，场次详情才读取当前用户照片', () => {
  const dashboard = read('components/music/live/MyLiveDashboard.tsx')
  const overview = read('lib/music-personal-live.ts')
  const pagedApi = read('app/api/music/live/me/concerts/route.ts')
  const detail = read('app/music/live/tours/[tourId]/[city]/[date]/page.tsx')
  assert.doesNotMatch(dashboard, /MyLivePhotoPanel|MyLivePhoto|photos/)
  assert.doesNotMatch(overview, /MyLivePhoto|serializeMyLivePhotos/)
  assert.doesNotMatch(pagedApi, /MyLivePhoto|serializeMyLivePhotos/)
  assert.match(detail, /MyLivePhoto: \{[\s\S]*myLivePhotoOrderBy[\s\S]*myLivePhotoSelect/)
  assert.match(detail, /MyLivePhotoPanel attendanceId=\{attendance\.id\}/)
})

test('删除后按类别重排，TICKET和LIVE排序彼此独立', () => {
  const service = read('lib/my-live-photos.ts')
  assert.match(service, /where: \{ attendanceId, category: photo\.category \}/)
  assert.match(service, /sortOrder: index/)
  assert.match(service, /category: photo\.category/)
  assert.match(read('components/music/live/MyLivePhotoPanel.tsx'), /前移/)
  assert.match(read('components/music/live/MyLivePhotoPanel.tsx'), /后移/)
})

test('详情照片使用独立Section、响应式网格和现有图片预览', () => {
  const panel = read('components/music/live/MyLivePhotoPanel.tsx')
  const css = read('app/globals.css')
  assert.match(panel, /<ImageViewer/)
  assert.match(panel, /my-live-photo-section-title/)
  assert.match(panel, /my-live-photo-divider/)
  assert.match(panel, /my-live-photo-grid/)
  assert.match(panel, /还没有上传票根/)
  assert.match(panel, /还没有上传现场照片/)
  assert.match(css, /\.my-live-photo-grid[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)/)
  assert.match(css, /@media \(min-width:480px\)[\s\S]*\.my-live-photo-grid[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)/)
  assert.doesNotMatch(panel, /my-live-photo-category-tabs|票根 \$\{|现场 \$\{|添加照片/)
})

test('旧的无照片记录使用空数组并保持现有My Live统计逻辑', () => {
  const service = read('lib/music-personal-live.ts')
  const panel = read('components/music/live/MyLivePhotoPanel.tsx')
  assert.doesNotMatch(service, /MyLivePhoto|serializeMyLivePhotos/)
  assert.match(read('components/music/live/MyLiveDashboard.tsx'), /还没有记录看过的演唱会/)
  assert.match(panel, /还没有上传票根/)
  assert.match(panel, /还没有上传现场照片/)
})

test('图片上传参数和输出标准固定，避免客户端预处理绕过服务端', () => {
  const service = read('lib/my-live-photos.ts')
  const route = read('app/api/music/live/attendance/[attendanceId]/photos/route.ts')
  assert.equal(MY_LIVE_PHOTO_MAX_FILE_SIZE, 12 * 1024 * 1024)
  assert.equal(MY_LIVE_PHOTO_MAX_INPUT_PIXELS, 40_000_000)
  assert.equal(MY_LIVE_PHOTO_MAX_EDGE, 2400)
  assert.equal(MY_LIVE_PHOTO_WEBP_QUALITY, 82)
  assert.match(service, /uploadSiteImage\(\{ key: storageKey, body: processed\.buffer, contentType: 'image\/webp' \}\)/)
  assert.match(route, /processMyLivePhoto\(buffer, file\.type\.trim\(\)\.toLowerCase\(\)/)
})
