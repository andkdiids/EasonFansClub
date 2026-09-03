import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getNotificationCategory } from '../lib/notifications'
import { buildStudioReviewNotification } from '../lib/studio/review-notifications'

const read = (path: string) => readFileSync(path, 'utf8')

const reviewRoute = read('app/api/admin/studio/projects/route.ts')
const submitRoute = read('app/api/studio/projects/[projectId]/publish/route.ts')
const adminPage = read('app/admin/studio/page.tsx')
const adminPanel = read('app/admin/studio/StudioAdminPanel.tsx')
const adminApi = read('app/api/admin/studio/projects/route.ts')
const studioHome = read('components/studio/StudioHome.tsx')
const studioCss = read('components/studio/studio.module.css')
const schema = read('prisma/schema.prisma')

test('拼豆审核结果复用个人通知类型并生成精确的通过/拒绝文案', () => {
  const reviewedAt = new Date('2026-09-02T12:34:56.000Z')
  const approved = buildStudioReviewNotification({
    projectId: 'project-1',
    recipientId: 'user-1',
    actorId: 'admin-1',
    title: '我的第一张图纸',
    status: 'APPROVED',
    reviewedAt,
  })
  const rejected = buildStudioReviewNotification({
    projectId: 'project-1',
    recipientId: 'user-1',
    actorId: 'admin-1',
    title: '我的第一张图纸',
    status: 'REJECTED',
    reviewedAt,
  })

  assert.equal(approved.type, 'ADMIN')
  assert.equal(approved.title, '拼豆作品审核通过')
  assert.equal(approved.content, '你的拼豆作品「我的第一张图纸」已通过审核，现在可以在创作广场展示。')
  assert.equal(approved.link, '/studio/project/project-1')
  assert.equal(rejected.type, 'ADMIN')
  assert.equal(rejected.title, '拼豆作品审核未通过')
  assert.equal(rejected.content, '你的拼豆作品「我的第一张图纸」未通过审核。')
  assert.equal(rejected.link, '/studio/beads?project=project-1')
  assert.notEqual(approved.content, rejected.content)
  assert.equal(getNotificationCategory(approved.type, approved.link, approved.key), 'system')
  assert.equal(getNotificationCategory(rejected.type, rejected.link, rejected.key), 'system')
  assert.match(reviewRoute, /buildStudioReviewNotification\(/)
  assert.match(reviewRoute, /STUDIO_REVIEW_NOTIFICATION_TYPE/)
  assert.doesNotMatch(schema.match(/enum NotificationType\s*\{[\s\S]*?\n\}/)?.[0] || '', /STUDIO_REVIEW/)
})

test('提交公开审核后只允许 PENDING 转换，审核成功后才写对应结果通知', () => {
  assert.match(submitRoute, /data: \{ visibility: 'PUBLIC', reviewStatus: 'PENDING' \}/)
  assert.match(reviewRoute, /project\.reviewStatus !== 'PENDING'/)
  assert.match(reviewRoute, /where: \{ id: project\.id, reviewStatus: 'PENDING' \}/)
  assert.match(reviewRoute, /if \(reviewStatus === 'APPROVED' \|\| reviewStatus === 'REJECTED'\)/)
  assert.doesNotMatch(reviewRoute, /tx\.notification\.create/)
  const updateStart = reviewRoute.indexOf('const updated = await prisma.$transaction')
  const notificationStart = reviewRoute.indexOf('const notification = await safeNotificationWrite')
  assert.ok(updateStart >= 0)
  assert.ok(notificationStart > updateStart)
  assert.match(reviewRoute, /if \(notification\)[\s\S]*emitRealtime\(updated\.userId, 'notification'\)/)
})

test('审核中心展示已有缩略图，缺失时使用 Pattern Grid renderer，并提供完整详情', () => {
  assert.match(adminPage, /thumbnailUrl: true/)
  assert.match(adminPage, /extractStudioReviewPattern/)
  assert.match(adminPage, /pattern, metadata/)
  assert.match(adminApi, /thumbnailUrl: true/)
  assert.match(adminApi, /extractStudioReviewPattern/)
  assert.match(adminPanel, /function PatternPreview/)
  assert.match(adminPanel, /project\.thumbnailUrl/)
  assert.match(adminPanel, /renderPatternToCanvas/)
  assert.match(adminPanel, /calculateMaterialList/)
  assert.match(adminPanel, /作品预览/)
  assert.match(adminPanel, /图纸网格/)
  assert.match(adminPanel, /颜色统计 \/ 材料统计/)
  assert.match(adminPanel, /作者将收到通知/)
  assert.match(adminPanel, /不上传原始图片/)
  assert.doesNotMatch(adminPanel, /uploadSiteImage|studio-reference/)
})

test('审核页面统计使用紧凑响应式 Grid，且不改变真实统计来源', () => {
  const statsSection = adminPage.match(/<section aria-label="创作平台统计"[\s\S]*?<\/section>/)?.[0]
  assert.ok(statsSection)
  assert.match(statsSection, /className="grid grid-cols-2 gap-2\.5 sm:grid-cols-3 lg:grid-cols-6"/)
  assert.equal((statsSection.match(/min-h-\[92px\]/g) || []).length, 6)
  assert.equal((statsSection.match(/p-3 sm:p-4/g) || []).length, 6)
  assert.equal((statsSection.match(/text-sm font-black/g) || []).length, 6)
  assert.equal((statsSection.match(/text-3xl font-black/g) || []).length, 6)
  assert.doesNotMatch(statsSection, /col-span|p-5/)
  assert.match(adminPage, /prisma\.studioProject\.count\(\)/)
  assert.match(adminPage, /reviewStatus: 'PENDING'/)
  assert.match(adminPage, /likeCount: true, favoriteCount: true, viewCount: true/)
})

test('贝多芬与我首页 Hero 降高且工具入口紧随其后，移动端没有固定大空白', () => {
  assert.match(studioCss, /\.homeHero \{[^}]*height: clamp\(280px, 24vw, 360px\)[^}]*max-height: 360px/)
  assert.match(studioCss, /\.heroCopy \{[^}]*padding: clamp\(22px, 3\.5vw, 44px\)/)
  assert.match(studioCss, /\.heroArt \{[^}]*min-height: 280px/)
  assert.match(studioCss, /@media \(max-width: 767px\)[\s\S]*\.homeHero \{[^}]*height: auto[^}]*max-height: none/)
  assert.match(studioCss, /@media \(max-width: 767px\)[\s\S]*\.heroArt \{[^}]*min-height: 180px/)
  const heroIndex = studioHome.indexOf('<section className={styles.homeHero}>')
  const toolsIndex = studioHome.indexOf('<section className={styles.section}>')
  assert.ok(heroIndex >= 0)
  assert.ok(toolsIndex > heroIndex)
})
