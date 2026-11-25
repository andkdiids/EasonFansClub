import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { setShunEnabled, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

/**
 * V4.2 REAL-BROWSER verification (not source assertions).
 *
 * - An in-page rAF sampler records per-beat geometry, the real CSS animation
 *   duration (via `animationend`), and whether document.elementFromPoint hits
 *   the skip button on every single frame.
 * - A CDP screencast captures real frames for fold / insert / stamp / fly
 *   evidence. Screenshots are evidence only; assertions use sampled geometry.
 * - The skip button is clicked with a real Playwright click (which requires it
 *   to actually receive pointer events) and must land on "已送达" once, with no
 *   second letter or notification written.
 *
 * Requires a running Next dev server and the isolated MySQL fixture:
 *   SHUN_LETTER_BROWSER_QA=1 DATABASE_URL=mysql://root:qa@127.0.0.1:33326/ecfc_shun_qa \
 *   SHUN_LETTER_BROWSER_BASE=http://127.0.0.1:3127 SHUN_LETTER_QA_OUTPUT=<dir> \
 *   tsx --test --test-concurrency=1 tests/shun-master-v42-animation-browser.test.ts
 */

const MESSAGE = 'V4.2 动画验收：只有你能看到这句话'

async function makeFixture() {
  // This suite owns the isolated QA schema, so start from a clean protection
  // table. Stale rows from earlier runs would otherwise mark every funded
  // account as protected and leave the target pool empty (NO_TARGET).
  await prisma.shunMasterProtection.deleteMany({})
  const create = (points = 0) => {
    const name = 'v42-anim-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      points, passwordHash: 'fixture', Profile: { create: { displayName: name } } } })
  }
  const [admin, actor, victim, ...decoys] = await Promise.all([
    create(), create(), create(60), create(), create(), create(), create(),
  ])
  const ids = [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)]
  const outsiders = await prisma.user.findMany({ where: { id: { notIn: ids } }, select: { id: true } })
  await prisma.shunMasterProtection.createMany({
    data: [...outsiders, admin, actor].map(({ id: userId }) => ({ userId, protected: true })), skipDuplicates: true,
  })
  await updateShunConfig(admin.id, { ...defaultShunConfig, enabled: false })
  await setShunEnabled(admin.id, true)
  return { actor, victim, ids, cleanup: ids }
}

async function cleanupFixture(ids: string[]) {
  await prisma.shunMasterProtection.deleteMany({ where: { userId: { in: ids } } })
}

/** Install the rAF sampler as a context init script so it survives navigation.
 *  Records one timestamped geometry sample per frame for time-window assertions,
 *  plus per-frame skip-button hit testing. Plain JS via eval to avoid esbuild's
 *  __name helper inside page.evaluate. */
