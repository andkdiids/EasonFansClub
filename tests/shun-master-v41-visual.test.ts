import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Page } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { setShunEnabled, shunAttempt, shunCapture, shunSendNotification, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

/**
 * V4.1 visual evidence, not source assertions.
 *
 * - The anonymous letter is rendered in light and in midnight mode and the
 *   *computed* colours are checked for contrast, then screenshotted.
 * - The sending animation is captured stage by stage (paper, folding, half
 *   inserted, fully inserted + sealed, stamping, wax, flying) with geometry
 *   probe values, so a screenshot that merely jumps is impossible to pass off as
 *   a finished animation.
 *
 * Requires the isolated MySQL fixture and a running Next.js server:
 * `tsx --test --test-concurrency=1 tests/shun-master-v41-visual.test.ts`.
 */

const MESSAGE = '范范Vanessa：这句话只有你能看到\n第二行也要完整显示'

function luminance(rgb: string) {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

async function computed(page: Page, selector: string, property: string) {
  return page.evaluate(([sel, prop]) => {
    const node = document.querySelector(sel)
    return node ? getComputedStyle(node).getPropertyValue(prop) : ''
  }, [selector, property] as const)
}

test('anonymous letter stays readable in light and midnight mode', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const create = (points = 0) => {
    const name = 'v41-visual-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      points, passwordHash: 'fixture', Profile: { create: { displayName: name } } } })
  }
  const [admin, actor, victim, ...decoys] = await Promise.all([
    create(), create(), create(60), create(), create(), create(), create(),
  ])
  const outsiders = await prisma.user.findMany({
    where: { id: { notIn: [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)] } }, select: { id: true },
  })
  await prisma.shunMasterProtection.createMany({
    data: [...outsiders, admin, actor].map(({ id: userId }) => ({ userId, protected: true })), skipDuplicates: true,
  })
  await updateShunConfig(admin.id, { ...defaultShunConfig, enabled: false })
  await setShunEnabled(admin.id, true)
  const take = await shunAttempt(actor.id, randomUUID())
  assert.equal(take.person?.uid, victim.uid)
  await shunSendNotification(actor.id, take.id, MESSAGE)
  const token = await createSessionToken(victim)

  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    if (output) await mkdir(output, { recursive: true })
    for (const theme of ['day', 'midnight'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, colorScheme: theme === 'midnight' ? 'dark' : 'light',
      })
      await context.addInitScript((value) => { try { window.localStorage.setItem('ecfc-theme', value) } catch { /* private mode */ } }, theme)
      await context.addCookies([{ name: authCookieName, value: token, url: base }])
      const page = await context.newPage()
      page.setDefaultTimeout(120000)
      await page.goto(base + '/shun-master?record=' + take.id + '&side=in&letter=1')
      const letter = page.getByRole('dialog').filter({ hasText: '一封来自神秘 EF 的信' })
      await letter.waitFor()
      await page.getByRole('button', { name: '跳过动画' }).click().catch(() => undefined)
      await letter.getByText('这句话只有你能看到').waitFor()

      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
      const probes: Record<string, string> = {
        paperBg: await computed(page, 'article[class*="paper"]', 'background-color'),
        titleColor: await computed(page, 'article[class*="paper"] h2', 'color'),
        bodyColor: await computed(page, 'article[class*="paper"] p[class*="body"]', 'color'),
        signatureColor: await computed(page, 'p[class*="signature"]', 'color'),
        primaryColor: await computed(page, 'button[class*="primary"]', 'color'),
      }
      // The paper is cream and the ink is near-black in BOTH themes.
      assert.ok(luminance(probes.paperBg) > 0.85, `${theme}: 信纸必须仍是米白，实际 ${probes.paperBg}`)
      for (const key of ['titleColor', 'bodyColor'] as const) {
        assert.ok(luminance(probes[key]) < 0.25, `${theme}: ${key} 必须是深色，实际 ${probes[key]}`)
      }
      assert.ok(luminance(probes.signatureColor) < 0.45, `${theme}: 落款必须是深灰，实际 ${probes.signatureColor}`)
      assert.ok(luminance(probes.primaryColor) > 0.85, `${theme}: 主按钮文字必须浅色，实际 ${probes.primaryColor}`)
      if (output) await page.screenshot({ path: join(output, `letter-${theme}.png`) })
      await context.close()
    }
    // Settled state in midnight: the revealed sender, the verdict and the
    // amount must stay readable on the same cream paper.
    await shunCapture(victim.id, take.id, { mode: 2, uid: actor.uid })
    const settled = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
    await settled.addInitScript(() => { try { window.localStorage.setItem('ecfc-theme', 'midnight') } catch { /* ignore */ } })
    await settled.addCookies([{ name: authCookieName, value: token, url: base }])
    const settledPage = await settled.newPage()
    settledPage.setDefaultTimeout(120000)
    await settledPage.goto(base + '/shun-master?record=' + take.id + '&side=in&letter=1')
    const settledLetter = settledPage.getByRole('dialog').filter({ hasText: actor.nickname })
    await settledLetter.waitFor()
    await settledPage.getByRole('button', { name: '跳过动画' }).click().catch(() => undefined)
    await settledLetter.getByText('抓到你啦！').waitFor()
    for (const [label, selector] of [
      ['调查结果标题', '[class*="verdictTitle"]'],
      ['调查结果金额', '[class*="verdictAmount"]'],
      ['真实顺取者昵称', '[class*="verdictPerson"]'],
    ] as const) {
      const color = await computed(settledPage, selector, 'color')
      assert.ok(luminance(color) < 0.35, `midnight: ${label}必须仍是深色，实际 ${color}`)
    }
    if (output) await settledPage.screenshot({ path: join(output, 'letter-midnight-settled.png') })
    await settled.close()
  } finally {
    await browser.close()
    await prisma.shunMasterProtection.deleteMany({
      where: { userId: { in: [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)] } },
    })
    await prisma.$disconnect()
  }
})

