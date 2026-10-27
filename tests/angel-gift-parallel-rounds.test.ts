import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { resolvePharmacyCampaigns, selectPharmacyCampaign } from '@/lib/pharmacy'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const now = new Date('2026-10-27T12:00:00.000Z')

function activeCampaign(id: string, startsAt: string) {
  return { id, status: 'ACTIVE' as const, startsAt: new Date(startsAt), endsAt: new Date('2026-12-01T00:00:00.000Z') }
}

test('multiple active campaigns remain selectable without changing either campaign', () => {
  const august = activeCampaign('august-round', '2026-08-01T00:00:00.000Z')
  const november = activeCampaign('november-round', '2026-10-01T00:00:00.000Z')
  const selection = resolvePharmacyCampaigns([august, november], now)
  assert.deepEqual(selection.activeCampaigns.map(({ id }) => id), ['november-round', 'august-round'])
  assert.equal(selectPharmacyCampaign(selection, 'august-round')?.id, 'august-round')
  assert.equal(selectPharmacyCampaign(selection, 'november-round')?.id, 'november-round')
  assert.equal(august.status, 'ACTIVE')
  assert.equal(november.status, 'ACTIVE')
})

test('page and draw endpoints use the explicitly selected campaign id', () => {
  const pageRoute = read('app/api/angel-gift/route.ts')
  const client = read('components/AngelGiftClient.tsx')
  assert.match(pageRoute, /searchParams\.get\('campaignId'\)[\s\S]*getPharmacyPageData\(auth\.user\?\.id, campaignId\)/u)
  assert.match(pageRoute, /executePharmacyDraws\(\{ userId: guard\.user\.id, campaignId, idempotencyKey, drawCount \}\)/u)
  assert.match(client, /data\.campaignOptions\.length > 1[\s\S]*data\.campaignOptions\.map/u)
  assert.match(client, /setSelectedCampaignId\(campaignId\)/u)
  assert.match(client, /fetch\(`\/api\/angel-gift\?campaignId=\$\{encodeURIComponent\(campaignId\)\}`/u)
  assert.match(client, /if \(requestId === selectionRequestRef\.current && selectedCampaignIdRef\.current === campaignId\) setData\(payload\.data\)/u)
})

test('campaign-specific draw state prevents parallel duplicate requests and retains uncertain idempotency keys', () => {
  const client = read('components/AngelGiftClient.tsx')
  const drawStart = client.indexOf('async function draw(')
  const drawEnd = client.indexOf('function isDrawConfirmationSuppressedToday', drawStart)
  const draw = client.slice(drawStart, drawEnd)
  assert.ok(drawStart >= 0 && drawEnd > drawStart)
  assert.match(client, /drawInFlightByCampaignRef = useRef\(new Set<string>\(\)\)/u)
  assert.match(draw, /drawInFlightByCampaignRef\.current\.has\(campaign\.id\)/u)
  assert.match(draw, /drawInFlightByCampaignRef\.current\.add\(campaignId\)/u)
  assert.match(draw, /drawInFlightByCampaignRef\.current\.delete\(campaignId\)/u)
  assert.match(draw, /if \(!pending && !persistPendingDrawRequest\(user\.id, campaignId, request\)\)[\s\S]*return/u)
  assert.match(draw, /response\.status < 500 && payload\.code !== 'IDEMPOTENCY_KEY_INVALID'/u)
  assert.match(draw, /uncertainOutcome \? `\$\{message\} 抽奖结果尚未确认/u)
  assert.doesNotMatch(draw, /window\.location\.reload|router\.refresh\(/u)
})

test('draw idempotency records are unique per user and batch keys are bound to campaign', () => {
  const schema = read('prisma/schema.prisma')
  const pharmacy = read('lib/pharmacy.ts')
  const drawStart = pharmacy.indexOf('export async function executePharmacyDraws')
  const drawEnd = pharmacy.indexOf('export async function executePharmacyDraw(', drawStart)
  const draw = pharmacy.slice(drawStart, drawEnd)
  assert.match(schema, /model PharmacyDraw \{[\s\S]*@@unique\(\[userId, idempotencyKey\]\)/u)
  assert.match(draw, /lockUser\(tx, input\.userId\)[\s\S]*idempotencyKey: \{ in: allKeys \}/u)
  assert.match(draw, /existingRows\.some\(\(row\) => row\.campaignId !== campaignId\)/u)
  assert.match(draw, /existingRows\.length !== drawCount/u)
  assert.match(draw, /lockCampaign\(tx, campaignId\)/u)
  assert.match(draw, /where: \{ userId: input\.userId, campaignId: campaign\.id/u)
  assert.match(draw, /userId_campaignId: \{ userId: input\.userId, campaignId: campaign\.id \}/u)
})

test('creating a campaign does not deactivate or rewrite existing rounds', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const createStart = pharmacy.indexOf('export async function createPharmacyCampaign')
  const createEnd = pharmacy.indexOf('export async function updatePharmacyCampaign', createStart)
  const create = pharmacy.slice(createStart, createEnd)
  assert.ok(createStart >= 0 && createEnd > createStart)
  assert.match(create, /tx\.pharmacyCampaign\.create\(/u)
  assert.doesNotMatch(create, /pharmacyCampaign\.updateMany|pharmacyCampaign\.deleteMany|status: 'ENDED'/u)
  assert.match(pharmacy, /where: \{ campaignId, enabled: true \}/u)
})

test('legacy batch recycle requests only infer a round when exactly one campaign is active', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const resolverStart = pharmacy.indexOf('async function resolveLegacyRecycleCampaignId')
  const resolverEnd = pharmacy.indexOf('function assertCampaignAllowsDraw', resolverStart)
  const resolver = pharmacy.slice(resolverStart, resolverEnd)
  const recycleStart = pharmacy.indexOf('export async function recycleAllPharmacyDuplicates')
  const recycleEnd = pharmacy.indexOf('type PublicCampaignRow', recycleStart)
  const recycle = pharmacy.slice(recycleStart, recycleEnd)
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart)
  assert.match(resolver, /resolvePharmacyCampaigns\(rows, now\)\.activeCampaigns/u)
  assert.match(resolver, /activeCampaigns\.length > 1[\s\S]*CAMPAIGN_SELECTION_REQUIRED/u)
  assert.match(recycle, /if \(existing\)[\s\S]*requestedCampaignId && existing\.campaignId !== requestedCampaignId/u)
  assert.match(recycle, /requestedCampaignId \|\| await resolveLegacyRecycleCampaignId\(tx, now\)/u)
  assert.match(recycle, /const campaignId = requestedCampaignId[\s\S]*lockCampaign\(tx, campaignId\)/u)
})

test('campaign selection cache and result cache are keyed by campaign id, not a singleton round', () => {
  const client = read('components/AngelGiftClient.tsx')
  assert.match(client, /new Map<string, PharmacyPageData>\(initialData\.campaign \? \[\[initialData\.campaign\.id, initialData\]\] : \[\]\)/u)
  assert.match(client, /Record<string, PharmacyDrawView\[\]>/u)
  assert.match(client, /setResultsByCampaign\(\(current\) => \(\{ \.\.\.current, \[campaignId\]: nextDraws \}\)\)/u)
  assert.match(client, /const campaign = data\.campaign\?\.id === selectedCampaignId \? data\.campaign : null/u)
  assert.doesNotMatch(client, /window\.location\.reload|router\.refresh\(/u)
})

test('late operations from another round cannot leak status messages or reset the selected history page', () => {
  const client = read('components/AngelGiftClient.tsx')
  assert.match(client, /if \(selectedCampaignIdRef\.current === campaignId\) \{\s*setError\(uncertainOutcome/u)
  assert.match(client, /if \(selectedCampaignIdRef\.current === campaignId\) setError\(caught instanceof Error \? caught\.message : '余药回收暂时无法完成'\)/u)
  assert.match(client, /if \(selectedCampaignIdRef\.current === campaignId\) \{\s*setHistoryPage\(1\)\s*setRecycleSuccess/u)
  assert.match(client, /const \[recycleBusyByCampaign, setRecycleBusyByCampaign\]/u)
  assert.match(client, /recycleBusyByCampaign\[campaign\.id\]/u)
})