async function installSampler(context: BrowserContext) {
  await context.addInitScript(() => {
    eval(`(function () {
      window.__V42 = { samples: [], skipHits: 0, skipFrames: 0, skipRect: null,
        cssDurationMs: null, flyDoneMs: null, wallDurationMs: null, t0: null, animStart: null };
      // MutationObserver measures mount→unmount of the animation dialog: this is
      // the real wall-clock duration, independent of rAF sampling offsets.
      function watchDialog() {
        try {
          new MutationObserver(function () {
            var d = document.querySelector('[role="dialog"][aria-label="正在寄出匿名信"]');
            if (d && window.__V42.animStart === null) window.__V42.animStart = performance.now();
            if (!d && window.__V42.animStart !== null && window.__V42.wallDurationMs === null) {
              window.__V42.wallDurationMs = performance.now() - window.__V42.animStart;
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* document not ready: rAF proxy still covers timing */ }
      }
      if (document.documentElement) watchDialog();
      else window.addEventListener('DOMContentLoaded', watchDialog, { once: true });
      function tick() {
        var root = document.querySelector('[role="dialog"][aria-label="正在寄出匿名信"]');
        if (!root) { requestAnimationFrame(tick); return; }
        if (window.__V42.t0 === null) window.__V42.t0 = performance.now();
        var t = performance.now() - window.__V42.t0;
        var sheet = root.querySelector('[class*="sheet"]:not([class*="sheetLower"]):not([class*="sheetUpper"])');
        var lower = root.querySelector('[class*="sheetLower"]');
        var wax = root.querySelector('[class*="wax"]');
        var stamp = root.querySelector('[class*="stamp"]');
        var env = root.querySelector('[class*="envelope"]');
        var sb = sheet && sheet.getBoundingClientRect();
        var eb = env && env.getBoundingClientRect();
        // Authoritative timeline position: the envelope's own CSS animation
        // currentTime on the shared 1500ms clock. The sampler's first frame can
        // trail the CSS start (slow first paint), which would otherwise shift
        // every windowed assertion; currentTime cannot drift.
        var at = t;
        try {
          var anim = env && env.getAnimations ? env.getAnimations()[0] : null;
          if (anim && typeof anim.currentTime === 'number') at = anim.currentTime;
        } catch (e) { /* no Web Animations API: fall back to rAF time */ }
        window.__V42.samples.push({ t: t, at: at,
          sheetTop: sb ? sb.top : -1,
          lower3d: !!(lower && getComputedStyle(lower).transform.indexOf('matrix3d') === 0),
          stampOpacity: stamp ? Number(getComputedStyle(stamp).opacity) : 0,
          waxOpacity: wax ? Number(getComputedStyle(wax).opacity) : 0,
          envTop: eb ? eb.top : 1e9, envLeft: eb ? eb.left : -1e9,
          envOpacity: env ? Number(getComputedStyle(env).opacity) : 1 });
        // Render-based completion proxy: the frame the envelope is fully faded.
        if (window.__V42.flyDoneMs === null && env && Number(getComputedStyle(env).opacity) < 0.02) {
          window.__V42.flyDoneMs = at;
        }
        if (!window.__V42._bound && env) {
          window.__V42._bound = true;
          env.addEventListener('animationend', function (e) {
            // Only the envelope's OWN fly-out ends the animation; child keyframes
            // (ink/sheet/pocket) bubble here too and must be ignored.
            if (e.target === env && /fly/i.test(e.animationName || '')) {
              window.__V42.cssDurationMs = performance.now() - window.__V42.t0;
            }
          });
        }
        var skip = document.querySelector('button[class*="skip"]');
        if (skip) {
          var b = skip.getBoundingClientRect();
          window.__V42.skipRect = { top: b.top, right: window.innerWidth - b.right, width: b.width, height: b.height,
            zIndex: getComputedStyle(skip).zIndex, position: getComputedStyle(skip).position };
          var hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          window.__V42.skipFrames++;
          if (hit === skip || skip.contains(hit)) window.__V42.skipHits++;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })()`)
  })
}

type Sample = { t: number; at: number; sheetTop: number; lower3d: boolean; stampOpacity: number; waxOpacity: number;
  envTop: number; envLeft: number; envOpacity: number }
type Probe = {
  samples: Sample[]; skipHits: number; skipFrames: number
  skipRect: { top: number; right: number; width: number; height: number; zIndex: string; position: string }
  cssDurationMs: number | null; flyDoneMs: number | null; wallDurationMs: number | null; t0: number
}

async function readProbe(page: Page) {
  return page.evaluate(() => (window as unknown as { __V42: Probe }).__V42)
}

/** Peak of `key` inside a window of the shared animation clock (`at`). */
const windowMax = (s: Sample[], from: number, to: number, key: keyof Sample) =>
  Math.max(...s.filter((x) => x.at >= from && x.at < to).map((x) => Number(x[key])), -1)

