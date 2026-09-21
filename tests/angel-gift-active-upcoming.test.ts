import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { PharmacyCampaignStatus } from '@prisma/client'
import { effectivePharmacyCampaignStatus, resolvePharmacyCampaigns } from '@/lib/pharmacy'

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

test('本期药柜、collection、余药和执药上下文均绑定 active，不读取 upcoming 奖池', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const client = read('components/AngelGiftClient.tsx')
  assert.match(pharmacy, /resolveVisibleAngelGiftCollection\(\{ userId, campaignId: campaign\.id, now \}\)/u)
  assert.match(pharmacy, /pharmacyDuplicateInventory\.findMany\(\{ where: \{ userId, campaignId: campaign\.id/u)
  assert.match(pharmacy, /getPharmacyHistoryPage\(userId, campaign\.id\)/u)
  assert.match(pharmacy, /const upcomingCampaign = serializeUpcomingCampaign\(selection\.upcomingCampaign\)/u)
  assert.match(client, /const upcomingCampaign = data\.upcomingCampaign/u)
  assert.match(client, /本期药柜/u)
  assert.match(client, /angel-gift-upcoming-card/u)
})

test('药房顶部先展示下期预告，再展示本期主题，标签框保持直角描边并提升可读性', () => {
  const client = read('components/AngelGiftClient.tsx')
  const styles = read('app/globals.css')
  const upcomingIndex = client.indexOf('{upcomingPreview}')
  const currentIndex = client.indexOf('<section className="angel-gift-theme-card" aria-labelledby="angel-gift-theme-title">')
  assert.ok(upcomingIndex >= 0 && currentIndex > upcomingIndex)
  assert.match(styles, /\.angel-gift-theme-card \.angel-gift-label \{[^}]*border:1px solid var\(--angel-red\)[^}]*font-size:13px[^}]*font-weight:900[^}]*white-space:nowrap/u)
})

test('未来主题的单抽、5 连抽、10 连抽都会在扣费和写入前拒绝', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const drawStart = pharmacy.indexOf('export async function executePharmacyDraws')
  const drawEnd = pharmacy.indexOf('export async function executePharmacyDraw(', drawStart)
  const drawBody = pharmacy.slice(drawStart, drawEnd)
  assert.ok(drawStart >= 0 && drawEnd > drawStart)
  assert.match(drawBody, /assertCampaignAllowsDraw\(campaign, now\)[\s\S]*assertCampaignIsCurrent\(campaign\.id, await findActivePharmacyCampaignId\(tx, now\)\)/u)
  assert.ok(drawBody.indexOf('assertCampaignIsCurrent') < drawBody.indexOf('getEnabledPrizePool'))
  assert.ok(drawBody.indexOf('assertCampaignIsCurrent') < drawBody.indexOf('consumeRegistrationFee'))
  assert.ok(drawBody.indexOf('assertCampaignIsCurrent') < drawBody.indexOf('pharmacyDraw.create'))
  assert.match(pharmacy, /parsePharmacyDrawCount\(input\.drawCount\)/u)
  assert.match(pharmacy, /for \(let index = 0; index < drawCount; index \+= 1\)/u)
})
