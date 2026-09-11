import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('活动中心只向拥有活动权限的管理员渲染前台核销入口', () => {
  const page = read('app/activities/page.tsx')
  const list = read('components/activities/ActivitiesListClient.tsx')

  assert.match(page, /hasAdminPermission\(user, 'activity_manage'\)/)
  assert.match(page, /canCheckIn/)
  assert.match(list, /canCheckIn \?/) 
  assert.match(list, /href="\/activities\/checkin"/)
})

test('前台核销页和查询 API 都在读取报名详情前执行服务端权限校验', () => {
  const page = read('app/activities/checkin/page.tsx')
  const route = read('app/api/admin/activities/checkin/route.ts')

  assert.match(page, /hasAdminPermission\(user, 'activity_manage'\)/)
  assert.match(page, /无核销权限/)
  assert.match(route, /requireAdmin\('activity_manage'\)/)
  assert.match(route, /getActivityRedemptionLookupByToken\(token\)/)
  assert.match(route, /scanOnly: true/)
  assert.match(route, /activityVerificationTokenFromInput/)
})

test('扫码优先使用 BarcodeDetector，并在不支持时使用 ZXing fallback 且始终停止摄像头轨道', () => {
  const scanner = read('components/activities/ActivityRegistrationScanner.tsx')

  assert.match(scanner, /BarcodeDetector/)
  assert.match(scanner, /getUserMedia/)
  assert.match(scanner, /facingMode: \{ ideal: 'environment' \}/)
  assert.match(scanner, /decodeFromStream/)
  assert.match(scanner, /track\.stop\(\)/)
  assert.match(scanner, /navigator\.vibrate\(100\)/)
  assert.match(scanner, /手动输入核销码/)
})

test('扫码成功仍需现有二次确认，并支持连续扫码', () => {
  const scannerPage = read('components/activities/ActivityCheckinScannerPage.tsx')
  const confirmationPage = read('components/activities/ActivityRegistrationCheckinPage.tsx')

  assert.match(scannerPage, /scanLockRef/)
  assert.match(scannerPage, /redemption-confirm|\/api\/admin\/activities\/checkin/)
  assert.match(scannerPage, /setLookup\(data\)/)
  assert.match(confirmationPage, /ConfirmDialog/)
  assert.match(confirmationPage, /继续扫码/)
  assert.match(confirmationPage, /router\.push\('\/activities\/checkin\?scan=1'\)/)
})
