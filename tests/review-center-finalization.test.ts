import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseReviewStatus, reviewSalonCategoryLabel } from '../lib/review-center'

const read = (relativePath: string) => readFileSync(relativePath, 'utf8')

test('审核中心只保留通过/拒绝主操作，并移除查看详情 action', () => {
  const center = read('app/admin/review/ReviewCenter.tsx')
  const api = read('app/api/admin/review/route.ts')
  const actions = center.indexOf("item.status === 'PENDING'")
  const approve = center.indexOf('>通过</button>', actions)
  const reject = center.indexOf('>拒绝</button>', actions)

  assert.doesNotMatch(center, /查看详情/u)
  assert.doesNotMatch(center, /detailUrl/u)
  assert.doesNotMatch(api, /detailUrl/u)
  assert.match(center, /item\.status === 'PENDING'/u)
  assert.ok(actions >= 0 && approve > actions && reject > approve)
  assert.match(center, /item\.actions\.edit && item\.actions\.editUrl/u)
})

test('成功处理使用统一 resolver，清除当前卡片、计数和 deep-link 状态', () => {
  const center = read('app/admin/review/ReviewCenter.tsx')

  assert.match(center, /function resolveSuccessfulReview/u)
  assert.match(center, /setItems\(\(current\) => current\.filter/u)
  assert.match(center, /reviewCountAfterDecision/u)
  assert.match(center, /loadRequestRef\.current \+= 1/u)
  assert.match(center, /resolveSuccessfulReview\(item, decision\)/u)
  assert.match(center, /resolveSuccessfulDelete\(item\)/u)
  assert.match(center, /for \(const key of \['targetId', 'sourceId', 'reviewId', 'focus'\]\)/u)
  assert.match(center, /router\.replace/u)
  assert.match(center, /requestId !== loadRequestRef\.current/u)
})

test('沙龙审核使用真实分类配置并安全兼容历史值', () => {
  const api = read('app/api/admin/review/route.ts')
  const center = read('app/admin/review/ReviewCenter.tsx')

  assert.equal(reviewSalonCategoryLabel('CONCERT'), '演唱会记录')
  assert.equal(reviewSalonCategoryLabel('MOBILE_WALLPAPER'), '手机壁纸')
  assert.equal(reviewSalonCategoryLabel('DESKTOP_WALLPAPER'), '电脑壁纸')
  assert.equal(reviewSalonCategoryLabel(null), '未分类')
  assert.equal(reviewSalonCategoryLabel('UNKNOWN_OLD_CODE'), '未分类')
  assert.match(api, /reviewSalonCategoryLabel\(row\.category\)/u)
  assert.match(center, /分区：/u)
  assert.match(center, /关联演唱会：/u)
})

test('审核图片继续使用统一 Lightbox，多图和移动端点击预览路径不变', () => {
  const center = read('app/admin/review/ReviewCenter.tsx')

  assert.match(center, /<ImageViewer/u)
  assert.match(center, /gallery=\{mediaItems\}/u)
  assert.match(center, /cursor-zoom-in/u)
  assert.match(center, /mediaItems = \(item\.media \|\| \[\]\)\.filter/u)
})

test('无图帖子不挂载图片区域，也不保留桌面图片列或帖子占位文字', () => {
  const center = read('app/admin/review/ReviewCenter.tsx')

  assert.match(center, /const showMediaColumn = Boolean\(primaryMedia\) \|\| item\.sourceType !== 'POST'/u)
  assert.match(center, /item\.sourceType === 'POST' \? null/u)
  assert.match(center, /lg:grid-cols-\[minmax\(0,1fr\)_auto\]/u)
  assert.doesNotMatch(center, /item\.sourceType === 'POST' \? '帖子'/u)
})

test('审核中心状态筛选只保留三态，旧 status=all 回退待审核', () => {
  const center = read('app/admin/review/ReviewCenter.tsx')
  const page = read('app/admin/review/page.tsx')
  const api = read('app/api/admin/review/route.ts')

  assert.doesNotMatch(center, /全部状态/u)
  assert.match(center, /\['PENDING', 'APPROVED', 'REJECTED'\]/u)
  assert.match(center, /useState<ReviewStatus>\(initialStatus\)/u)
  assert.match(page, /parseReviewStatus\(rawStatus\)/u)
  assert.match(api, /const status = parseReviewStatus\(statusParam\)/u)
  assert.equal(parseReviewStatus(undefined), 'PENDING')
  assert.equal(parseReviewStatus('all'), 'PENDING')
  assert.equal(parseReviewStatus('ALL'), 'PENDING')
  assert.equal(parseReviewStatus('pending'), 'PENDING')
  assert.equal(parseReviewStatus('approved'), 'APPROVED')
  assert.equal(parseReviewStatus('rejected'), 'REJECTED')
})

test('通知 deep-link 会跨状态解析目标并切换到真实历史 Tab', () => {
  const center = read('app/admin/review/ReviewCenter.tsx')
  const api = read('app/api/admin/review/route.ts')

  assert.match(api, /const queryStatus: ReviewStatus \| 'ALL' = targetId \? 'ALL' : status/u)
  assert.match(api, /targetStatus: targetId \? allItems\.find\(\(item\) => item\.sourceId === targetId\)\?\.status/u)
  assert.match(center, /data\?\.targetStatus && data\.targetStatus !== nextStatus/u)
  assert.match(center, /replaceStatusInUrl\(data\.targetStatus\)/u)
})
