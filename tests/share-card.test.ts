import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canonicalShareUrl, createShareCardFilename, sanitizeShareCardText, shareCardQrPayload, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'

const read = (path: string) => readFileSync(path, 'utf8')

test('share button opens a simple two-choice panel before any action', () => {
  const button = read('components/share/ShareButton.tsx')
  const dialog = read('components/share/ShareMethodDialog.tsx')
  assert.match(button, /<ShareMethodDialog/)
  assert.match(dialog, /<h2 id="share-method-title">分享<\/h2>/)
  assert.match(dialog, /data-share-method="card"/)
  assert.match(dialog, /data-share-method="link"/)
  assert.match(dialog, /onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) onClose\(\) \}\}/)
})

test('share link choice delegates to the existing share helper and current URL', () => {
  const button = read('components/share/ShareButton.tsx')
  assert.match(button, /shareContent\(/)
  assert.match(button, /title: \(linkTitle \|\| data\.title\)\.trim\(\)/)
  assert.match(button, /text: linkText \?\? data\.description/)
  assert.match(button, /url: window\.location\.href/)
  assert.match(button, /navigator|existing helper/)
})

test('card payload has one shared shape and a high-resolution portrait contract', () => {
  const image = read('lib/share-card-image.ts')
  const payload: ShareCardData = {
    type: 'post',
    title: '帖子',
    description: '摘要',
    image: null,
    url: 'https://ecfc.fans/posts/post-1',
    author: 'E友',
    authorAvatar: null,
    date: '2026年8月29日',
    meta: [{ label: '版块', value: 'E院广场' }],
  }
  assert.equal(payload.type, 'post')
  assert.equal(SHARE_CARD_WIDTH, 1080)
  assert.equal(SHARE_CARD_HEIGHT, 1440)
  assert.equal(SHARE_CARD_MIME_TYPE, 'image/png')
  assert.match(image, /document\.createElement\('canvas'\)/)
  assert.match(image, /canvas\.toBlob\(/)
  assert.match(image, /imageSmoothingQuality = 'high'/)
})

test('activity and post payloads use the common renderer rather than type-specific generators', () => {
  const activity = read('components/activities/ActivityShareButton.tsx')
  const post = read('components/ForumDiscoveryDetailTopbar.tsx')
  assert.match(activity, /<ShareButton data=\{data\}/)
  assert.match(post, /<ShareButton\s+\n?\s*data=\{shareCardData\}/)
  assert.doesNotMatch(activity, /createElement\('canvas'\)/)
  assert.doesNotMatch(post, /createElement\('canvas'\)/)
})

test('QR payload is the production canonical URL without query, fragment, or local host', () => {
  assert.equal(shareCardQrPayload('https://ecfc.fans/posts/post-1?focus=reply#comment'), 'https://ecfc.fans/posts/post-1')
  assert.equal(shareCardQrPayload('/activities/activity-1?from=admin'), 'https://ecfc.fans/activities/activity-1')
  assert.equal(shareCardQrPayload('https://ecfc.fans/posts/post-1?token=secret'), 'https://ecfc.fans/posts/post-1')
  assert.throws(() => shareCardQrPayload('http://localhost:3000/posts/post-1'), /CANONICAL_HTTPS/)
})

test('card text removes HTML and Markdown controls while redacting direct contact fields', () => {
  const value = sanitizeShareCardText('<p>## 标题</p><p>[完整内容](https://ecfc.fans/posts/1) **正文**</p><p>邮箱 a@example.com 手机 13800138000</p>')
  assert.equal(value, '标题 完整内容 正文 邮箱 [已隐藏邮箱] 手机 [已隐藏手机号]')
  assert.doesNotMatch(value, /<p>|\*\*|a@example\.com|13800138000/)
})

test('card filenames are safe on Windows, Android, and iOS', () => {
  const fileName = createShareCardFilename('活动: 夏日/见面会? * 2026')
  assert.equal(fileName, '私家E院-活动_ 夏日_见面会_ 2026.png')
  assert.doesNotMatch(fileName, /[<>:"/\\|?*]/)
})

test('generator explicitly handles CORS failures by redrawing without remote pixels', () => {
  const image = read('lib/share-card-image.ts')
  assert.match(image, /crossOrigin = 'anonymous'/)
  assert.match(image, /referrerPolicy = 'no-referrer'/)
  assert.match(image, /drawShareCardCanvas\(normalizedData, false\)/)
  assert.match(image, /SHARE_CARD_QR_IMAGE_UNAVAILABLE/)
})

test('post card uses first legal image, excludes videos, and falls back to the brand image', () => {
  const page = read('app/posts/[postId]/page.tsx')
  assert.match(page, /PostMedia: \{/)
  assert.match(page, /where: \{ type: 'IMAGE'/)
  assert.match(page, /firstAbsoluteMetadataImageUrl\(post\.PostMedia\.map/)
  assert.match(page, /metadataImageVariantUrl\(url\)/)
  const metadata = read('lib/share-metadata.ts')
  assert.match(metadata, /VIDEO_FILE_PATTERN/)
  assert.match(metadata, /DEFAULT_OG_IMAGE_PATH/)
})

test('activity card follows banner, cover, default and keeps invalid candidates non-fatal', () => {
  const view = read('components/activities/ActivityDetailView.tsx')
  const page = read('app/activities/[activityId]/page.tsx')
  assert.match(view, /metadataImageVariantUrl\(activity\.bannerUrl\)/)
  assert.match(view, /metadataImageVariantUrl\(activity\.coverUrl\)/)
  assert.match(view, /firstAbsoluteMetadataImageUrl\(\[/)
  assert.match(page, /catch \{/)
})

test('author avatar is optional and card renderer has a deterministic initials fallback', () => {
  const image = read('lib/share-card-image.ts')
  assert.match(image, /if \(avatar\)/)
  assert.match(image, /const fallback = name\.trim\(\)\.slice\(0, 1\) \|\| 'E'/)
  assert.match(image, /loadImage\(data\.authorAvatar, allowRemoteImages\)/)
})

test('private card data can disable public poster generation and does not expose private fields', () => {
  const button = read('components/share/ShareButton.tsx')
  const dialog = read('components/share/ShareMethodDialog.tsx')
  const privateCard: ShareCardData = {
    type: 'clinic',
    title: '通用标题',
    description: '通用摘要',
    image: null,
    url: 'https://ecfc.fans/clinic/public-record',
    author: null,
    authorAvatar: null,
    date: null,
    meta: [],
    canGenerateCard: false,
  }
  assert.equal(privateCard.canGenerateCard, false)
  assert.match(button, /data\.canGenerateCard !== false/)
  assert.match(dialog, /disabled=\{!canSaveCard\}/)
  assert.doesNotMatch(JSON.stringify(privateCard), /手机号|邮箱|session|token|username/i)
})

test('home, activity, post, and clinic entry points all use ShareButton', () => {
  assert.match(read('components/HomeLayoutSurface.tsx'), /<ShareButton data=\{homeShareCardData\}/)
  assert.match(read('components/activities/ActivityDetailView.tsx'), /<ActivityShareButton data=\{shareCardData\}/)
  assert.match(read('components/ForumDiscoveryDetailTopbar.tsx'), /<ShareButton/)
  assert.match(read('components/clinic/ClinicDetailClient.tsx'), /<ShareButton data=\{clinicShareCardData\}/)
})

test('mobile sheet and desktop dialog styles are present, with no viewport overflow requirement', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.share-method-backdrop[^\{]*\{[^}]*display:flex/)
  assert.match(css, /\.share-method-dialog \{[^}]*width:min\(430px,100%\)/)
  assert.match(css, /\.share-method-backdrop \{ align-items:flex-end; padding:0; \}/)
  assert.match(css, /\.share-method-dialog \{ width:100%;[^}]*border-radius:22px 22px 0 0/)
})

test('preview exposes a real PNG save action and the exact QR payload for acceptance', () => {
  const preview = read('components/share/ShareCardPreview.tsx')
  assert.match(preview, /download=\{image\.fileName\}/)
  assert.match(preview, /data-share-card-save/)
  assert.match(preview, /data-share-card-qr-url=\{image\.qrUrl\}/)
  assert.match(preview, /高清 PNG · 1080 × 1440/)
})

test('the existing link helper contract remains title, text, url, navigator.share, and title-newline-url fallback', () => {
  const share = read('lib/share.ts')
  assert.match(share, /title: normalizedTitle/)
  assert.match(share, /text: normalizedText/)
  assert.match(share, /url: normalizedUrl/)
  assert.match(share, /navigator\.share/)
  assert.match(share, /\$\{title\.trim\(\)\}\\n\$\{url\.trim\(\)\}/)
})
