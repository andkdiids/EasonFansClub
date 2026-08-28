import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('首页精选帖子只缓存公共投影，用户点赞状态在缓存外补齐', () => {
  const homeData = read('lib/home-data.ts')
  const cacheStart = homeData.indexOf('const getCachedHomePosts = unstable_cache')
  const fallbackStart = homeData.indexOf('async function getCachedHomePostsWithFallback')
  assert.ok(cacheStart >= 0)
  assert.ok(fallbackStart > cacheStart)

  const cachedLoader = homeData.slice(cacheStart, fallbackStart)
  assert.match(homeData, /import \{ unstable_cache \} from 'next\/cache'/)
  assert.match(homeData, /HOME_FEATURED_POSTS_CACHE_KEY = 'home:hot-posts:v1'/)
  assert.match(homeData, /HOME_FEATURED_POSTS_CACHE_TAG = 'home-featured-posts'/)
  assert.match(homeData, /HOME_FEATURED_POSTS_CACHE_TTL_SECONDS = 60/)
  assert.match(cachedLoader, /revalidate: HOME_FEATURED_POSTS_CACHE_TTL_SECONDS/)
  assert.match(cachedLoader, /tags: \[HOME_FEATURED_POSTS_CACHE_TAG\]/)
  assert.doesNotMatch(cachedLoader, /userId|likedByMe|prisma\.like/)
  assert.match(homeData, /const posts = await getCachedHomePostsWithFallback\(\)/)
  assert.match(homeData, /const liked = await prisma\.like\.findMany\(/)
})

test('热门公共缓存异常时回退到原有受控数据库读取', () => {
  const homeData = read('lib/home-data.ts')
  const fallbackStart = homeData.indexOf('async function getCachedHomePostsWithFallback')
  assert.ok(fallbackStart >= 0)
  const fallback = homeData.slice(fallbackStart)
  assert.match(fallback, /try \{[\s\S]*return await getCachedHomePosts\(\)[\s\S]*catch \(error\)/)
  assert.match(fallback, /return addHomePostPublicDetails\(await getHomePostsUncached\(\)\)/)
})

test('帖子删除、编辑和审核会失效首页精选缓存，但互动请求不清空它', () => {
  const postRoute = read('app/api/posts/[postId]/route.ts')
  const reviewRoute = read('app/api/admin/posts/review/route.ts')
  const likeRoute = read('app/api/posts/[postId]/like/route.ts')
  const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
  assert.equal((postRoute.match(/revalidateTag\(HOME_FEATURED_POSTS_CACHE_TAG\)/g) || []).length, 3)
  assert.match(reviewRoute, /revalidateTag\(HOME_FEATURED_POSTS_CACHE_TAG\)/)
  assert.doesNotMatch(likeRoute, /HOME_FEATURED_POSTS_CACHE_TAG/)
  assert.doesNotMatch(replyRoute, /HOME_FEATURED_POSTS_CACHE_TAG/)
})

test('高频随意门列表媒体默认延迟加载，只给首个可见卡片高优先级', () => {
  const carousel = read('components/anywhere-door/MediaCarousel.tsx')
  const feed = read('components/anywhere-door/AnywhereDoorFeed.tsx')
  const card = read('components/anywhere-door/AnywhereDoorPostCard.tsx')
  const viewer = read('components/ImageViewer.tsx')
  const trending = read('lib/trending-posts.ts')
  const trendingPage = read('app/trending/page.tsx')
  assert.match(carousel, /priority = false/)
  assert.match(carousel, /loading=\{priority \? 'eager' : 'lazy'\}/)
  assert.match(carousel, /decoding="async"/)
  assert.match(feed, /items\.map\(\(post, index\) => <AnywhereDoorPostCard[\s\S]*priority=\{index === 0\}/)
  assert.match(card, /priority=\{priority\}/)
  assert.match(viewer, /loading=\{loading\}/)
  assert.match(viewer, /decoding="async"/)
  assert.match(trending, /publicImageVariantUrl\(row\.authorAvatarUrl, 'avatar-md'\)/)
  assert.match(trending, /publicImageVariantUrl\(row\.imageUrl, 'card'\)/)
  assert.match(trendingPage, /loading="lazy" decoding="async"/)
})

test('既有新上传图片链路输出受限 WebP 变体并保留原图/透明度语义', () => {
  const imageWebp = read('lib/image-webp.ts')
  const uploadRoute = read('app/api/uploads/content-image/route.ts')
  const variantUpload = read('lib/image-variant-upload.ts')
  assert.match(imageWebp, /rotate\(\)\.resize\(resizeOptions\)/)
  assert.match(imageWebp, /withoutEnlargement: true/)
  assert.match(imageWebp, /Transparency is preserved because no flatten\/composite operation is used/)
  assert.match(uploadRoute, /CONTENT_IMAGE_MAX_WIDTH = 1600/)
  assert.match(uploadRoute, /CONTENT_IMAGE_QUALITY = 82/)
  assert.match(uploadRoute, /uploadImageVariantFamily/)
  assert.match(variantUpload, /body: params\.original/)
  assert.match(variantUpload, /contentType: 'image\/webp'/)
})
