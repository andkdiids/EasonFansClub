import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApifyInstagramProvider } from '@/lib/instagram/apify-provider'
import { inspectInstagramMediaUrl } from '@/lib/instagram/media'
import { assertSafePocDatabaseTarget } from '@/lib/instagram/poc-safety'
import { normalizeInstagramUsername, type InstagramPost, type InstagramProvider, type InstagramProviderTrace } from '@/lib/instagram/types'

const TARGET_USERNAME = 'mreasonchan'
const RUN_ID = 'ZPe8pXaJBhoR6mVkc'
const DATASET_ID = 'hvQuCr1zteLgO7qYi'
const ACTOR = 'apify/instagram-scraper'
const MEDIA_ALLOWLIST = '.cdninstagram.com,.fbcdn.net'
const MAX_MEDIA_CHECKS = 5

function loadEnvFile(filename: string) {
  try {
    const parsed = dotenv.parse(readFileSync(resolve(process.cwd(), filename)))
    for (const [key, value] of Object.entries(parsed)) if (process.env[key] === undefined) process.env[key] = value
  } catch {
    // Optional env files are handled by the explicit configuration gates below.
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

function safeCosEnvironment() {
  const environment = process.env.SOCIAL_POC_COS_ENV?.trim().toLowerCase()
  const bucket = process.env.TENCENT_COS_BUCKET?.trim() || process.env.COS_BUCKET?.trim()
  const region = process.env.TENCENT_COS_REGION?.trim() || process.env.COS_REGION?.trim()
  if (!environment || !bucket || !region || !['local', 'staging', 'production'].includes(environment)) throw new Error('POC_COS_NOT_CONFIRMED')
  if (environment === 'production' && process.env.SOCIAL_POC_PRODUCTION_BUCKET_ACK !== 'YES') throw new Error('POC_PRODUCTION_BUCKET_ACK_REQUIRED')
  return { environment, bucket, region }
}

function observedHostnames(posts: readonly InstagramPost[]) {
  const hosts = new Set<string>()
  for (const post of posts) for (const media of post.media) for (const source of [media.sourceUrl, media.thumbnailUrl]) {
    if (!source) continue
    const url = new URL(source)
    hosts.add(url.hostname.toLowerCase())
  }
  return [...hosts].sort()
}

function sampleMedia(posts: readonly InstagramPost[]) {
  const seen = new Set<string>()
  return posts
    .flatMap((post) => post.media.flatMap((media) => [
      { sourceUrl: media.sourceUrl, type: media.type, label: `${post.externalId}:${media.sortOrder}` },
      ...(media.thumbnailUrl ? [{ sourceUrl: media.thumbnailUrl, type: 'IMAGE' as const, label: `${post.externalId}:${media.sortOrder}:thumbnail` }] : []),
    ]))
    .filter((media) => {
      if (seen.has(media.sourceUrl)) return false
      seen.add(media.sourceUrl)
      return true
    })
    .slice(0, MAX_MEDIA_CHECKS)
}

async function inspectMedia(posts: readonly InstagramPost[]) {
  const results: Array<{ status: number; hostname: string; contentType: string | null; contentLength: number | null; method: string; redirects: number }> = []
  for (const media of sampleMedia(posts)) {
    const result = await inspectInstagramMediaUrl(media, { proxyUrl: process.env.IG_MEDIA_PROXY_URL })
    results.push(result)
    if (result.status === 429) throw new Error('PROVIDER_RATE_LIMITED')
  }
  return results
}

function traceForExistingRun(): InstagramProviderTrace {
  return {
    actor: ACTOR,
    runId: RUN_ID,
    datasetId: DATASET_ID,
    runStatus: 'SUCCEEDED',
    runStartedAt: new Date('2026-08-26T11:54:31.730Z'),
    runFinishedAt: new Date('2026-08-26T11:54:44.148Z'),
    usageTotalUsd: null,
    billableResults: null,
  }
}

function fixedDatasetProvider(posts: readonly InstagramPost[], trace: InstagramProviderTrace, proxyUrl: string | null): InstagramProvider {
  return {
    name: 'apify',
    proxyUrl,
    getLatestPosts: async (username, limit) => {
      if (normalizeInstagramUsername(username) !== TARGET_USERNAME || limit !== 2) throw new Error('POC_DATASET_INPUT_MISMATCH')
      return [...posts]
    },
    getTrace: () => trace,
  }
}

async function main() {
  // Abort before any Apify or media request unless a separate, isolated test
  // database has been explicitly selected.
  const database = assertSafePocDatabaseTarget()
  if (process.env.IG_PROVIDER?.trim().toLowerCase() !== 'apify' || process.env.IG_TARGET_USERNAME?.trim().replace(/^@+/, '').toLowerCase() !== TARGET_USERNAME) throw new Error('APIFY_CONFIGURATION_MISSING_OR_MISMATCHED')
  if (!process.env.APIFY_API_TOKEN?.trim()) throw new Error('APIFY_CONFIGURATION_MISSING')

  const reader = new ApifyInstagramProvider({ proxyUrl: process.env.APIFY_PROXY_URL })
  const posts = await reader.getLatestPostsFromDataset(DATASET_ID, TARGET_USERNAME, 2)
  if (posts.length !== 2 || posts.some((post) => post.username !== TARGET_USERNAME)) throw new Error('PROVIDER_CONTRACT_FAILED')

  const hosts = observedHostnames(posts)
  process.env.IG_ALLOWED_MEDIA_HOSTS = MEDIA_ALLOWLIST
  if (hosts.some((host) => !host.endsWith('.cdninstagram.com') && !host.endsWith('.fbcdn.net'))) throw new Error('MEDIA_HOST_ALLOWLIST_REVIEW_REQUIRED')
  const media = await inspectMedia(posts)

  // The write path is intentionally guarded by explicit, separate PoC env vars.
  const cos = safeCosEnvironment()
  process.env.DATABASE_URL = database.databaseUrl
  const { SafeExternalInstagramMediaLocalizer } = await import('@/lib/instagram/media')
  const { syncInstagramPosts } = await import('@/lib/instagram/sync-service')
  const { prisma } = await import('@/lib/prisma')
  const { withInstagramWorkerAdmission } = await import('@/lib/instagram/maintenance-protocol')
  const { acquireInstagramSyncLease, renewInstagramSyncLease, releaseInstagramSyncLease } = await import('@/lib/instagram/sync-state')
  const trace = traceForExistingRun()
  const result = await withInstagramWorkerAdmission(prisma, TARGET_USERNAME, async () => {
    const lease = await acquireInstagramSyncLease({ target: TARGET_USERNAME, leaseMs: 5 * 60 * 1000, db: prisma })
    if (!lease.acquired || lease.generation === null) throw new Error('INSTAGRAM_LEASE_UNAVAILABLE')
    const controller = new AbortController()
    let lost = false
    let renewalBusy = false
    const execution = {
      target: TARGET_USERNAME,
      token: lease.token,
      generation: lease.generation,
      signal: controller.signal,
      isLost: () => lost,
      assertActive: () => { if (lost || controller.signal.aborted) throw new Error('INSTAGRAM_LEASE_LOST') },
    }
    const heartbeat = setInterval(() => {
      if (renewalBusy || lost) return
      renewalBusy = true
      void renewInstagramSyncLease({ target: TARGET_USERNAME, token: lease.token, generation: lease.generation!, now: new Date(), leaseMs: 5 * 60 * 1000, db: prisma })
        .then((ok) => { if (!ok && !lost) { lost = true; controller.abort(new Error('INSTAGRAM_LEASE_LOST')) } })
        .catch(() => { if (!lost) { lost = true; controller.abort(new Error('INSTAGRAM_LEASE_LOST')) } })
        .finally(() => { renewalBusy = false })
    }, 60_000)
    heartbeat.unref?.()
    try {
      return await syncInstagramPosts({
        provider: fixedDatasetProvider(posts, trace, process.env.APIFY_PROXY_URL || null),
        localizer: new SafeExternalInstagramMediaLocalizer({ proxyUrl: process.env.IG_MEDIA_PROXY_URL, keyPrefix: `social/instagram/${TARGET_USERNAME}/poc` }),
        username: TARGET_USERNAME,
        limit: 2,
        suppressNotification: true,
        trace,
        trigger: 'manual',
        lease: execution,
      })
    } finally {
      clearInterval(heartbeat)
      while (renewalBusy) await new Promise((resolve) => setTimeout(resolve, 10))
      await releaseInstagramSyncLease(TARGET_USERNAME, lease.token, lease.generation, prisma).catch(() => false)
    }
  })
  console.log(JSON.stringify({ actor: ACTOR, runId: RUN_ID, datasetId: DATASET_ID, posts: posts.length, hosts, media, cos: { bucket: cos.bucket, region: cos.region, environment: cos.environment }, result: { status: result.status, foundCount: result.foundCount, createdCount: result.createdCount, updatedCount: result.updatedCount, mediaCount: result.mediaCount, notifiedCount: result.notifiedCount } }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'PHASE42B_FAILED')
  process.exitCode = 1
})
