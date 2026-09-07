import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SalonReviewError, toSalonReviewError } from '@/lib/salon-review-errors'

const read = (path: string) => readFileSync(path, 'utf8')

test('沙龙审核失败会保留安全错误码和可定位的处理阶段', () => {
  const rewardFailure = toSalonReviewError(new Error('GrowthTaskCompletion table is missing'), 'REWARD')
  assert.equal(rewardFailure.code, 'REWARD_PROCESSING_ERROR')
  assert.equal(rewardFailure.status, 500)
  assert.match(rewardFailure.message, /奖励处理失败/)
  assert.doesNotMatch(rewardFailure.message, /GrowthTaskCompletion/)

  const raceFailure = toSalonReviewError(new Error('SALON_POST_ALREADY_REVIEWED'), 'DATABASE_UPDATE')
  assert.equal(raceFailure.code, 'ALREADY_REVIEWED')
  assert.equal(raceFailure.status, 409)

  const knownFailure = new SalonReviewError('SESSION_NOT_FOUND', '演唱会场次不存在')
  assert.equal(toSalonReviewError(knownFailure, 'VALIDATION'), knownFailure)
})

test('沙龙审核 API 和后台会显示具体失败原因，不再只吞成审核失败', () => {
  const route = read('app/api/admin/salon/route.ts')
  const manager = read('app/admin/salon/AdminSalonManager.tsx')

  assert.match(route, /function reviewErrorResponse\(code: SalonReviewErrorCode, message: string, status = 400\)/)
  assert.match(route, /toSalonReviewError\(error, failureStage\)/)
  assert.match(route, /failureStage = 'REWARD'/)
  assert.match(route, /console\.error\('\[admin\.salon\.review\.failed\]'/)
  assert.match(manager, /data\?\.message\?\.trim\(\)/)
  assert.match(manager, /审核失败：\$\{reason\}/)
  assert.doesNotMatch(manager, /setError\(caught instanceof Error \? caught\.message : '审核失败'\)/)
})

test('当前沙龙图片规则允许 2000×1125，不存在电脑壁纸最小 2560×1440 的审核规则', () => {
  const uploadRoute = read('app/api/salon/posts/route.ts')
  const adminRoute = read('app/api/admin/salon/route.ts')
  assert.ok(2000 * 1125 <= 100_000_000)
  assert.match(uploadRoute, /limitInputPixels: 100_000_000/)
  assert.match(uploadRoute, /if \(!metadata\.width \|\| !metadata\.height\)/)
  assert.doesNotMatch(uploadRoute, /2560\s*[×x*]\s*1440/)
  assert.doesNotMatch(adminRoute, /2560\s*[×x*]\s*1440/)
})
