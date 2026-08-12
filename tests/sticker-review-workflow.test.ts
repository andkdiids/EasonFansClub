import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const adminReview = read('app/api/admin/stickers/[id]/route.ts')
const editRoute = read('app/api/stickers/my/[packId]/route.ts')
const addRoute = read('app/api/stickers/my/[packId]/stickers/route.ts')
const submitRoute = read('app/api/stickers/my/[packId]/submit/route.ts')
const deleteRoute = read('app/api/stickers/[id]/route.ts')
const notifications = read('lib/notification-target.ts')
const editPage = read('app/profile/stickers/[packId]/edit/StickerPackEditForm.tsx')

test('拒绝只改变审核状态与原因，不删除原合集或媒体', () => {
  assert.match(adminReview, /existing\.status !== 'PENDING'/)
  assert.match(adminReview, /status: 'REJECTED'/)
  assert.match(adminReview, /rejectionReason/)
  assert.doesNotMatch(adminReview, /stickerPack\.delete|sticker\.deleteMany|stickerPack\.deleteMany/)
  assert.match(adminReview, /getStickerPackReviewNotificationLink\((?:updated|review)\.id, (?:updated|review)\.status\)/)
})

test('用户编辑接口校验本人和 REJECTED 状态，且更新条件再次校验状态', () => {
  assert.match(editRoute, /pack\.creatorId !== userId/)
  assert.match(editRoute, /status === 'PENDING'/)
  assert.match(editRoute, /status: 'REJECTED'/)
  assert.match(editRoute, /updateMany\(/)
  assert.match(editRoute, /creatorId: guard\.user\.id, status: 'REJECTED'/)
})

test('单张新增与删除仅允许退回合集，重新提交复用原 packId', () => {
  assert.match(addRoute, /pack\.creatorId !== guard\.user\.id/)
  assert.match(addRoute, /status === 'PENDING'/)
  assert.match(addRoute, /status: 'REJECTED'/)
  assert.match(addRoute, /tx\.sticker\.create/)
  assert.match(deleteRoute, /status: 'REJECTED'/)
  assert.match(deleteRoute, /sticker\.deleteMany/)
  assert.match(submitRoute, /status: 'PENDING'/)
  assert.match(submitRoute, /updateMany\(/)
  assert.doesNotMatch(submitRoute, /stickerPack\.create/)
})

test('拒绝通知精确跳转编辑页，旧无链接 ADMIN 通知回退到我的表情包', () => {
  assert.match(notifications, /notification\.source === 'personal' && notification\.type === 'ADMIN'/)
  assert.match(notifications, /return '\/profile\/stickers'/)
  assert.match(editPage, /fetch\(`\/api\/stickers\/my\/\$\{pack\.id\}`/)
  assert.match(editPage, /fetch\(`\/api\/stickers\/my\/\$\{pack\.id\}\/submit`/)
  assert.match(editPage, /审核未通过/)
})
