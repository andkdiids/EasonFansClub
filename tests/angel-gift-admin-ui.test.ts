import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { calculateAngelGiftPrizePreview, parseAngelGiftPositiveInteger } from '@/lib/angel-gift-admin-preview'
import { resolveBadgeAcquisitionDescription } from '@/lib/badge-acquisition'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const angelGiftManager = read('app/admin/angel-gift/AngelGiftAdminManager.tsx')
const pharmacy = read('lib/pharmacy.ts')
const badgeService = read('lib/badge-service.ts')
const badgeAdminManager = read('app/admin/badges/BadgeAdminManager.tsx')

test('后台奖池有两个明确的添加入口', () => {
  assert.match(angelGiftManager, /添加勋章/)
  assert.match(angelGiftManager, /添加挂号费/)
  assert.doesNotMatch(angelGiftManager, /奖品类型[\s\S]{0,300}<select/)
})

test('Badge selector 使用 checkbox 多选并展示完整 Badge 信息', () => {
  assert.match(angelGiftManager, /type="checkbox"/)
  assert.match(angelGiftManager, /selectedBadgeIds/)
  assert.match(angelGiftManager, /badge\.name/)
  assert.match(angelGiftManager, /badge\.code/)
  assert.match(angelGiftManager, /badge\.rarity/)
  assert.match(angelGiftManager, /badge\.iconUrl/)
  assert.match(angelGiftManager, /acquisitionText\(badge\.acquisitionDescription\)/)
  assert.match(angelGiftManager, /暂无自动获取规则/)
})

test('Badge selector 使用一次 badgeIds 批量提交并阻止当前主题重复项', () => {
  assert.match(angelGiftManager, /badgeIds: selectedBadgeIds/)
  assert.match(angelGiftManager, /joinedBadgeIds\.has\(badge\.id\)/)
  assert.match(angelGiftManager, /disabled=\{joined\}/)
  assert.match(angelGiftManager, /createPharmacyPrizes|campaigns\/\$\{selectedId\}\/prizes/)
})

test('POINTS 表单支持任意多条自定义金额', () => {
  assert.match(angelGiftManager, /添加挂号费奖品/)
  assert.match(angelGiftManager, /奖励挂号费/)
  assert.match(angelGiftManager, /rewardAmount/)
  assert.match(angelGiftManager, /同一主题可以添加任意多条不同金额的 POINTS Prize/)
})

