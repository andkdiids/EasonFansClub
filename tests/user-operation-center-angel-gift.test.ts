import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateAngelGiftCampaignStats } from '../lib/user-operation-center'

const date = (value: string) => new Date(value)

test('天使的礼物按 campaignId 分组，5/10 连抽按真实 Draw 行数统计', () => {
  const stats = aggregateAngelGiftCampaignStats({
    draws: [
      { campaignId: 'campaign-a', drawCount: 16, drawCostTotal: 160, firstDrawAt: date('2026-09-01T01:00:00.000Z'), lastDrawAt: date('2026-09-03T01:00:00.000Z') },
      { campaignId: 'campaign-b', drawCount: 6, drawCostTotal: 60, firstDrawAt: date('2026-09-10T01:00:00.000Z'), lastDrawAt: date('2026-09-11T01:00:00.000Z') },
    ],
    recycles: [
      { campaignId: 'campaign-a', duplicateRecycleCount: 4 },
      { campaignId: 'campaign-b', duplicateRecycleCount: 2 },
    ],
    campaigns: [
      { id: 'campaign-a', title: '同名主题', status: 'ENDED', startsAt: date('2026-08-01T00:00:00.000Z'), endsAt: date('2026-09-05T00:00:00.000Z') },
      { id: 'campaign-b', title: '同名主题', status: 'ACTIVE', startsAt: date('2026-09-10T00:00:00.000Z'), endsAt: date('2026-10-05T00:00:00.000Z') },
    ],
    now: date('2026-09-18T00:00:00.000Z'),
  })

  assert.deepEqual(stats.map((campaign) => campaign.campaignId), ['campaign-b', 'campaign-a'])
  assert.deepEqual(stats.map((campaign) => campaign.drawCount), [6, 16])
  assert.deepEqual(stats.map((campaign) => campaign.duplicateRecycleCount), [2, 4])
  assert.equal(stats[1]?.firstDrawAt, '2026-09-01T01:00:00.000Z')
  assert.equal(stats[1]?.lastDrawAt, '2026-09-03T01:00:00.000Z')
  assert.equal(stats[0]?.firstDrawAt, '2026-09-10T01:00:00.000Z')
  assert.equal(stats[0]?.lastDrawAt, '2026-09-11T01:00:00.000Z')
  assert.equal(stats[1]?.status, 'ENDED')
  assert.equal(stats[0]?.status, 'ACTIVE')
})

test('没有真实 PharmacyDraw 的 UPCOMING、DRAFT 不会进入参与主题', () => {
  const stats = aggregateAngelGiftCampaignStats({
    draws: [
      { campaignId: 'active', drawCount: 1, drawCostTotal: 10, firstDrawAt: date('2026-09-18T01:00:00.000Z'), lastDrawAt: date('2026-09-18T01:00:00.000Z') },
    ],
    recycles: [
      { campaignId: 'upcoming', duplicateRecycleCount: 3 },
      { campaignId: 'draft', duplicateRecycleCount: 2 },
    ],
    campaigns: [
      { id: 'active', title: '本期主题', status: 'ACTIVE', startsAt: date('2026-09-01T00:00:00.000Z'), endsAt: date('2026-10-01T00:00:00.000Z') },
      { id: 'upcoming', title: '下期主题', status: 'SCHEDULED', startsAt: date('2026-10-01T00:00:00.000Z'), endsAt: date('2026-11-01T00:00:00.000Z') },
      { id: 'draft', title: '草稿主题', status: 'DRAFT', startsAt: date('2026-10-01T00:00:00.000Z'), endsAt: date('2026-11-01T00:00:00.000Z') },
    ],
    now: date('2026-09-18T00:00:00.000Z'),
  })

  assert.equal(stats.length, 1)
  assert.equal(stats[0]?.campaignId, 'active')
  assert.equal(stats[0]?.duplicateRecycleCount, 0)
})
