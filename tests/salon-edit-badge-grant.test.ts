import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SALON_BADGE_CLASSIFICATION } from '@/lib/salon-badges'

const read = (path: string) => readFileSync(path, 'utf8')

test('沙龙详情编辑入口按作者或沙龙管理权限显示，API 仍服务端复核', () => {
  const detail = read('components/salon/SalonDetail.tsx')
  const page = read('app/salon/[postId]/page.tsx')
  const route = read('app/api/salon/posts/[postId]/route.ts')
  assert.match(detail, /currentUserId === post\.author\.id \|\| canModerate \? <Link href=\{editHref\}/)
  assert.match(page, /hasAdminPermission\(user, 'post_manage'\)/)
  assert.match(route, /const isOwner = current\.userId === guard\.user\.id/)
  assert.match(route, /if \(!isOwner && !canModerate\) return .*status: 403/)
})

test('作者编辑进入待审核，管理员编辑直接通过并记录统一审计', () => {
  const route = read('app/api/salon/posts/[postId]/route.ts')
  const audit = read('lib/admin-audit.ts')
  assert.match(route, /status: 'PENDING'/)
  assert.match(route, /status: 'APPROVED'/)
  assert.match(route, /operation: 'ADMIN_EDIT'/)
  assert.match(route, /createSalonReviewNotifications\(\{[\s\S]*reviewKind: 'EDIT'/)
  assert.match(audit, /SALON_POST_ADMIN_EDIT: 'SALON_POST_ADMIN_EDIT'/)
  assert.match(route, /SALON_POST_ADMIN_EDIT/)
})

test('编辑请求携带 baseUpdatedAt 并在行锁内拒绝并发旧版本覆盖', () => {
  const form = read('components/salon/SalonEditForm.tsx')
  const route = read('app/api/salon/posts/[postId]/route.ts')
  const shared = read('lib/salon-shared.ts')
  const service = read('lib/salon.ts')
  assert.match(form, /baseUpdatedAt: post\.updatedAt/)
  assert.match(form, /router\.replace\(detailHref\)/)
  assert.match(route, /FOR UPDATE/)
  assert.match(route, /SALON_EDIT_CONFLICT/)
  assert.match(shared, /updatedAt: string/)
  assert.match(service, /updatedAt: row\.updatedAt\.toISOString\(\)/)
})

test('统一审核中心标识沙龙编辑类型并复用现有通过/拒绝链路', () => {
  const api = read('app/api/admin/review/route.ts')
  const card = read('app/admin/review/ReviewCenter.tsx')
  const notifications = read('lib/salon-review-notifications.ts')
  assert.match(api, /getSalonEditReviewPostIds\(rows\.map\(\(row\) => row\.id\)\)/)
  assert.match(api, /reviewKind: editPostIds\.has\(row\.id\) \? 'EDIT' : 'CREATE'/)
  assert.doesNotMatch(api, /row\.updatedAt\.getTime\(\) > row\.createdAt\.getTime\(\)/)
  assert.match(card, /类型：\{item\.reviewKind === 'EDIT' \? '编辑' : '投稿'\}/)
  assert.match(notifications, /SALON_EDIT_REVIEW_NOTIFICATION_TITLE/)
  assert.match(notifications, /startsWith: salonEditReviewNotificationKeyPrefix\(postId\)/)
})

test('没有可靠沙龙勋章分类时不猜测、不展示全站勋章，但保留真实权限与统一发放适配器', () => {
  const route = read('app/api/salon/posts/[postId]/badges/route.ts')
  const grantAdapter = read('lib/salon-badge-grant.ts')
  const ui = read('components/salon/SalonBadgeGrant.tsx')
  assert.equal(SALON_BADGE_CLASSIFICATION.available, false)
  assert.match(route, /requireAdmin\('achievement_manage'\)/)
  assert.doesNotMatch(route, /isAdmin\s*===\s*true/)
  assert.match(route, /SALON_BADGE_CLASSIFICATION_UNAVAILABLE/)
  assert.doesNotMatch(route, /name\.toLowerCase\(\).*沙龙|includes\(['"]沙龙/)
  assert.match(grantAdapter, /grantBadge\(/)
  assert.match(grantAdapter, /sourceType: 'SALON_ADMIN_GRANT'/)
  assert.match(grantAdapter, /grantKey: `salon-admin:/)
  assert.match(ui, /派发对象：\{author\.nickname\}/)
  assert.doesNotMatch(ui, /搜索用户|输入 UID|选择用户/)
})