async function assertCommon(p: Probe, label: string) {
  const s = p.samples
  assert.ok(s.length > 20, `${label}: 必须有足够帧样本（实际 ${s.length}）`)
  assert.ok(s[s.length - 1].at - s[0].at >= 1200,
    `${label}: 采样必须覆盖完整动画（实际 ${Math.round(s[s.length - 1].at - s[0].at)}ms）`)
  // Fold: measured in the frozen-clock test below. A running rotateX on a
  // preserve-3d child is handed to the compositor, so getComputedStyle() keeps
  // reporting the base transform while it plays — live sampling cannot prove it,
  // a paused clock can (lower3d === true at 240ms).
  // Insert: paper moves down during 300–700ms (sheet top increases).
  const paperTop = windowMax(s, 0, 200, 'sheetTop')
  const insertTop = windowMax(s, 300, 700, 'sheetTop')
  assert.ok(insertTop > paperTop + 20, `${label}: 装入时信纸必须明显下移`)
  // Seal: no stamp before 850ms; stamp + wax appear in 850–1120ms.
  assert.equal(windowMax(s, 0, 840, 'stampOpacity'), 0, `${label}: 封口前不得出现印章`)
  assert.ok(windowMax(s, 850, 1120, 'stampOpacity') > 0.3, `${label}: 盖章阶段必须出现印章`)
  assert.ok(windowMax(s, 850, 1120, 'waxOpacity') > 0.3, `${label}: 盖章后必须留下火漆`)
  assert.ok(windowMax(s, 1120, 1400, 'waxOpacity') >= 0.99, `${label}: 飞出时信封必须带完整火漆`)
  // Fly: envelope leaves to upper-right and fades out in 1080–1500ms.
  const earlyEnvTop = Math.min(...s.filter((x) => x.at < 200).map((x) => x.envTop))
  const earlyEnvLeft = Math.max(...s.filter((x) => x.at < 200).map((x) => x.envLeft))
  const flyEnvTop = Math.min(...s.filter((x) => x.at >= 1080).map((x) => x.envTop))
  const flyEnvLeft = Math.max(...s.filter((x) => x.at >= 1080).map((x) => x.envLeft))
  assert.ok(flyEnvTop < earlyEnvTop - 40, `${label}: 信封必须向上飞出`)
  assert.ok(flyEnvLeft > earlyEnvLeft + 20, `${label}: 信封必须向右飞出`)
  assert.ok(s.some((x) => x.at >= 1400 && x.envOpacity < 0.9), `${label}: 飞出结束必须淡出`)
  // One shared 1500ms clock, measured wall-clock: the animation layer must be
  // mounted→unmounted inside the hard budget (MutationObserver, independent of
  // rAF sampling offsets). flyDone/cssDuration corroborate when sampled.
  assert.ok(p.wallDurationMs !== null, `${label}: 必须捕获动画层挂载→卸载时长`)
  assert.ok(p.wallDurationMs! <= 1500,
    `${label}: 动画时长 ${Math.round(p.wallDurationMs!)}ms 超过 1500ms 硬预算`)
  if (p.flyDoneMs !== null) assert.ok(p.flyDoneMs <= 1500, `${label}: 淡出完成帧超过预算`)
  if (p.cssDurationMs !== null) assert.ok(p.cssDurationMs <= 1500, `${label}: animationend 超过预算`)
  // Skip button: fixed top-right, ≥44×44, hit on every sampled frame.
  assert.equal(p.skipRect.position, 'fixed', `${label}: 跳过按钮必须 fixed 固定`)
  assert.ok(p.skipRect.top < 90, `${label}: 跳过按钮必须在右上角，top=${p.skipRect.top}`)
  assert.ok(p.skipRect.right < 90, `${label}: 跳过按钮必须在右上角，right=${p.skipRect.right}`)
  assert.ok(p.skipRect.width >= 44 && p.skipRect.height >= 44, `${label}: 点击区域必须 ≥44×44`)
  assert.ok(p.skipFrames > 0 && p.skipHits === p.skipFrames,
    `${label}: 跳过按钮每一帧都必须可被 elementFromPoint 命中 (${p.skipHits}/${p.skipFrames})`)
}

