import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { isPharmacyPublicPrizePoolUsable, resolvePharmacyCampaigns } from '@/lib/pharmacy'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

test('round card source is the server-filtered active list with a stable resolver order', () => {
  const now = new Date('2026-10-28T00:00:00.000Z')
  const rows = [
    { id: 'older', status: 'ACTIVE' as const, startsAt: new Date('2026-10-01T00:00:00.000Z'), endsAt: new Date('2026-11-01T00:00:00.000Z'), createdAt: new Date('2026-10-01T00:00:00.000Z') },
    { id: 'newer', status: 'ACTIVE' as const, startsAt: new Date('2026-10-20T00:00:00.000Z'), endsAt: new Date('2026-12-01T00:00:00.000Z'), createdAt: new Date('2026-10-20T00:00:00.000Z') },
    { id: 'future', status: 'SCHEDULED' as const, startsAt: new Date('2026-11-01T00:00:00.000Z'), endsAt: new Date('2026-12-01T00:00:00.000Z'), createdAt: new Date('2026-10-25T00:00:00.000Z') },
    { id: 'ended', status: 'ENDED' as const, startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: new Date('2026-10-20T00:00:00.000Z'), createdAt: new Date('2026-10-01T00:00:00.000Z') },
    { id: 'paused', status: 'PAUSED' as const, startsAt: new Date('2026-10-01T00:00:00.000Z'), endsAt: new Date('2026-11-01T00:00:00.000Z'), createdAt: new Date('2026-10-01T00:00:00.000Z') },
  ]
  const selection = resolvePharmacyCampaigns(rows, now)
  assert.deepEqual(selection.activeCampaigns.map(({ id }) => id), ['newer', 'older'])

  const pharmacy = read('lib/pharmacy.ts')
  const pageData = pharmacy.slice(pharmacy.indexOf('export async function getPharmacyPageData'), pharmacy.indexOf('export async function getAdminPharmacyCampaigns'))
  assert.match(pageData, /selection\.activeCampaigns\.filter\(\(candidate\) => isCampaignPrizePoolUsable\(candidate\.PharmacyPrize\)\)/u)
  assert.match(pageData, /const campaign = campaignId \? selectPharmacyCampaign\(selection, campaignId\) : selectableCampaigns\[0\] \|\| null/u)
  assert.match(pageData, /const campaignOptions = selectableCampaigns\.map\(/u)
  assert.doesNotMatch(pageData, /selection\.campaigns\.map\(\(option\) => serializeCampaignOption/u)
})

test('only a nonempty, safe-weight, supported prize pool is eligible for a participation card', () => {
  const valid = [{ enabled: true, type: 'POINTS', weight: 10, rewardAmount: 5, badgeUsable: false }]
  const pharmacy = read('lib/pharmacy.ts')
  assert.equal(isPharmacyPublicPrizePoolUsable(valid), true)
  assert.equal(isPharmacyPublicPrizePoolUsable([]), false)
  assert.equal(isPharmacyPublicPrizePoolUsable([{ ...valid[0], enabled: false }]), false)
  assert.equal(isPharmacyPublicPrizePoolUsable([{ ...valid[0], type: 'UNKNOWN' }]), false)
  assert.equal(isPharmacyPublicPrizePoolUsable([{ ...valid[0], weight: Number.MAX_SAFE_INTEGER }, { ...valid[0], weight: 1 }]), false)
  assert.match(pharmacy, /return Number\.isSafeInteger\(totalWeight\) && totalWeight > 0/u)
})

test('round cards expose current selection and live participation details without a native select', () => {
  const client = read('components/AngelGiftClient.tsx')
  const styles = read('app/globals.css')
  assert.match(client, /<div className="angel-gift-campaign-grid">[\s\S]*data\.campaignOptions\.map/u)
  assert.match(client, /aria-pressed=\{selected\}/u)
  assert.match(client, /当前主题/u)
  assert.match(client, /option\.title[\s\S]*option\.subtitle[\s\S]*option\.description/u)
  assert.match(client, /formatFee\(option\.drawCost\)[\s\S]*formatDate\(option\.endsAt, true\)/u)
  assert.match(client, /当前暂无进行中的抽奖主题/u)
  assert.match(client, /本期次数已用完/u)
  assert.match(client, /今日次数已用完/u)
  assert.match(client, /onClick=\{\(\) => void selectCampaign\(option\.id\)\}/u)
  assert.match(client, /angel-gift-campaign-card-image/u)
  assert.doesNotMatch(client, /<select[^>]*angel-gift-campaign/u)
  assert.match(styles, /\.angel-gift-campaign-grid \{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,300px\),1fr\)\)/u)
  assert.match(styles, /\.angel-gift-campaign-card:focus-visible/u)
  assert.match(styles, /\.angel-gift-campaign-card\.is-selected/u)
  assert.match(styles, /\.angel-gift-campaign-grid \{ grid-template-columns:minmax\(0,1fr\);/u)
})

test('theme cards have white unselected state, dark selected state, and no duplicate current-theme panel', () => {
  const client = read('components/AngelGiftClient.tsx')
  const styles = read('app/globals.css')
  assert.match(styles, /--angel-gift-card-bg:#fff/u)
  assert.match(styles, /--angel-gift-card-border:#e5e7eb/u)
  assert.match(styles, /\.angel-gift-campaign-card \{[^}]*background:var\(--angel-gift-card-bg\)/u)
  assert.match(styles, /\.angel-gift-campaign-card\.is-selected \{[^}]*background:var\(--angel-gift-card-selected-bg\)/u)
  assert.match(styles, /--angel-gift-card-selected-bg:linear-gradient\(132deg,var\(--angel-red-deep\)/u)
  assert.match(client, /aria-pressed=\{selected\}/u)
  assert.match(client, /className=\{`angel-gift-campaign-card\$\{selected \? ' is-selected' : ''\}/u)
  assert.doesNotMatch(client, /aria-labelledby="angel-gift-theme-title"|<span className="angel-gift-label">本期主题<\/span>/u)
  assert.match(client, /当前主题/u)
})

test('a switch applies only the last requested round, and expired selections refresh from the server', () => {
  const client = read('components/AngelGiftClient.tsx')
  const start = client.indexOf('async function selectCampaign(')
  const end = client.indexOf('async function draw(', start)
  const select = client.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(select, /requestId === selectionRequestRef\.current && selectedCampaignIdRef\.current === campaignId/u)
  assert.match(select, /payload\?\.data\?\.campaignOptions\.find\(\(option\) => option\.id === campaignId\)/u)
  assert.match(select, /selectedCampaign\.status !== 'ACTIVE' \|\| !selectedCampaign\.prizePoolValid/u)
  assert.match(select, /fetch\('\/api\/angel-gift', \{ cache: 'no-store' \}\)/u)
  assert.match(select, /selectedCampaignIdRef\.current = fallbackId/u)
  assert.match(select, /selectedRoundExpired = true/u)
  assert.match(select, /selectedRoundExpired\)[\s\S]*campaign: null, campaignOptions: \[\]/u)
  assert.match(select, /const previousCampaignId = data\.campaign\?\.id \|\| ''/u)
  assert.match(select, /finally \{\s*if \(requestId === selectionRequestRef\.current\) setCampaignLoading\(false\)/u)
  assert.match(client, /const campaign = data\.campaign\?\.id === selectedCampaignId \? data\.campaign : null/u)
})

test('draw remains scoped to selected campaign and keeps its existing idempotency guard', () => {
  const client = read('components/AngelGiftClient.tsx')
  const route = read('app/api/angel-gift/route.ts')
  const pharmacy = read('lib/pharmacy.ts')
  assert.match(client, /body: JSON\.stringify\(\{ campaignId, idempotencyKey: request\.key, drawCount: requestedCount \}\)/u)
  assert.match(client, /drawInFlightByCampaignRef\.current\.has\(campaign\.id\)/u)
  assert.match(route, /executePharmacyDraws\(\{ userId: guard\.user\.id, campaignId, idempotencyKey, drawCount \}\)/u)
  assert.match(pharmacy, /assertCampaignAllowsDraw\(campaign, now\)/u)
  assert.match(pharmacy, /existingRows\.some\(\(row\) => row\.campaignId !== campaignId\)/u)
  assert.doesNotMatch(client, /window\.location\.reload|router\.refresh\(/u)
})