test('每个 Prize 都有独立草稿 weight、enabled 和操作列', () => {
  assert.match(angelGiftManager, /prizeDrafts\[prize\.id\]/)
  assert.match(angelGiftManager, /updatePrizeDraft\(prize\.id, \{ weight:/)
  assert.match(angelGiftManager, /updatePrizeDraft\(prize\.id, \{ enabled:/)
  for (const heading of ['奖品', '类型', '内容', '权重', '概率', '状态', '操作']) assert.match(angelGiftManager, new RegExp(heading))
})

test('实时概率预览按当前 enabled 权重计算，不使用服务端开奖结果', () => {
  const initial = calculateAngelGiftPrizePreview([
    { id: 'a', weight: '5', enabled: true },
    { id: 'b', weight: '15', enabled: true },
    { id: 'c', weight: '80', enabled: true },
  ])
  assert.equal(initial.totalWeight, 100)
  assert.deepEqual(initial.rows.map((row) => row.probability), [5, 15, 80])

  const changed = calculateAngelGiftPrizePreview([
    { id: 'a', weight: '10', enabled: true },
    { id: 'b', weight: '15', enabled: true },
    { id: 'c', weight: '80', enabled: true },
  ])
  assert.ok(Math.abs(changed.rows[0].probability - 9.5238095238) < 0.000001)
  assert.ok(Math.abs(changed.rows[1].probability - 14.2857142857) < 0.000001)
  assert.ok(Math.abs(changed.rows[2].probability - 76.1904761904) < 0.000001)
  assert.match(angelGiftManager, /calculateAngelGiftPrizePreview\(previewInputs\)/)
  assert.match(angelGiftManager, /真正开奖仍由服务器 calculatePharmacyProbability \/ chooseWeightedPharmacyPrize 决定/)
})

test('disabled Prize 不计入前端概率预览且不会产生非有限数字', () => {
  const preview = calculateAngelGiftPrizePreview([
    { id: 'enabled', weight: '5', enabled: true },
    { id: 'disabled', weight: '95', enabled: false },
  ])
  assert.equal(preview.totalWeight, 5)
  assert.equal(preview.rows[0].probability, 100)
  assert.equal(preview.rows[1].probability, 0)
  assert.ok(preview.rows.every((row) => Number.isFinite(row.probability)))
})

test('非法 weight 立即判定为无效并阻止提交', () => {
  for (const value of ['', '0', '-1', '1.5', 'NaN', Number.NaN]) assert.equal(parseAngelGiftPositiveInteger(value), null)
  assert.equal(parseAngelGiftPositiveInteger('1'), 1)
  assert.match(angelGiftManager, /权重必须是正整数/)
  assert.match(angelGiftManager, /disabled=\{busy \|\| !selectedBadgeIds\.length \|\| !currentPrizeFormValid\}/)
  assert.match(angelGiftManager, /不存在有效启用奖品|没有有效启用奖品/)
})

test('不同 Theme 的 Prize 查询严格使用 campaignId 隔离', () => {
  assert.match(pharmacy, /pharmacyCampaign\.findUnique\(\{ where: \{ id: campaignId \}/)
  assert.match(pharmacy, /pharmacyDraw\.count\(\{ where: \{ campaignId \}/)
  assert.match(pharmacy, /getEnabledPrizePool\(db, campaignId\)/)
  assert.match(pharmacy, /where: \{ campaignId, enabled: true \}/)
})

test('Angel Gift Badge 来源由管理端动态 resolver 派生，后台实际渲染 resolved 结果', () => {
  assert.match(badgeService, /badgeAdminDisplaySelect/)
  assert.match(badgeService, /badgeAdminDisplaySelect[\s\S]*PharmacyPrize:[\s\S]*type: 'BADGE'/)
  assert.match(badgeService, /resolveAdminBadgeAcquisition/)
  assert.match(badgeAdminManager, /resolvedAcquisitionDescription/)
  assert.match(badgeAdminManager, /当前最终获取方式/)
  assert.match(badgeAdminManager, /当前获取方式：\{badge\.resolvedAcquisitionDescription/)
})

test('Badge 的其他来源在 resolver 中保留，并按最后有效来源清理 Angel Gift 文案', () => {
  const withOtherRule = resolveBadgeAcquisitionDescription({ storedDescription: '参加活动后获得', hasAngelGiftPrize: true })
  assert.equal(withOtherRule, '参加活动后获得\n于「天使的礼物」执药获得')
  const afterLastPool = resolveBadgeAcquisitionDescription({ storedDescription: '参加活动后获得', hasAngelGiftPrize: false })
  assert.equal(afterLastPool, '参加活动后获得')
  const angelGiftOnlyRemoved = resolveBadgeAcquisitionDescription({ storedDescription: '于「天使的礼物」执药获得', hasAngelGiftPrize: false })
  assert.equal(angelGiftOnlyRemoved, null)
})

test('服务器仍控制实际开奖概率和加权选择', () => {
  assert.match(pharmacy, /function calculatePharmacyProbability|export function calculatePharmacyProbability/)
  assert.match(pharmacy, /function chooseWeightedPharmacyPrize|export function chooseWeightedPharmacyPrize/)
  assert.match(pharmacy, /randomInt\(pool\.totalWeight\)/)
  assert.match(angelGiftManager, /真正开奖仍由服务器/)
})
