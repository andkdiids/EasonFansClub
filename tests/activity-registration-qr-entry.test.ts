import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('活动报名二维码指向真实存在的前台扫码入口，并保留旧二维码兼容跳转', () => {
  const qr = read('components/activities/ActivityRegistrationQr.tsx')
  const legacy = read('app/admin/activities/[activityId]/verify/page.tsx')

  assert.match(qr, /\/activities\/checkin\//)
  assert.doesNotMatch(qr, /\/admin\/activities\/.*verify\?token/)
  assert.match(legacy, /activities\/checkin/)
  assert.match(legacy, /activityVerificationTokenFromInput/)
})

test('扫码页面先做服务端登录与活动核销权限校验，再读取报名数据', () => {
  const page = read('app/activities/checkin/[token]/page.tsx')
  const permissionIndex = page.indexOf("hasAdminPermission(user, 'activity_manage')")
  const lookupIndex = page.indexOf('getActivityRedemptionLookupByToken(token)')

  assert.match(page, /redirect\(`\/login\?redirect=/)
  assert.match(page, /无核销权限/)
  assert.match(page, /当前账号没有活动核销权限/)
  assert.ok(permissionIndex >= 0)
  assert.ok(lookupIndex > permissionIndex)
})

test('扫码只查询，确认按钮使用现有服务端二次确认核销事务', () => {
  const page = read('components/activities/ActivityRegistrationCheckinPage.tsx')
  const lookup = read('app/api/admin/activities/[activityId]/verify/route.ts')
  const confirm = read('app/api/admin/activities/[activityId]/redemption-confirm/route.ts')

  assert.match(page, /ConfirmDialog/)
  assert.match(page, /确认核销该用户？/)
  assert.match(page, /redemption-confirm/)
  assert.match(lookup, /scanOnly: true/)
  assert.doesNotMatch(lookup, /verifyActivityRegistration\(/)
  assert.match(confirm, /confirmActivityRedemption\(/)
})

test('扫码页展示核销时间与工作人员，并复用不重复核销的状态', () => {
  const redemption = read('lib/activity-redemption.ts')
  const page = read('components/activities/ActivityRegistrationCheckinPage.tsx')

  assert.match(redemption, /verifiedBy: registration\.VerifiedBy/)
  assert.match(redemption, /registeredAt: registration\.registeredAt/)
  assert.match(page, /已核销/)
  assert.match(page, /核销时间/)
  assert.match(page, /核销工作人员/)
  assert.match(page, /isCheckedIn/)
})
