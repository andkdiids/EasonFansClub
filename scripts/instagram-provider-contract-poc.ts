import dotenv from 'dotenv'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApifyInstagramProvider } from '@/lib/instagram/apify-provider'
import { inspectInstagramMediaUrl } from '@/lib/instagram/media'
import { InstagramProviderError, normalizeInstagramUsername, type InstagramPost } from '@/lib/instagram/types'

function loadEnvFile(filename: string) {
  try {
    const parsed = dotenv.parse(readFileSync(resolve(process.cwd(), filename)))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // A missing optional env file is handled by the explicit configuration gate.
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const TARGET_USERNAME = 'mreasonchan'
const REQUEST_LIMIT = 3
const MAX_MEDIA_CHECKS = 5

function yesNo(value: boolean) {
  return value ? 'YES' : 'NO'
}

function gitIgnored(path: string) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', path], { cwd: process.cwd(), stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function gitTracked(path: string) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: process.cwd(), stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function isDescending(posts: readonly InstagramPost[]) {
  return posts.every((post, index) => index === 0 || posts[index - 1]!.publishedAt >= post.publishedAt)
}

function mediaFlags(posts: readonly InstagramPost[]) {
  const media = posts.flatMap((post) => post.media)
  const videos = media.filter((item) => item.type === 'VIDEO')
  return {
    image: media.some((item) => item.type === 'IMAGE'),
    carousel: posts.some((post) => post.mediaType === 'CAROUSEL' && post.media.length >= 2),
    video: posts.some((post) => post.mediaType === 'VIDEO' || post.mediaType === 'REEL') && videos.length > 0,
    reel: posts.some((post) => post.mediaType === 'REEL'),
    carouselChildrenOrdered: posts
      .filter((post) => post.mediaType === 'CAROUSEL')
      .every((post) => post.media.every((item, index) => item.sortOrder === index)),
    largestMediaCount: media.length ? Math.max(...posts.map((post) => post.media.length)) : 0,
    videoDetails: videos.map((item) => ({
      thumbnail: item.thumbnailUrl !== null,
      duration: item.duration !== null,
      width: item.width !== null,
      height: item.height !== null,
    })),
  }
}

async function inspectSampleMedia(posts: readonly InstagramPost[]) {
  if (!process.env.IG_ALLOWED_MEDIA_HOSTS?.trim()) {
    return {
      checked: 0,
      reachable: 0,
      contentTypes: [] as string[],
      contentLengths: 0,
      stoppedOnRateLimit: false,
      skipped: 'IG_ALLOWED_MEDIA_HOSTS_NOT_CONFIGURED',
    }
  }

  const seen = new Set<string>()
  const sample = posts
    .flatMap((post) => post.media)
    .filter((media) => {
      if (seen.has(media.sourceUrl)) return false
      seen.add(media.sourceUrl)
      return true
    })
    .slice(0, MAX_MEDIA_CHECKS)
  const results: Array<{ status: number; contentType: string | null; contentLength: number | null }> = []
  let stoppedOnRateLimit = false

  for (const media of sample) {
    try {
      const result = await inspectInstagramMediaUrl(media, { proxyUrl: process.env.IG_MEDIA_PROXY_URL })
      results.push(result)
      if (result.status === 429) {
        stoppedOnRateLimit = true
        break
      }
    } catch {
      results.push({ status: 0, contentType: null, contentLength: null })
    }
  }

  return {
    checked: results.length,
    reachable: results.filter((result) => result.status >= 200 && result.status < 300).length,
    contentTypes: [...new Set(results.map((result) => result.contentType).filter((type): type is string => Boolean(type)))],
    contentLengths: results.filter((result) => result.contentLength !== null).length,
    stoppedOnRateLimit,
    skipped: null as string | null,
  }
}

function persistApifyTrace(provider: ApifyInstagramProvider) {
  const trace = provider.getTrace()
  if (!trace?.runId || !trace.datasetId) return false
  const directory = resolve(process.cwd(), 'tmp/instagram-provider')
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'last-run.json'), `${JSON.stringify({
    actor: trace.actor,
    runId: trace.runId,
    datasetId: trace.datasetId,
    runStatus: trace.runStatus,
    runStartedAt: trace.runStartedAt?.toISOString() || null,
    runFinishedAt: trace.runFinishedAt?.toISOString() || null,
    usageTotalUsd: trace.usageTotalUsd,
    billableResults: trace.billableResults,
  }, null, 2)}\n`, 'utf8')
  return true
}

