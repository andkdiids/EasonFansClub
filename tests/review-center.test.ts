import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canApplyReviewDecision, parseReviewSourceType, reviewSourceDefinitions } from '../lib/review-center'
import { canTransitionPostModerationStatus } from '../lib/post-moderation'
import { canTransitionSalonReviewStatus } from '../lib/salon-review-transitions'
import { canTransitionStudioReviewStatus } from '../lib/studio/review-transitions'
import { canTransitionTodayReviewStatus } from '../lib/today-review-transitions'

const read = (path: string) => readFileSync(path, 'utf8')

test('统一审核状态机明确实现 REJECTED 优先级', () => {
  const transitions = [
    canTransitionPostModerationStatus,
    canTransitionSalonReviewStatus,
    canTransitionStudioReviewStatus,
    canTransitionTodayReviewStatus,
  ]
  for (const transition of transitions) {
    assert.equal(transition('PENDING', 'APPROVED'), true)
    assert.equal(transition('PENDING', 'REJECTED'), true)
    assert.equal(transition('APPROVED', 'REJECTED'), true)
    assert.equal(transition('REJECTED', 'APPROVED'), false)
    assert.equal(transition('REJECTED', 'REJECTED'), false)
    assert.equal(transition('APPROVED', 'APPROVED'), false)
  }
  assert.equal(canApplyReviewDecision('PENDING', 'APPROVE'), true)
  assert.equal(canApplyReviewDecision('PENDING', 'REJECT'), true)
  assert.equal(canApplyReviewDecision('APPROVED', 'APPROVE'), false)
  assert.equal(canApplyReviewDecision('APPROVED', 'REJECT'), true)
  assert.equal(canApplyReviewDecision('REJECTED', 'APPROVE'), false)
  assert.equal(canApplyReviewDecision('REJECTED', 'REJECT'), false)
})

test('并发审核模型覆盖八种竞态，REJECT 最终优先且副作用只执行一次', async () => {
  class SerializedReviewRow {
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    approveEffects = 0
    rejectEffects = 0
    rewardActive = false
    private tail = Promise.resolve()

    constructor(status: 'PENDING' | 'APPROVED' | 'REJECTED') {
      this.status = status
    }

    async decide(decision: 'APPROVE' | 'REJECT') {
      const previous = this.tail
      let release!: () => void
      this.tail = new Promise<void>((resolve) => { release = resolve })
      await previous
      try {
        if (this.status === 'REJECTED') {
          throw Object.assign(new Error('该内容已被拒绝，无法再次通过'), { code: decision === 'APPROVE' ? 'REVIEW_CONFLICT_REJECT_WINS' : 'ALREADY_REVIEWED' })
        }
        if (decision === 'APPROVE') {
          if (this.status !== 'PENDING') throw Object.assign(new Error('已处理'), { code: 'ALREADY_REVIEWED' })
          this.status = 'APPROVED'
          this.approveEffects += 1
          this.rewardActive = true
        } else {
          if (this.status !== 'PENDING' && this.status !== 'APPROVED') throw Object.assign(new Error('已处理'), { code: 'ALREADY_REVIEWED' })
          this.status = 'REJECTED'
          this.rejectEffects += 1
          this.rewardActive = false
        }
      } finally {
        release()
      }
    }
  }

  async function race(initial: SerializedReviewRow['status'], decisions: Array<'APPROVE' | 'REJECT'>) {
    const row = new SerializedReviewRow(initial)
    const results = await Promise.allSettled(decisions.map((decision) => row.decide(decision)))
    return { row, successCount: results.filter((result) => result.status === 'fulfilled').length, errorCodes: results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason.code) }
  }

  assert.equal((await race('PENDING', ['APPROVE'])).row.status, 'APPROVED')
  assert.equal((await race('PENDING', ['REJECT'])).row.status, 'REJECTED')
  assert.equal((await race('APPROVED', ['REJECT'])).row.status, 'REJECTED')
  assert.deepEqual((await race('REJECTED', ['APPROVE'])).errorCodes, ['REVIEW_CONFLICT_REJECT_WINS'])
  for (const decisions of [['APPROVE', 'REJECT'], ['REJECT', 'APPROVE']] as const) {
    const result = await race('PENDING', [...decisions])
    assert.equal(result.row.status, 'REJECTED')
    assert.equal(result.row.rewardActive, false)
  }
  const twoApproves = await race('PENDING', ['APPROVE', 'APPROVE'])
  assert.equal(twoApproves.row.status, 'APPROVED')
  assert.equal(twoApproves.successCount, 1)
  assert.equal(twoApproves.row.approveEffects, 1)
  const twoRejects = await race('PENDING', ['REJECT', 'REJECT'])
  assert.equal(twoRejects.row.status, 'REJECTED')
  assert.equal(twoRejects.successCount, 1)
  assert.equal(twoRejects.row.rejectEffects, 1)
  const approveThenReject = await race('APPROVED', ['APPROVE', 'REJECT'])
  assert.equal(approveThenReject.row.status, 'REJECTED')
  assert.equal(approveThenReject.successCount, 1)
})

