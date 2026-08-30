import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createShareCardFilename, sanitizeShareCardText, shareCardQrPayload, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { calculateShareCardLayout, SHARE_CARD_FOOTER_BOTTOM_PADDING, SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT, SHARE_CARD_FOOTER_TEXT_X, SHARE_CARD_FOOTER_TEXT_WIDTH, SHARE_CARD_QR_FRAME_X, SHARE_CARD_QR_FRAME_SIZE } from '@/lib/share-card-layout'
import { SHARE_CARD_TEMPLATE_VERSION } from '@/lib/share-card-hash'

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
  assert.equal(SHARE_CARD_HEIGHT, 1160)
  assert.equal(SHARE_CARD_MIME_TYPE, 'image/png')
  assert.match(image, /document\.createElement\('canvas'\)/)
  assert.match(image, /canvas\.toBlob\(/)
  assert.match(image, /imageSmoothingQuality = 'high'/)
})

test('share card flow layout keeps all copy, compacts short cards, and grows for long content', () => {
  const shortData: ShareCardData = {
    type: 'post',
    title: '短标题',
    description: '第一段\n\n第二段\n第三段',
    image: null,
    url: 'https://ecfc.fans/posts/short-layout',
    author: 'E友',
    authorAvatar: null,
    date: '2026年8月30日',
    meta: [{ label: '版块', value: 'E院广场' }],
  }
  const longData = { ...shortData, description: '长正文'.repeat(300) }
  const compactLayout = calculateShareCardLayout({ ...shortData, description: '短正文', meta: [] })
  const shortLayout = calculateShareCardLayout(shortData)
  const longLayout = calculateShareCardLayout(longData)
  assert.equal(shortLayout.width, SHARE_CARD_WIDTH)
  assert.ok(shortLayout.height >= SHARE_CARD_HEIGHT)
  assert.ok(compactLayout.height < 1440)
  assert.equal(compactLayout.height, compactLayout.footerBottom)
  assert.ok(longLayout.height > shortLayout.height)
  assert.equal(shortLayout.descriptionLines.join('\n'), '第一段\n\n第二段\n第三段')
  assert.ok(shortLayout.authorTop >= shortLayout.panelBottom + 36)
  assert.equal(shortLayout.qrTop, shortLayout.brandBlockTop)
  assert.equal(shortLayout.brandLogoTop + SHARE_CARD_FOOTER_LOGO_SIZE / 2, shortLayout.brandTextTop + SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT / 2)
  assert.equal(shortLayout.footerBottom - Math.max(shortLayout.brandBlockTop + shortLayout.brandBlockHeight, shortLayout.qrTop + SHARE_CARD_QR_FRAME_SIZE), SHARE_CARD_FOOTER_BOTTOM_PADDING)
  assert.ok(SHARE_CARD_FOOTER_TEXT_X + SHARE_CARD_FOOTER_TEXT_WIDTH < SHARE_CARD_QR_FRAME_X)
  assert.match(read('lib/share-card-layout.ts'), /measureWrappedText/)
  assert.doesNotMatch(read('lib/share-card-renderer.ts'), /maxLines|DESCRIPTION_CHARS_PER_LINE|\.slice\(0, maxLength\)/)
  assert.doesNotMatch(read('lib/share-card-image.ts'), /maxLines|\.slice\(0, maxLines\)/)
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

test('post card uses first legal image, excludes videos, and lets the renderer provide the no-image background', () => {
  const page = read('app/posts/[postId]/page.tsx')
  assert.match(page, /PostMedia: \{/)
  assert.match(page, /where: \{ type: 'IMAGE'/)
  assert.match(page, /firstShareCardImageUrl\(post\.PostMedia\.map/)
  assert.match(page, /firstAbsoluteMetadataImageUrl\(post\.PostMedia\.map/)
  assert.match(page, /metadataImageVariantUrl\(url\)/)
  const metadata = read('lib/share-metadata.ts')
  assert.match(metadata, /VIDEO_FILE_PATTERN/)
  assert.match(metadata, /DEFAULT_OG_IMAGE_PATH/)
  assert.match(metadata, /export function firstShareCardImageUrl/)
})

test('activity card follows banner, cover, default and keeps invalid candidates non-fatal', () => {
  const view = read('components/activities/ActivityDetailView.tsx')
  const page = read('app/activities/[activityId]/page.tsx')
  assert.match(view, /metadataImageVariantUrl\(activity\.bannerUrl\)/)
  assert.match(view, /metadataImageVariantUrl\(activity\.coverUrl\)/)
  assert.match(view, /firstShareCardImageUrl\(\[/)
  assert.match(page, /catch \{/)
})

test('server-backed card requests use only a content id, keep HTTPS as the normal source, and use data URL only for fallback', () => {
  const button = read('components/share/ShareButton.tsx')
  const routes = `${read('app/api/posts/[postId]/share-card/route.ts')}\n${read('app/api/activities/[activityId]/share-card/route.ts')}`
  assert.match(button, /shareCardApiPath\(data\)/)
  assert.match(button, /method: 'GET'/)
  assert.match(button, /source: 'remote'/)
  assert.match(button, /if \(!image\) image = await generateShareCardImage\(data\)/)
  assert.match(button, /previewSrc: result\.url/)
  assert.match(routes, /export async function GET/)
  assert.doesNotMatch(routes, /request\.json\(\)/)
  assert.match(button, /isTrustedShareCardHttpsUrl\(result\.url\)/)
})

test('both client and server card renderers use the official app icon in the footer brand area', () => {
  const client = read('lib/share-card-image.ts')
  const server = read('lib/share-card-renderer.ts')
  const layout = read('lib/share-card-layout.ts')
  assert.match(client, /loadLocalImage\(SHARE_CARD_LOGO_PATH\)/)
  assert.match(client, /drawImageContain\(context, logo, SHARE_CARD_FOOTER_LOGO_X, layout\.brandLogoTop, SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_LOGO_SIZE, 4\)/)
  assert.doesNotMatch(client, /drawImageContain\(context, logo, 56, 38, 128, 128, 4\)/)
  assert.match(server, /OFFICIAL_LOGO_PATH = path\.join\(process\.cwd\(\), 'app', 'icon\.png'\)/)
  assert.match(server, /fitImage\(logo, SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_LOGO_SIZE, 'contain'\)/)
  assert.match(server, /left: SHARE_CARD_FOOTER_LOGO_X, top: layout\.brandLogoTop/)
  assert.match(layout, /brandBlockTop/)
  assert.match(layout, /brandBlockHeight/)
  assert.match(layout, /brandLogoTop = brandBlockTop \+ \(brandBlockHeight - SHARE_CARD_FOOTER_LOGO_SIZE\) \/ 2/)
  assert.match(layout, /brandTextTop = brandBlockTop \+ \(brandBlockHeight - SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT\) \/ 2/)
  assert.doesNotMatch(server, /fitImage\(logo, 128, 128, 'contain'\)/)
  assert.doesNotMatch(client, /fillText\('私家E院', 64, 92\)/)
  assert.doesNotMatch(client, /fillText\(shareCardTypeLabel\(data\.type\), 66, 130\)/)
  assert.doesNotMatch(server, /fillText\(/)
})

test('home CTA is independent from the share action and has no implicit share fallback', () => {
  const hero = read('components/HomeHero.tsx')
  const home = read('components/HomeLayoutSurface.tsx')
  assert.match(hero, /resolveHomeHeroCopy/)
  assert.match(hero, /showButton: Boolean\(active\)[\s\S]*Boolean\(buttonText\)[\s\S]*Boolean\(buttonHref\)/)
  assert.doesNotMatch(hero, /defaultHeroButton|shareAction|label="分享"/)
  assert.match(home, /<HomeHero[\s\S]*defaultTitle=\{siteConfig\.text\.homeSubtitle\}[\s\S]*\/>/)
  assert.doesNotMatch(home.slice(home.indexOf('<HomeHero'), home.indexOf('<div className="community-home-share-action"')), /ShareButton|shareAction/)
  assert.match(home, /community-home-share-action[\s\S]*<ShareButton data=\{homeShareCardData\}/)
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
  assert.match(preview, /data-share-card-source=\{image\.source\}/)
  assert.doesNotMatch(preview, /高清 PNG · 1080px 宽/)
  assert.doesNotMatch(preview, /share-card-preview-eyebrow/)
})

test('V5 uses a fixed cover Hero for post/activity media and leaves the fallback to missing media', () => {
  const layout = read('lib/share-card-layout.ts')
  const server = read('lib/share-card-renderer.ts')
  const client = read('lib/share-card-image.ts')
  const service = read('lib/share-card-service.ts')
  assert.equal(SHARE_CARD_TEMPLATE_VERSION, 'v5')
  assert.match(layout, /export function shareCardHeroFit[\s\S]*type === 'home' \? 'contain' : 'cover'/)
  assert.match(server, /fitImage\(hero, SHARE_CARD_WIDTH, SHARE_CARD_HERO_HEIGHT, shareCardHeroFit\(normalizedData\.type\)\)/)
  assert.match(client, /shareCardHeroFit\(data\.type\)/)
  assert.match(service, /firstShareCardImageUrl\(/)
  assert.match(server, /if \(hero\)/)
  assert.match(server, /heroLayer = await fitImage\(hero, SHARE_CARD_WIDTH, SHARE_CARD_HERO_HEIGHT, shareCardHeroFit\(normalizedData\.type\)\)/)
})

test('mobile preview uses the generated PNG img directly and renders no action footer', () => {
  const preview = read('components/share/ShareCardPreview.tsx')
  const button = read('components/share/ShareButton.tsx')
  const css = read('app/globals.css')
  assert.match(preview, /useIsDesktopMediaQuery\(\)/)
  assert.match(preview, /长按分享卡片，可保存图片或转发给好友/)
  assert.match(preview, /点击保存图片下载 PNG/)
  assert.match(preview, /\{isDesktop \? \(/)
  assert.doesNotMatch(preview, /完成/)
  assert.match(preview, /<img src=\{image\.previewSrc\} width=\{image\.width\} height=\{image\.height\}/)
  assert.match(preview, /data-allow-native-image-drag="true"/)
  assert.doesNotMatch(preview, /<img[^>]+(?:onContextMenu|onTouchStart|preventDefault\(\))/)
  assert.doesNotMatch(button, /previewSrcIsObjectUrl|URL\.revokeObjectURL/)
  assert.match(css, /\.share-card-preview-image \{[^}]*-webkit-touch-callout:default;[^}]*-webkit-user-drag:auto;[^}]*user-select:auto;[^}]*touch-action:auto;/)
  assert.match(css, /\.share-card-preview-image \{[^}]*width:min\(100%,540px\); height:auto;/)
  assert.doesNotMatch(css, /\.share-card-preview-image \{[^}]*max-height/)
  assert.match(css, /\.share-card-preview-image-wrap \{[^}]*overflow:auto;/)
})

test('final card preview is a portable PNG data URL and does not depend on object URL lifetime', () => {
  const image = read('lib/share-card-image.ts')
  assert.match(image, /reader\.readAsDataURL\(blob\)/)
  assert.match(image, /data:\$\{SHARE_CARD_MIME_TYPE\};base64,/)
  assert.match(image, /previewSrc = await blobToDataUrl\(blob\)/)
  assert.match(image, /blob\.type\.trim\(\)\.toLowerCase\(\)/)
  assert.doesNotMatch(image, /URL\.createObjectURL|previewSrcIsObjectUrl/)
})

test('the existing link helper contract remains title, text, url, navigator.share, and title-newline-url fallback', () => {
  const share = read('lib/share.ts')
  assert.match(share, /title: normalizedTitle/)
  assert.match(share, /text: normalizedText/)
  assert.match(share, /url: normalizedUrl/)
  assert.match(share, /navigator\.share/)
  assert.match(share, /\$\{title\.trim\(\)\}\\n\$\{url\.trim\(\)\}/)
})