test('sending animation is captured beat by beat on a phone viewport', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const create = (points = 0) => {
    const name = 'v41-anim-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      points, passwordHash: 'fixture', Profile: { create: { displayName: name } } } })
  }
  const [admin, actor, victim, ...decoys] = await Promise.all([
    create(), create(), create(60), create(), create(), create(), create(),
  ])
  const outsiders = await prisma.user.findMany({
    where: { id: { notIn: [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)] } }, select: { id: true },
  })
  await prisma.shunMasterProtection.createMany({
    data: [...outsiders, admin].map(({ id: userId }) => ({ userId, protected: true })), skipDuplicates: true,
  })
  await updateShunConfig(admin.id, { ...defaultShunConfig, enabled: false })
  await setShunEnabled(admin.id, true)

  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    if (output) await mkdir(output, { recursive: true })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await context.addCookies([{ name: authCookieName, value: await createSessionToken(actor), url: base }])
    const page = await context.newPage()
    page.setDefaultTimeout(120000)
    await page.goto(base + '/shun-master')
    await page.getByRole('button', { name: '顺一手' }).click()
    const result = page.getByRole('dialog', { name: '顺走啦！' })
    await result.waitFor()
    await result.getByRole('button', { name: '匿名留言', exact: true }).click()
    const composer = page.getByRole('dialog', { name: '给 TA 留一句匿名的话' })
    await composer.getByLabel('匿名留言内容').fill('这句话只有你能看到\n第二行也要完整显示')
    await composer.getByRole('button', { name: '发送留言', exact: true }).click()

    // The page has other [data-stage] nodes (the reading animation), so scope
    // everything to the sending dialog by its aria-label.
    const anim = page.getByRole('dialog', { name: '正在寄出匿名信' })
    await anim.waitFor()

    // Install an in-page rAF sampler that records the peak geometry of EVERY
    // frame into window.__SHUN_PROBE. This decouples measurement from the test's
    // wall clock: taking a screenshot costs hundreds of ms, which previously
    // pushed the loop past the 3.9s animation so late beats sampled an unmounted
    // dialog. The sampler sees the real intermediate frames regardless.
    // Injected as a plain JS string via eval so esbuild's keepNames helper
    // (__name) is never referenced in the browser. Local function declarations
    // in a compiled evaluate callback get wrapped by that helper and crash.
    await page.evaluate(() => {
      eval(`(function () {
        window.__SHUN_PROBE = {};
        window.__SHUN_SAMPLE_DONE = false;
        function tick() {
          var root = document.querySelector('[role="dialog"][aria-label="正在寄出匿名信"]');
          var stage = root && root.querySelector('[data-stage]') && root.querySelector('[data-stage]').getAttribute('data-stage');
          if (root && stage) {
            var sheet = root.querySelector('[class*="sheet"]:not([class*="sheetLower"]):not([class*="sheetUpper"])');
            var lower = root.querySelector('[class*="sheetLower"]');
            var wax = root.querySelector('[class*="wax"]');
            var stamp = root.querySelector('[class*="stamp"]');
            var envelope = root.querySelector('[class*="envelope"]');
            var sb = sheet && sheet.getBoundingClientRect();
            var eb = envelope && envelope.getBoundingClientRect();
            var r = window.__SHUN_PROBE[stage] || (window.__SHUN_PROBE[stage] = {frames:0, sheetTopMax:-1, lowerTransform:'', stampOpacity:0, waxOpacity:0, envelopeTopMin:1e9, envelopeLeftMax:-1});
            r.frames++;
            if (sb) r.sheetTopMax = Math.max(r.sheetTopMax, sb.top);
            if (lower) { var t = getComputedStyle(lower).transform; if (t.indexOf('matrix3d') === 0) r.lowerTransform = t; }
            if (stamp) r.stampOpacity = Math.max(r.stampOpacity, Number(getComputedStyle(stamp).opacity));
            if (wax) r.waxOpacity = Math.max(r.waxOpacity, Number(getComputedStyle(wax).opacity));
            if (eb) { r.envelopeTopMin = Math.min(r.envelopeTopMin, eb.top); r.envelopeLeftMax = Math.max(r.envelopeLeftMax, eb.left); }
          }
          if (!window.__SHUN_SAMPLE_DONE) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      })()`)
    })

    // Screenshots are evidence only, never the source of truth for assertions.
    // waitFor is best-effort: if a shot is slow and misses its beat that is fine,
    // the rAF sampler already captured the real geometry.
    const beats = ['paper', 'folding', 'inserting', 'sealing', 'stamping', 'flying'] as const
    for (const stage of beats) {
      await page.waitForFunction((s) =>
        document.querySelector('[role="dialog"][aria-label="正在寄出匿名信"] [data-stage]')?.getAttribute('data-stage') === s,
      stage, { timeout: 8000 }).catch(() => undefined)
      // The fly-out beat starts with the envelope still centred; wait a little
      // into it so the evidence shot shows it actually leaving the viewport.
      if (stage === 'flying') await page.waitForTimeout(320)
      if (output) await page.screenshot({ path: join(output, `send-${stage}.png`) }).catch(() => undefined)
    }
    // Let the sampler run through the short flying beat until the dialog is gone.
    await page.getByRole('dialog', { name: '匿名信已送达 ✉️' }).waitFor()
    await page.evaluate(() => { (window as unknown as { __SHUN_SAMPLE_DONE: boolean }).__SHUN_SAMPLE_DONE = true })
    const p = (await page.evaluate(() =>
      (window as unknown as { __SHUN_PROBE: Record<string, Record<string, number | string>> }).__SHUN_PROBE)) as Record<string, Record<string, number | string>>
    console.log('SEND_ANIMATION_PROBE', JSON.stringify(p))

    // 1) the paper really folds: the lower half rotates around the crease
    assert.match(String(p.folding.lowerTransform), /^matrix3d\(/,
      `折叠必须是 3D 旋转而不是压扁（stage=${String(p.folding.frames)} 帧）`)
    // 2) during insertion the paper moves down while the envelope is on screen
    assert.ok(Number(p.inserting.sheetTopMax) > Number(p.paper.sheetTopMax), '装入时信纸必须向下移动')
    // 3) only the stamping beat shows the stamp, and it leaves wax behind
    assert.ok(Number(p.sealing.stampOpacity) === 0, '封口阶段不应出现印章')
    assert.ok(Number(p.stamping.stampOpacity) > 0.3, '盖章阶段必须出现印章本体')
    assert.ok(Number(p.stamping.waxOpacity) > 0.3, '印章落下后必须留下火漆')
    assert.ok(Number(p.flying.waxOpacity) === 1, '飞出的信封必须带着火漆')
    // 4) the sealed envelope actually leaves the viewport to the upper right
    const paperTop = Number(p.paper.envelopeTopMin)
    const paperLeft = Number(p.paper.envelopeLeftMax)
    assert.ok(Number(p.flying.envelopeTopMin) < paperTop - 40, '信封必须向上飞出')
    assert.ok(Number(p.flying.envelopeLeftMax) > paperLeft + 20, '信封必须向右飞出')

    const rounds = await prisma.shunMasterRound.findMany({ where: { actorId: actor.id } })
    assert.equal(rounds.length, 1)
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: rounds[0].id } }), 1,
      '跳过动画不得重复发送')
    assert.ok(output, '必须提供截图目录')
    await context.close()
  } finally {
    await browser.close()
    await prisma.shunMasterProtection.deleteMany({
      where: { userId: { in: [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)] } },
    })
    await prisma.$disconnect()
  }
})