test('所有统一审核类型都保留业务边界并使用服务端真实权限', () => {
  assert.deepEqual(reviewSourceDefinitions.map((item) => item.type), ['POST', 'SALON', 'CREATION', 'STICKER', 'CONCERT', 'TODAY'])
  assert.equal(parseReviewSourceType('post'), 'POST')
  assert.equal(parseReviewSourceType('studio'), 'CREATION')
  assert.equal(parseReviewSourceType('contributions'), 'CONCERT')
  assert.equal(parseReviewSourceType('unknown'), 'ALL')

  const centerRoute = read('app/api/admin/review/route.ts')
  const centerPage = read('app/admin/review/ReviewCenter.tsx')
  assert.match(centerRoute, /countType\(/)
  assert.match(centerRoute, /keyword/)
  assert.match(centerRoute, /PENDING.*APPROVED.*REJECTED/)
  assert.match(centerRoute, /REVIEW_CONFLICT_REJECT_WINS/)
  assert.match(centerRoute, /DELETE/)
  assert.match(centerPage, /审核中心/)
  assert.match(centerPage, /搜索标题 \/ 作者 \/ UID \/ 内容摘要/)
  assert.match(centerPage, /await load\(\)/)
  assert.match(centerPage, /item\.actions\.delete/)
})

test('真实审核 adapter 使用行锁与条件更新，避免并发重复副作用', () => {
  const routes = [
    'app/api/admin/posts/review/route.ts',
    'app/api/admin/salon/route.ts',
    'app/api/admin/studio/projects/route.ts',
    'app/api/admin/stickers/[id]/route.ts',
    'app/api/admin/today/[eventId]/route.ts',
    'lib/music-contributions.ts',
  ]
  for (const path of routes) {
    const source = read(path)
    assert.match(source, /FOR UPDATE/, `${path} must lock the review row`)
    assert.match(source, /updateMany/, `${path} must use a conditional update`)
  }
  const postRoute = read(routes[0])
  const salonRoute = read(routes[1])
  const studioRoute = read(routes[2])
  const concertService = read(routes[5])
  for (const source of [postRoute, salonRoute, studioRoute]) {
    assert.match(source, /REVIEW_CONFLICT_REJECT_WINS/)
  }
  assert.match(read('app/api/admin/review/route.ts'), /currentStatus === 'REJECTED' \? 'REVIEW_CONFLICT_REJECT_WINS'/)
  assert.match(postRoute, /reverseGrowthRewardForEvent/)
  assert.match(salonRoute, /reverseGrowthRewardForEvent/)
  assert.match(studioRoute, /reverseGrowthRewardForEvent/)
  assert.match(concertService, /status: \{ in: \['PENDING', 'APPROVED'\] \}/)
})

test('旧审核入口兼容跳转，非审核管理能力仍保留', () => {
  assert.match(read('app/admin/posts/review/page.tsx'), /redirect\('\/admin\/review\?type=post'\)/)
  assert.match(read('app/admin/stickers/page.tsx'), /进入表情包审核/)
  assert.doesNotMatch(read('components/AdminStickersTabs.tsx'), /StickerReviewManager/)
  assert.match(read('app/admin/salon/page.tsx'), /进入沙龙审核/)
  assert.match(read('app/admin/studio/page.tsx'), /进入创作审核/)
  assert.match(read('app/admin/today/page.tsx'), /进入今日内容审核/)
  assert.match(read('app/admin/salon/AdminSalonManager.tsx'), /showReviewActions = false/)
  assert.match(read('app/admin/today/TodayAdminManager.tsx'), /showReviewActions = false/)
  assert.doesNotMatch(read('app/admin/studio/StudioAdminPanel.tsx'), /review\(project\.id, 'APPROVED'\)/)
  assert.match(read('app/admin/music/concerts/contributions/AdminConcertContributionManager.tsx'), /showReviewActions \?/)
})