async function startSend(page: Page, base: string) {
  // Surface the server's own error code when a step is rejected, so a failure
  // here is diagnosable instead of looking like a missing dialog.
  page.on('response', (response) => {
    const url = response.url()
    if (!url.includes('/api/shun-master/') || response.status() < 400) return
    void response.text().then(
      (body) => console.log('V42_HTTP_FAIL', response.status(), new URL(url).pathname, body.slice(0, 200)),
      () => console.log('V42_HTTP_FAIL', response.status(), new URL(url).pathname),
    )
  })
  await page.goto(base + '/shun-master')
  // Wait for hydration + status before clicking: a click that lands before the
  // client handler is attached silently does nothing (the dialog then never
  // appears and the failure looks like a server error).
  await page.waitForFunction(() => document.body.innerText.includes('今日剩余'))
  await page.getByRole('button', { name: '顺一手' }).click()
  const result = page.getByRole('dialog', { name: '顺走啦！' })
  await result.waitFor()
  await result.getByRole('button', { name: '匿名留言', exact: true }).click()
  const composer = page.getByRole('dialog', { name: '给 TA 留一句匿名的话' })
  await composer.getByLabel('匿名留言内容').fill(MESSAGE)
  await composer.getByRole('button', { name: '发送留言', exact: true }).click()
  await page.getByRole('dialog', { name: '正在寄出匿名信' }).waitFor()
}

async function openContext(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string,
  actorId: string, viewport: { width: number; height: number }, theme: 'day' | 'midnight') {
  const context = await browser.newContext({
    viewport, isMobile: true, hasTouch: true, colorScheme: theme === 'midnight' ? 'dark' : 'light',
  })
  await context.addInitScript((value) => { try { window.localStorage.setItem('ecfc-theme', value) } catch { /* private */ } }, theme)
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } })
  await context.addCookies([{ name: authCookieName, value: await createSessionToken(actor), url: base }])
  return context
}

test('V4.2 animation verified on 390x844 day and midnight with keyframe evidence', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3127'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  if (output) await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    for (const theme of ['day', 'midnight'] as const) {
      const fx = await makeFixture()
      const context = await openContext(browser, base, fx.actor.id, { width: 390, height: 844 }, theme)
      try {
        await installSampler(context)
        const page = await context.newPage()
        page.setDefaultTimeout(120000)
        // CDP screencast: capture real frames for keyframe evidence.
        const frames: { data: string; ts: number }[] = []
        const cdp = await context.newCDPSession(page)
        await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 2 })
        cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
          frames.push({ data, ts: metadata.timestamp ?? 0 })
          await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
        })
        await startSend(page, base)
        // The dialog is now on screen: mark the screencast timestamp that starts
        // the animation window, so keyframes are selected by beat, not by the
        // (much longer) pre-send setup phase.
        const animTs = frames.length ? frames[frames.length - 1].ts : 0
        await page.getByRole('dialog', { name: '匿名信已送达 ✉️' }).waitFor()
        await cdp.send('Page.stopScreencast')
        // Save one real frame per beat (fold / insert / seal-wax / fly) from the
        // animation window only. Beats overlap on the shared clock; midpoints:
        // fold ~240ms, insert ~500ms, stamp ~1000ms, fly ~1300ms after animTs.
        if (output && frames.length) {
          const anim = frames.filter((f) => f.ts >= animTs && f.ts <= animTs + 1.6)
          for (const [beat, offset] of [['fold', 0.24], ['insert', 0.5], ['stamp', 1.0], ['fly', 1.3]] as const) {
            const target = animTs + offset
            const pick = anim.reduce<{ data: string; ts: number } | null>(
              (best, f) => (!best || Math.abs(f.ts - target) < Math.abs(best.ts - target) ? f : best), null)
            if (pick) await writeFile(join(output, `v42-390-${theme}-${beat}.png`), Buffer.from(pick.data, 'base64'))
          }
        }
        const p = await readProbe(page)
        console.log('V42_PROBE_390_' + theme, JSON.stringify({ samples: p.samples.length,
          spanMs: p.samples.length > 1 ? Math.round(p.samples[p.samples.length - 1].at - p.samples[0].at) : 0,
          fold3dLive: p.samples.some((x) => x.at >= 110 && x.at <= 370 && x.lower3d),
          stampPeak: windowMax(p.samples, 850, 1120, 'stampOpacity'),
          waxOnFly: windowMax(p.samples, 1120, 1400, 'waxOpacity'),
          wallDurationMs: p.wallDurationMs, flyDoneMs: p.flyDoneMs, cssDurationMs: p.cssDurationMs,
          skipHits: p.skipHits, skipFrames: p.skipFrames }))
        assertCommon(p, `390x844 ${theme}`)
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
        const rounds = await prisma.shunMasterRound.findMany({ where: { actorId: fx.actor.id } })
        assert.equal(rounds.length, 1, `${theme}: 自然结束不得重复创建对局`)
        assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: rounds[0]!.id } }), 1,
          `${theme}: 自然结束不得重复发送留言`)
      } finally {
        await context.close().catch(() => undefined)
        await cleanupFixture(fx.cleanup).catch(() => undefined)
      }
    }
  } finally {
    await browser.close()
    // Keep the Prisma connection alive for the following test in this file.
  }
})

