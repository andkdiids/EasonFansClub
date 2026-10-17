import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { ACTIVITY_INFO_GAP, ACTIVITY_INFO_START_Y, FOOTER_SAFE_BOTTOM, HERO_ACTIVITY_GAP, HERO_SAFE_BOTTOM, RESULT_MAX_BOTTOM, RESULT_START_Y, RESULT_TOP_VISUAL_CLEARANCE, TOPIC_POSTER_SIZE, TOP_VISUAL_SAFE_ZONE, TOPIC_POSTER_ACTIVITY_INFO, TOPIC_POSTER_AVATAR, TOPIC_POSTER_BRAND, TOPIC_POSTER_QR, TOPIC_POSTER_RESULT, USER_ZONE_START, topicPosterLayout } from '@/lib/topic-activity-v2-poster-layout'

const snapshot = {
  testTitle: '测试', title: '结果 1', description: '请填写结果说明', nickname: '本地验收会员',
  activityStartsAt: '2026-10-16T15:03:00Z', activityEndsAt: '2026-10-17T15:02:00Z',
  poster: { showNickname: true, showQrCode: true },
}

test('V5.1 reserves a hero safe zone and moves activity/result blocks without moving the bottom identity, QR or footer', () => {
  assert.deepEqual(TOPIC_POSTER_SIZE, { width: 1080, height: 1440 })
  assert.equal(HERO_SAFE_BOTTOM, 510)
  assert.equal(TOP_VISUAL_SAFE_ZONE, HERO_SAFE_BOTTOM)
  assert.equal(ACTIVITY_INFO_START_Y, 560)
  assert.equal(HERO_ACTIVITY_GAP, 50)
  assert.deepEqual(TOPIC_POSTER_ACTIVITY_INFO, { top: ACTIVITY_INFO_START_Y, height: 158 })
  assert.ok(TOPIC_POSTER_ACTIVITY_INFO.top >= HERO_SAFE_BOTTOM + HERO_ACTIVITY_GAP)
  const gap = TOPIC_POSTER_RESULT.top - TOPIC_POSTER_ACTIVITY_INFO.top - TOPIC_POSTER_ACTIVITY_INFO.height
  assert.equal(gap, ACTIVITY_INFO_GAP + RESULT_TOP_VISUAL_CLEARANCE)
  assert.equal(TOPIC_POSTER_RESULT.top, RESULT_START_Y)
  assert.equal(RESULT_TOP_VISUAL_CLEARANCE, 6)
  assert.equal(RESULT_START_Y, 776)
  assert.equal(TOPIC_POSTER_RESULT.top, 596 + 180, 'the result block moves down from the previous V5 coordinate; the tilted strip uses a visual clearance')
  assert.equal(TOPIC_POSTER_RESULT.maxBottom, RESULT_MAX_BOTTOM)
  assert.ok(RESULT_MAX_BOTTOM < USER_ZONE_START)
  assert.ok(TOPIC_POSTER_RESULT.minBottom > TOPIC_POSTER_RESULT.top)
  assert.ok(TOPIC_POSTER_RESULT.maxBottom < TOPIC_POSTER_AVATAR.top)
  assert.deepEqual(TOPIC_POSTER_AVATAR, { left: 100, top: 1120, size: 144 })
  assert.deepEqual(TOPIC_POSTER_QR, { left: 820, top: 1108, size: 190 })
  assert.ok(TOPIC_POSTER_BRAND.top + TOPIC_POSTER_BRAND.height <= TOPIC_POSTER_SIZE.height - FOOTER_SAFE_BOTTOM)
  assert.ok(TOPIC_POSTER_BRAND.left + TOPIC_POSTER_BRAND.width < TOPIC_POSTER_QR.left, 'footer cannot cover the QR quiet zone')
})

test('all dynamic SVG ink stays out of the hero and bottom decoration for short/long content', async () => {
  await renderTopicV2Poster(snapshot, 'local-safe-zone') // initialize the real bundled font path
  for (const value of [snapshot, { ...snapshot, title: '很长的结果'.repeat(30), description: '长说明'.repeat(100), testTitle: '很长的测试名称'.repeat(30), nickname: '长昵称'.repeat(20), score: 12, maxScore: 20 }]) {
    const svg = Buffer.from(topicPosterLayout(value))
    for (const region of [{ left: 0, top: 0, width: TOPIC_POSTER_SIZE.width, height: TOP_VISUAL_SAFE_ZONE }, { left: 0, top: TOPIC_POSTER_SIZE.height - 48, width: TOPIC_POSTER_SIZE.width, height: 48 }]) {
      const alpha = await sharp(svg).ensureAlpha().extract(region).extractChannel(3).raw().toBuffer()
      assert.ok(alpha.every((byte) => byte === 0), `no dynamic ink in protected rows ${region.top}–${region.top + region.height}`)
    }
  }
})

