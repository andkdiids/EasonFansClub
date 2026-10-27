import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { PharmacyCampaignStatus } from '@prisma/client'
import { effectivePharmacyCampaignStatus, resolvePharmacyCampaigns, selectPharmacyCampaign } from '@/lib/pharmacy'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const now = new Date('2026-09-18T12:00:00.000Z')

function campaign(input: { id: string; status?: PharmacyCampaignStatus; startsAt: string | null; endsAt: string | null; createdAt?: string }) {
  return {
    id: input.id,
    status: input.status || 'SCHEDULED',
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    createdAt: new Date(input.createdAt || '2026-09-01T00:00:00.000Z'),
  }
}

test('ACTIVE 优先按真实时间窗口选择，不会被未来已发布主题覆盖', () => {
  const active = campaign({ id: 'campaign-a', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' })
  const upcoming = campaign({ id: 'campaign-z', status: 'ACTIVE', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-09-18T13:00:00.000Z' })
  const resolved = resolvePharmacyCampaigns([active, upcoming], now)
  assert.equal(resolved.activeCampaign?.id, 'campaign-a')
  assert.equal(resolved.upcomingCampaign?.id, 'campaign-z')
})

test('多期 ACTIVE 同时保留并按 campaignId 独立选择', () => {
  const first = campaign({ id: 'campaign-august', status: 'ACTIVE', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' })
  const second = campaign({ id: 'campaign-november', status: 'ACTIVE', startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' })
  const resolved = resolvePharmacyCampaigns([first, second], now)
  assert.deepEqual(resolved.activeCampaigns.map(({ id }) => id), ['campaign-november', 'campaign-august'])
  assert.equal(selectPharmacyCampaign(resolved, 'campaign-august')?.id, 'campaign-august')
  assert.equal(selectPharmacyCampaign(resolved, 'campaign-november')?.id, 'campaign-november')
  assert.equal(selectPharmacyCampaign(resolved)?.id, 'campaign-november')
})

test('创建时间更新、ID 更大或状态显示已发布都不改变 ACTIVE 选择', () => {
  const active = campaign({ id: 'campaign-a', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' })
  const future = campaign({ id: 'campaign-b', status: 'SCHEDULED', startsAt: '2026-09-20T00:00:00.000Z', endsAt: '2026-10-20T00:00:00.000Z', createdAt: '2026-09-19T00:00:00.000Z' })
  const resolved = resolvePharmacyCampaigns([active, future], now)
  assert.equal(resolved.activeCampaign?.id, 'campaign-a')
  assert.equal(resolved.upcomingCampaign?.id, 'campaign-b')
})

test('草稿和已结束主题不会成为 ACTIVE 或 UPCOMING', () => {
  const active = campaign({ id: 'campaign-a', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' })
  const draft = campaign({ id: 'campaign-draft', status: 'DRAFT', startsAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z' })
  const ended = campaign({ id: 'campaign-ended', status: 'ENDED', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-10T00:00:00.000Z' })
  const expiredFuture = campaign({ id: 'campaign-expired-future', status: 'SCHEDULED', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-09-10T00:00:00.000Z' })
  const resolved = resolvePharmacyCampaigns([active, draft, ended, expiredFuture], now)
  assert.equal(resolved.activeCampaign?.id, 'campaign-a')
  assert.equal(resolved.upcomingCampaign, null)
})

test('多个 UPCOMING 按 startAt ASC 取最近一期，只有 UPCOMING 时不伪造本期', () => {
  const first = campaign({ id: 'campaign-october', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' })
  const second = campaign({ id: 'campaign-november', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' })
  const third = campaign({ id: 'campaign-december', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' })
  const resolved = resolvePharmacyCampaigns([third, second, first], now)
  assert.equal(resolved.activeCampaign, null)
  assert.equal(resolved.upcomingCampaign?.id, 'campaign-october')
})

test('时间边界按现有 Date 语义切换，startAt 等于 now 即为 ACTIVE', () => {
  const previous = campaign({ id: 'campaign-a', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' })
  const next = campaign({ id: 'campaign-b', status: 'SCHEDULED', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' })
  const before = resolvePharmacyCampaigns([previous, next], new Date('2026-09-30T23:59:59.000Z'))
  const atStart = resolvePharmacyCampaigns([previous, next], new Date('2026-10-01T00:00:00.000Z'))
  assert.equal(before.activeCampaign?.id, 'campaign-a')
  assert.equal(before.upcomingCampaign?.id, 'campaign-b')
  assert.equal(atStart.activeCampaign?.id, 'campaign-b')
  assert.equal(atStart.upcomingCampaign, null)
})

test('后台未来主题即使是 PAUSED 也显示待开始，与前台 resolver 共享时间语义', () => {
  assert.equal(effectivePharmacyCampaignStatus({ status: 'PAUSED', startsAt: new Date('2026-10-01T00:00:00.000Z'), endsAt: new Date('2026-11-01T00:00:00.000Z') }, now), 'SCHEDULED')
})

test('所选主题的药柜、collection、余药和执药上下文均绑定 campaignId', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const client = read('components/AngelGiftClient.tsx')
  assert.match(pharmacy, /resolveVisibleAngelGiftCollection\(\{ userId, campaignId: campaign\.id, now \}\)/u)
  assert.match(pharmacy, /pharmacyDuplicateInventory\.findMany\(\{ where: \{ userId, campaignId: campaign\.id/u)
  assert.match(pharmacy, /getPharmacyHistoryPage\(userId, campaign\.id\)/u)
  assert.match(pharmacy, /const campaign = campaignId \? selectPharmacyCampaign\(selection, campaignId\) : selectableCampaigns\[0\] \|\| null/u)
  assert.match(pharmacy, /selection\.activeCampaigns\.filter\(\(candidate\) => isCampaignPrizePoolUsable\(candidate\.PharmacyPrize\)\)/u)
  assert.match(pharmacy, /campaignOptions: PharmacyCampaignOption\[\]/u)
  assert.match(client, /const upcomingCampaign = data\.upcomingCampaign/u)
  assert.match(client, /\?campaignId=\$\{encodeURIComponent\(campaignId\)\}/u)
  assert.match(client, /本期药柜/u)
  assert.match(client, /angel-gift-upcoming-card/u)
})

test('当前主题信息由主题卡承载，移除重复面板并保留下期预告', () => {
  const client = read('components/AngelGiftClient.tsx')
  const styles = read('app/globals.css')
  const upcomingIndex = client.indexOf('{upcomingPreview}')
  const selectorIndex = client.indexOf('<section className="angel-gift-campaign-selector"')
  const drawAreaIndex = client.indexOf('<section className={`angel-gift-pharmacy-box')
  assert.ok(selectorIndex >= 0 && upcomingIndex > selectorIndex && drawAreaIndex > upcomingIndex)
  assert.doesNotMatch(client, /aria-labelledby="angel-gift-theme-title"|本期主题/u)
  assert.match(client, /angel-gift-theme-card angel-gift-upcoming-card/u)
  assert.match(styles, /\.angel-gift-theme-card \{/u)
  assert.match(styles, /\.angel-gift-upcoming-card \{/u)
})

test('服务端按所选主题自身的时间与状态门禁拒绝未来主题，且不再要求全局唯一 active', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const drawStart = pharmacy.indexOf('export async function executePharmacyDraws')
  const drawEnd = pharmacy.indexOf('export async function executePharmacyDraw(', drawStart)
  const drawBody = pharmacy.slice(drawStart, drawEnd)
  assert.ok(drawStart >= 0 && drawEnd > drawStart)
  assert.match(drawBody, /assertCampaignAllowsDraw\(campaign, now\)[\s\S]*getEnabledPrizePool\(tx, campaign\.id\)/u)
  assert.doesNotMatch(drawBody, /findActivePharmacyCampaignId|assertCampaignIsCurrent/u)
  assert.ok(drawBody.indexOf('assertCampaignAllowsDraw') < drawBody.indexOf('consumeRegistrationFee'))
  assert.ok(drawBody.indexOf('assertCampaignAllowsDraw') < drawBody.indexOf('pharmacyDraw.create'))
  assert.match(pharmacy, /parsePharmacyDrawCount\(input\.drawCount\)/u)
  assert.match(pharmacy, /for \(let index = 0; index < drawCount; index \+= 1\)/u)
})
