import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { publicImageUrl } from '@/lib/images'
import { resolveImageViewerFullUrl } from '@/lib/image-viewer-url'

const read = (path: string) => readFileSync(path, 'utf8')

/** The exact effective URL the inline image loads. */
const inlineEffective = (src: string) => publicImageUrl(src) || src

const NO_ORIGINAL = { hasExplicitOriginal: false }

test('正文使用 /cos-files/…：全屏预览复用与正文完全相同的有效地址，不猜 /original', () => {
  const src = '/cos-files/content/user-1/post-1/source.webp?v=7'
  const effective = inlineEffective(src)
  assert.equal(effective, 'https://media.ecfc.fans/media/content/user-1/post-1/source.webp?v=7')
  assert.equal(resolveImageViewerFullUrl({ src, ...NO_ORIGINAL }), effective)
  // 根因守卫：不再把 source 对象映射到不存在的同级 original。
  assert.doesNotMatch(resolveImageViewerFullUrl({ src, ...NO_ORIGINAL }), /\/original[?#]|\/original$/)
})

test('完整站内 URL https://ecfc.fans/cos-files/… 不被改写，Preview 与正文一致', () => {
  const src = 'https://ecfc.fans/cos-files/content/user-1/post-1/source.webp'
  assert.equal(inlineEffective(src), src)
  assert.equal(resolveImageViewerFullUrl({ src, ...NO_ORIGINAL }), src)
  assert.doesNotMatch(resolveImageViewerFullUrl({ src, ...NO_ORIGINAL }), /\/original/)
})

test('外部合法 HTTPS 图片不强套 /cos-files/，Preview 原样使用', () => {
  const src = 'https://example.com/album/poster.jpg'
  assert.equal(inlineEffective(src), src)
  assert.equal(resolveImageViewerFullUrl({ src, ...NO_ORIGINAL }), src)
})

test('URL 带 query：Preview 与正文一致且不丢失 query', () => {
  const withQuery = 'https://media.ecfc.fans/media/content/user-1/post-1/source.webp?x-cos-version=1&v=7'
  const full = resolveImageViewerFullUrl({ src: withQuery, ...NO_ORIGINAL })
  assert.equal(full, withQuery)
  assert.ok(full.includes('?x-cos-version=1&v=7'))
  const proxied = resolveImageViewerFullUrl({ src: '/cos/content/legacy.webp?v=7', ...NO_ORIGINAL })
  assert.ok(proxied.endsWith('legacy.webp?v=7'))
})

test('URL 带中文/空格/% 编码：只做一次归一化，不二次编码，也不生成 original', () => {
  const raw = '/cos/content/用户 相册/我的 照片/source.webp'
  const effective = inlineEffective(raw)
  const full = resolveImageViewerFullUrl({ src: raw, ...NO_ORIGINAL })
  assert.equal(full, effective)
  // 只保留一层编码：解码后应还原为原始路径段。
  assert.equal(decodeURIComponent(new URL(full).pathname), '/media/content/用户 相册/我的 照片/source.webp')
  // 已编码的输入不得被再次编码。
  const preEncoded = 'https://media.ecfc.fans/media/content/%E7%94%A8%E6%88%B7/post/source.webp'
  assert.equal(resolveImageViewerFullUrl({ src: preEncoded, ...NO_ORIGINAL }), preEncoded)
  assert.doesNotMatch(resolveImageViewerFullUrl({ src: raw, ...NO_ORIGINAL }), /\/original/)
})

test('已有显式 originalUrl 时才使用原图，其余一律复用有效 src', () => {
  const src = '/cos/content/user-1/post-1/source.webp?v=7'
  const explicit = 'https://media.ecfc.fans/media/content/user-1/post-1/original?v=7'
  // 显式提供 → 尊重该地址。
  assert.equal(resolveImageViewerFullUrl({ src, originalUrl: explicit, hasExplicitOriginal: true }), explicit)
  // 显式提供空值 → 回退到有效 src，而不是猜测。
  assert.equal(resolveImageViewerFullUrl({ src, originalUrl: null, hasExplicitOriginal: true }), inlineEffective(src))
  // 未显式提供（历史/内容图片）→ 直接复用有效 src。
  assert.equal(resolveImageViewerFullUrl({ src, hasExplicitOriginal: false }), inlineEffective(src))
})

test('source 布局与旧布局对象在无显式原图时全屏一律等于正文有效地址', () => {
  const cases = [
    '/cos-files/posts/a/b/source.webp',
    'https://media.ecfc.fans/media/posts/a/b/source.webp',
    '/cos/posts/legacy/photo.jpg',
    'https://media.ecfc.fans/media/posts/legacy/photo.png',
    'https://cos-other.bucket.myqcloud.com/posts/legacy.png',
  ]
  for (const src of cases) {
    const full = resolveImageViewerFullUrl({ src, ...NO_ORIGINAL })
    assert.equal(full, inlineEffective(src), src)
    assert.doesNotMatch(full, /\/original[?#]|\/original$/, src)
  }
})

test('内容图片上传不保留 original（根因上游），ImageViewer 不再做 original 猜测', () => {
  const contentImageRoute = read('app/api/uploads/content-image/route.ts')
  assert.match(contentImageRoute, /preserveOriginal: false/)
  const viewer = read('components/ImageViewer.tsx')
  assert.match(viewer, /import \{ resolveImageViewerFullUrl \} from '@\/lib\/image-viewer-url'/)
  assert.doesNotMatch(viewer, /publicImageOriginalUrl|toImageOriginalUrl/)
  assert.match(viewer, /renderOriginalSrc = resolveImageViewerFullUrl/)
})

test('帖子/回复/鱼形流的图片全部把已解析 src 交给同一查看器，不做替换拼接', () => {
  const carousel = read('components/PostMediaCarousel.tsx')
  assert.match(carousel, /src: item\.url,/)
  assert.match(carousel, /src=\{item\.url\}/)
  const replies = read('components/PostRepliesSection.tsx')
  assert.match(replies, /<ImageViewer[^>]*src=\{url\}/)
  const fishGrid = read('components/ForumFishModePostRow.tsx')
  assert.match(fishGrid, /src: item\.url,/)
  const fishPreview = read('components/ForumFishModePreview.tsx')
  assert.match(fishPreview, /splitContentImages/)
  // 任何图片入口都不应该把 src 传给解析器前先做 replace/split 猜原图。
  const sharedResolver = read('lib/image-viewer-url.ts')
  assert.match(sharedResolver, /must never reconstruct a sibling .original. path by guessing/)
})