test('V4.2 skip button clicked live on 375x812 midnight: immediate success, no duplicate', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3127'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    const fx = await makeFixture()
    const context = await openContext(browser, base, fx.actor.id, { width: 375, height: 812 }, 'midnight')
    await installSampler(context)
    const page = await context.newPage()
    page.setDefaultTimeout(120000)
    await startSend(page, base)
    const p0 = await readProbe(page)
    assert.ok(p0.skipFrames > 0, '跳过按钮从第一帧起必须存在')
    assert.ok(p0.skipHits === p0.skipFrames, '点击前每一帧跳过按钮都必须可命中')
    if (output) await mkdir(output, { recursive: true })
    if (output) await page.screenshot({ path: join(output, 'v42-375-midnight-skip-visible.png') }).catch(() => undefined)
    // Real click mid-animation; Playwright requires the element to receive events.
    await page.getByRole('button', { name: '跳过动画' }).click({ timeout: 5000 })
    const tClick = Date.now()
    await page.getByRole('dialog', { name: '匿名信已送达 ✉️' }).waitFor()
    assert.ok(Date.now() - tClick < 2000, '点击跳过后必须立即进入已送达状态')
    // Repeated/skip cannot double-send.
    const rounds = await prisma.shunMasterRound.findMany({ where: { actorId: fx.actor.id } })
    assert.equal(rounds.length, 1)
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: rounds[0]!.id } }), 1,
      '跳过不得重新提交留言')
    const letters = await prisma.notification.count({ where: { recipientId: fx.actor.id } })
    assert.ok(letters <= 1, '跳过不得重复发送通知')
    await context.close()
    await cleanupFixture(fx.cleanup)
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})

/**
 * Deterministic keyframe evidence.
 *
 * CDP screencast抢帧 in a 1.5s animation is unreliable (screenshot latency is the
 * same order as the whole timeline), so this test freezes the shared CSS clock
 * with the Web Animations API and screenshots pixel-exact states at the middle
 * of each beat — in both themes. It also asserts that the frozen geometry really
 * differs per beat, so the saved images cannot be stale duplicates.
 */