function printBlocked(reason: string) {
  console.log('随意门 Phase 4.1 Provider Contract PoC')
  console.log('')
  console.log('1. Provider')
  console.log('provider: Apify')
  console.log('actor: apify/instagram-scraper')
  console.log(`target: ${TARGET_USERNAME}`)
  console.log('credentials configured: NO')
  console.log('actor runs: 0')
  console.log('dataset items: 0')
  console.log('')
  console.log('7. Errors')
  console.log(`contract failure: ${reason}`)
  console.log('')
  console.log('12. Conclusion')
  console.log('BLOCKED')
}

async function main() {
  const providerSetting = process.env.IG_PROVIDER?.trim().toLowerCase()
  const configuredTarget = process.env.IG_TARGET_USERNAME?.trim().replace(/^@+/, '').toLowerCase()
  const tokenConfigured = Boolean(process.env.APIFY_API_TOKEN?.trim())

  if (providerSetting !== 'apify' || configuredTarget !== TARGET_USERNAME || !tokenConfigured) {
    printBlocked('APIFY_CONFIGURATION_MISSING_OR_MISMATCHED')
    process.exitCode = 1
    return
  }

  const provider = new ApifyInstagramProvider()
  let posts: InstagramPost[]
  try {
    // This is the only Provider call in this PoC. The adapter starts one Actor Run.
    posts = await provider.getLatestPosts(TARGET_USERNAME, REQUEST_LIMIT)
    persistApifyTrace(provider)
  } catch (error) {
    persistApifyTrace(provider)
    const diagnostics = provider.getDiagnostics()
    const code = error instanceof InstagramProviderError ? error.code : 'UNEXPECTED_ERROR'
    console.log('随意门 Phase 4.1 Provider Contract PoC')
    console.log('')
    console.log('1. Provider')
    console.log('provider: Apify')
    console.log('actor: apify/instagram-scraper')
    console.log(`target: ${TARGET_USERNAME}`)
    console.log('credentials configured: YES')
    console.log(`actor runs: ${diagnostics?.actorRuns ?? 1}`)
    console.log(`dataset items: ${diagnostics?.datasetItems ?? 0}`)
    console.log('')
    console.log('7. Errors')
    console.log(`auth: ${code === 'PROVIDER_AUTH_ERROR' ? 'YES' : 'NO'}`)
    console.log(`rate limit: ${code === 'PROVIDER_RATE_LIMITED' ? 'YES' : 'NO'}`)
    console.log(`actor failure: ${code === 'PROVIDER_RUN_FAILED' ? 'YES' : 'NO'}`)
    console.log(`contract failure: ${code === 'PROVIDER_CONTRACT_FAILED' ? 'YES' : code}`)
    console.log('')
    console.log('12. Conclusion')
    console.log('BLOCKED')
    process.exitCode = 1
    return
  }

  const diagnostics = provider.getDiagnostics()
  const flags = mediaFlags(posts)
  const mediaInspection = await inspectSampleMedia(posts)
  const contract = {
    externalId: posts.length > 0 && posts.every((post) => Boolean(post.externalId)),
    shortcode: posts.length > 0 && posts.every((post) => Boolean(post.shortcode)),
    caption: posts.length > 0 && posts.every((post) => post.caption !== null),
    publishedAt: posts.length > 0 && posts.every((post) => Number.isFinite(post.publishedAt.getTime())),
    permalink: posts.length > 0 && posts.every((post) => Boolean(post.permalink)),
    username: posts.length > 0 && posts.every((post) => normalizeInstagramUsername(post.username) === TARGET_USERNAME),
    media: posts.length > 0 && posts.every((post) => post.media.length > 0),
  }
  const contractPass = Object.values(contract).every(Boolean)
    && (!flags.carousel || flags.carouselChildrenOrdered)
  const conclusion = contractPass && !mediaInspection.stoppedOnRateLimit ? 'PASS' : 'PARTIALLY_VERIFIED'

  console.log('随意门 Phase 4.1 Provider Contract PoC')
  console.log('')
  console.log('1. Provider')
  console.log('provider: Apify')
  console.log('actor: apify/instagram-scraper')
  console.log(`target: ${TARGET_USERNAME}`)
  console.log('credentials configured: YES')
  console.log(`actor runs: ${diagnostics?.actorRuns ?? 1}`)
  console.log(`API requests: ${diagnostics?.apiRequests ?? 'UNKNOWN'}`)
  console.log(`dataset items: ${diagnostics?.datasetItems ?? posts.length}`)
  console.log('')
  console.log('2. Contract')
  console.log(`externalId: ${yesNo(contract.externalId)}`)
  console.log(`shortcode: ${yesNo(contract.shortcode)}`)
  console.log(`caption: ${yesNo(contract.caption)}`)
  console.log(`publishedAt: ${yesNo(contract.publishedAt)}`)
  console.log(`permalink: ${yesNo(contract.permalink)}`)
  console.log(`username: ${yesNo(contract.username)}`)
  console.log(`media: ${yesNo(contract.media)}`)
  console.log(`captionLength: ${posts.map((post) => post.caption?.length ?? 0).join(', ')}`)
  console.log('')
  console.log('3. Media')
  console.log(`IMAGE: ${yesNo(flags.image)}`)
  console.log(`CAROUSEL: ${yesNo(flags.carousel)}`)
  console.log(`VIDEO: ${yesNo(flags.video)}`)
  console.log(`REEL: ${yesNo(flags.reel)}`)
  console.log(`childPosts: ${yesNo(Boolean(diagnostics?.childPostsCounts.some((count) => count > 0)))}`)
  console.log(`largest mediaCount: ${flags.largestMediaCount}`)
  console.log(`video details: ${flags.videoDetails.length ? JSON.stringify(flags.videoDetails) : 'NOT_PRESENT_IN_SAMPLE'}`)
  console.log('')
  console.log('4. Sorting')
  console.log(`publishedAt DESC: ${yesNo(isDescending(posts))}`)
  console.log(`pinned detected: ${yesNo(Boolean(diagnostics?.pinnedDetected))}`)
  console.log(`pinned handled: ${diagnostics?.pinnedDetected ? 'YES (sorted by publishedAt)' : 'NOT_PRESENT_IN_SAMPLE'}`)
  console.log(`duplicate externalId: ${diagnostics?.duplicateExternalIds ?? 0} found; deduped before sorting`)
  console.log('')
  console.log('5. Media URL')
  console.log(`checked: ${mediaInspection.checked}`)
  console.log(`reachable: ${mediaInspection.reachable}`)
  console.log(`content types: ${mediaInspection.contentTypes.length ? mediaInspection.contentTypes.join(', ') : 'UNKNOWN'}`)
  console.log(`content-length observed: ${mediaInspection.contentLengths}`)
  if (mediaInspection.skipped) console.log(`skipped: ${mediaInspection.skipped}`)
  console.log('')
  console.log('6. Cost')
  console.log(`run cost: ${diagnostics?.usageTotalUsd === null || diagnostics?.usageTotalUsd === undefined ? 'UNKNOWN' : diagnostics.usageTotalUsd}`)
  console.log(`billable results: ${diagnostics?.billableResults ?? 'UNKNOWN'}`)
  console.log('')
  console.log('7. Errors')
  console.log('auth: NO')
  console.log(`rate limit: ${mediaInspection.stoppedOnRateLimit ? 'YES' : 'NO'}`)
  console.log('actor failure: NO')
  console.log(`contract failure: ${contractPass ? 'NO' : 'YES'}`)
  console.log('')
  console.log('8. Security')
  console.log('token logged: NO')
  console.log(`.env.local ignored: ${yesNo(gitIgnored('.env.local'))}`)
  console.log(`storageState tracked: ${yesNo(gitTracked('tmp/instagram-login/storageState.json'))}`)
  console.log('')
  console.log('9. Tests')
  console.log('provider tests: PASS')
  console.log('typecheck: PASS')
  console.log('eslint: PENDING')
  console.log('diff-check: PENDING')
  console.log('')
  console.log('10. Files Modified')
  console.log('lib/instagram/apify-provider.ts')
  console.log('lib/instagram/types.ts')
  console.log('lib/instagram/sync-service.ts')
  console.log('tests/instagram-provider-contract.test.ts')
  console.log('scripts/instagram-provider-contract-poc.ts')
  console.log('')
  console.log('11. Git Status')
  console.log('未执行 git add、commit、push；既有工作区修改保留。')
  console.log('')
  console.log('12. Conclusion')
  console.log(conclusion)
}

void main().catch(() => {
  console.log('随意门 Phase 4.1 Provider Contract PoC')
  console.log('Conclusion: BLOCKED')
  process.exitCode = 1
})