test('long descriptions shrink and truncate inside the result allowance before the user and footer zones', () => {
  assert.ok(TOPIC_POSTER_RESULT.maxBottom + 24 <= USER_ZONE_START)
  assert.ok(TOPIC_POSTER_RESULT.maxBottom < TOPIC_POSTER_QR.top)
  assert.ok(TOPIC_POSTER_RESULT.maxBottom < TOPIC_POSTER_AVATAR.top)
  assert.ok(TOPIC_POSTER_BRAND.top + TOPIC_POSTER_BRAND.height <= TOPIC_POSTER_SIZE.height - FOOTER_SAFE_BOTTOM)
  const shortTitleSvg = topicPosterLayout({
    testTitle: snapshot.testTitle,
    title: '结果标题',
    description: '长说明内容，需要自动换行并在安全区内截断。'.repeat(300),
    nickname: snapshot.nickname,
    poster: { showNickname: true, showQrCode: true },
  })
  const descriptionLines = [...shortTitleSvg.matchAll(/<text x="118" y="(\d+)" font-size="\d+" font-weight="650">([^<]*)<\/text>/gu)]
  assert.ok(descriptionLines.length > 0, 'long description is rendered')
  assert.ok(Number(descriptionLines.at(-1)?.[1]) < TOPIC_POSTER_RESULT.maxBottom)
  assert.match(descriptionLines.at(-1)?.[2] || '', /…/u, 'the description itself is ellipsized at the safe boundary')

  const crowdedSvg = topicPosterLayout({
    testTitle: snapshot.testTitle,
    title: '结果标题'.repeat(40),
    description: '长说明内容，需要自动换行并在安全区内截断。'.repeat(300),
    nickname: snapshot.nickname,
    score: 20,
    maxScore: 20,
    poster: { showNickname: true, showQrCode: true },
  })
  const baselines = [...crowdedSvg.matchAll(/<text x="118" y="(\d+)"/gu)].map((match) => Number(match[1]))
  assert.ok(baselines.length > 0)
  assert.ok(baselines.every((baseline) => baseline < TOPIC_POSTER_RESULT.maxBottom), 'title, description and score remain above the bottom result limit')
})

test('real KEEP YOUR CHIN UP background hero is pixel-identical in PNG and browser previews', {
  skip: process.env.TOPIC_POSTER_HERO_BROWSER_QA !== '1', timeout: 90_000,
}, async (t) => {
  const source = process.env.TOPIC_POSTER_HERO_BACKGROUND_FILE
  assert.ok(source, 'explicit original background file is required; never substitute a webpage screenshot')
  const background = await readFile(source)
  const base = await sharp(background).rotate().resize(TOPIC_POSTER_SIZE.width, TOPIC_POSTER_SIZE.height, { fit: 'cover', position: 'centre' }).png().toBuffer()
  const png = await renderTopicV2Poster(snapshot, 'local-safe-zone', background)
  assert.deepEqual(await sharp(png).metadata().then((m) => [m.width, m.height]), [TOPIC_POSTER_SIZE.width, TOPIC_POSTER_SIZE.height])
  const hero = { left: 0, top: 0, width: TOPIC_POSTER_SIZE.width, height: TOP_VISUAL_SAFE_ZONE }
  assert.deepEqual(await sharp(png).extract(hero).ensureAlpha().raw().toBuffer(), await sharp(base).extract(hero).ensureAlpha().raw().toBuffer(), 'not a single background hero pixel may be covered')
  const output = process.env.TOPIC_POSTER_HERO_ARTIFACTS
  if (output) { await mkdir(output, { recursive: true }); await writeFile(join(output, 'poster-v4-1.png'), png) }
  const server = createServer((request, response) => {
    if (request.url === '/poster.png' || request.url === '/background.png') { response.setHeader('Content-Type', 'image/png'); response.end(request.url === '/poster.png' ? png : base); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#eee}img{display:block;width:100%;height:auto;max-width:540px;margin:auto}</style><img id="poster" src="/poster.png" alt="V4.1 实际PNG"><img id="background" src="/background.png" hidden style="display:none">')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    assert.equal((await fetch(origin + '/poster.png')).status, 200, 'HTTP probe must succeed before browser QA')
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1280, 390]) await t.test(`hero clear at ${width}px`, async () => {
      const page = await browser!.newPage({ viewport: { width, height: 980 } })
      await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
      try {
        await page.goto(origin)
        const checked = await page.evaluate(async ({ width, safeZone }: { width: number; safeZone: number }) => {
          const poster = document.querySelector<HTMLImageElement>('#poster')!, background = document.querySelector<HTMLImageElement>('#background')!
          await Promise.all([poster.decode(), background.decode()])
          const beforeCanvas = document.createElement('canvas'), afterCanvas = document.createElement('canvas')
          beforeCanvas.width = afterCanvas.width = width; beforeCanvas.height = afterCanvas.height = safeZone
          const beforeContext = beforeCanvas.getContext('2d')!, afterContext = afterCanvas.getContext('2d')!
          beforeContext.drawImage(background, 0, 0); afterContext.drawImage(poster, 0, 0)
          const before = beforeContext.getImageData(0, 0, width, safeZone).data, after = afterContext.getImageData(0, 0, width, safeZone).data
          return { heroClear: before.every((byte, index) => byte === after[index]), width: poster.naturalWidth, height: poster.naturalHeight,
            ratio: poster.getBoundingClientRect().width / poster.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth }
        }, { width: TOPIC_POSTER_SIZE.width, safeZone: TOP_VISUAL_SAFE_ZONE })
        assert.equal(checked.heroClear, true, 'BACKGROUND HERO CLEAR: every pixel of the output top safe zone is preserved')
        assert.deepEqual([checked.width, checked.height], [TOPIC_POSTER_SIZE.width, TOPIC_POSTER_SIZE.height]); assert.ok(Math.abs(checked.ratio - 3 / 4) < .001); assert.equal(checked.overflow, false)
        if (output) await page.screenshot({ path: join(output, `browser-${width}.png`), fullPage: true })
      } finally { await page.close() }
    })
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