test('V4.2 keyframe evidence: frozen 3D fold / insert / stamp / fly in both themes', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3127'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  if (output) await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    for (const theme of ['day', 'midnight'] as const) {
      const fx = await makeFixture()
      const context = await openContext(browser, base, fx.actor.id, { width: 390, height: 844 }, theme)
      try {
        // Test-only: hold the animation layer open so the clock can be frozen.
        // Only the auto hand-off is dropped — by contract it fires between 1400
        // and 1500ms (the whole animation is ≤1500ms). Everything else must keep
        // running: the client's own 1600ms result delay gates the success
        // dialog, and the beat timers (≤1080ms) drive the hint labels.
        await installSampler(context)
        await context.addInitScript(() => {
          const original = window.setTimeout.bind(window)
          ;(window as unknown as { setTimeout: typeof window.setTimeout }).setTimeout = ((
            handler: TimerHandler, delay?: number, ...args: unknown[]
          ) => (typeof delay === 'number' && delay >= 1400 && delay <= 1500
            ? 0 : original(handler, delay, ...args))) as typeof window.setTimeout
        })
        const page = await context.newPage()
        page.setDefaultTimeout(120000)
        await startSend(page, base)
        const frozen = await page.evaluate(() => {
          const root = document.querySelector('[role="dialog"][aria-label="正在寄出匿名信"]')
          if (!root) return 0
          const anims = root.getAnimations({ subtree: true })
          for (const anim of anims) anim.pause()
          ;(window as unknown as { __FREEZE: Animation[] }).__FREEZE = anims
          return anims.length
        })
        assert.ok(frozen > 0, `${theme}: 必须冻结到真实 CSS 动画`)
        const states: string[] = []
        for (const [beat, at] of [['fold', 240], ['insert', 520], ['stamp', 1000], ['fly', 1300]] as const) {
          const geom = await page.evaluate((t) => {
            const anims = (window as unknown as { __FREEZE: Animation[] }).__FREEZE
            for (const anim of anims) anim.currentTime = t
            const root = document.querySelector('[role="dialog"][aria-label="正在寄出匿名信"]')
            const env = root?.querySelector('[class*="envelope"]')
            const sheet = root?.querySelector('[class*="sheet"]:not([class*="sheetLower"]):not([class*="sheetUpper"])')
            const lower = root?.querySelector('[class*="sheetLower"]')
            const stamp = root?.querySelector('[class*="stamp"]')
            const wax = root?.querySelector('[class*="wax"]')
            const box = env?.getBoundingClientRect()
            const paper = sheet?.getBoundingClientRect()
            return {
              envTop: box ? Math.round(box.top) : -1,
              envLeft: box ? Math.round(box.left) : -1,
              sheetTop: paper ? Math.round(paper.top) : -1,
              lower3d: !!lower && getComputedStyle(lower).transform.startsWith('matrix3d'),
              stamp: stamp ? Number(getComputedStyle(stamp).opacity).toFixed(2) : '0',
              wax: wax ? Number(getComputedStyle(wax).opacity).toFixed(2) : '0',
            }
          }, at)
          states.push(`${geom.envTop}/${geom.envLeft}/${geom.sheetTop}/${geom.lower3d}/${geom.stamp}/${geom.wax}`)
          if (output) await page.screenshot({ path: join(output, `v42-390-${theme}-${beat}.png`) })
          console.log(`V42_FRAME_${theme}_${beat}`, JSON.stringify({ at, ...geom }))
          if (beat === 'fold') assert.ok(geom.lower3d, `${theme}@240ms: 必须是真的 3D 折叠`)
          if (beat === 'stamp') {
            assert.ok(Number(geom.stamp) > 0.3, `${theme}@1000ms: 印章必须落下`)
            assert.ok(Number(geom.wax) > 0.3, `${theme}@1000ms: 必须已压出火漆`)
          }
          if (beat === 'fly') assert.ok(Number(geom.wax) >= 0.99, `${theme}@1300ms: 飞出的信封必须带完整火漆`)
        }
        // The four frozen states must differ — otherwise the saved images would
        // just be copies of one frame. Fold vs insert differ by paper position,
        // insert vs stamp by the seal, stamp vs fly by the envelope's flight.
        const unique = new Set(states)
        assert.equal(unique.size, 4, `${theme}: 四个关键帧必须互不相同（实际 ${unique.size} 种）`)
        // Skipping from a frozen frame still completes exactly once.
        await page.getByRole('button', { name: '跳过动画' }).click({ timeout: 5000 })
        await page.getByRole('dialog', { name: '匿名信已送达 ✉️' }).waitFor()
        const rounds = await prisma.shunMasterRound.findMany({ where: { actorId: fx.actor.id } })
        assert.equal(rounds.length, 1, `${theme}: 冻结取证不得重复创建对局`)
        assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: rounds[0]!.id } }), 1,
          `${theme}: 冻结取证不得重复发送留言`)
      } finally {
        await context.close().catch(() => undefined)
        await cleanupFixture(fx.cleanup).catch(() => undefined)
      }
    }
  } finally {
    await browser.close()
  }
})
