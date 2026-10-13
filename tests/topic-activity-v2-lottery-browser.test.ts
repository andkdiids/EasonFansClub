import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

test('Topic V2 lottery actual Web components at desktop and mobile widths', { skip: process.env.TOPIC_V2_LOTTERY_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const resolveFromApp = createRequire(join(process.cwd(), 'package.json'))
  const reactPath = resolveFromApp.resolve('react')
  const jsxRuntimePath = resolveFromApp.resolve('react/jsx-runtime')
  const reactDomPath = resolveFromApp.resolve('react-dom')
  const reactDomClientPath = resolveFromApp.resolve('react-dom/client')
  const schedulerPath = join(process.cwd(), 'node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler/index.js')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityV2LotteryPublic} from '@/components/activities/TopicActivityV2LotteryPublic'; import {TopicActivityV2LotteryAdmin} from '@/components/activities/TopicActivityV2LotteryAdmin'; import {TopicActivityV2LotteryClaim} from '@/components/activities/TopicActivityV2LotteryClaim'; const mode=new URLSearchParams(location.search).get('mode'); const entries=[{id:'entry-weibo',platformName:'微博',title:'分享任务',enabled:true,maxImages:1},{id:'entry-no-screenshot',platformName:'无截图平台',title:'文字任务',enabled:true,maxImages:0}]; createRoot(document.getElementById('root')).render(mode==='admin'||mode==='admin-locked'||mode==='admin-noperm'||mode==='admin-draw-error'||mode==='admin-no-key'||mode==='admin-poll'?<TopicActivityV2LotteryAdmin activityId="activity-one" entries={entries}/>:mode==='claim'?<TopicActivityV2LotteryClaim activityId="activity-one" winnerId="winner-one"/>:<TopicActivityV2LotteryPublic activityId="activity-one" isAuthenticated={true}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(),
    nodePaths: [join(process.cwd(), 'node_modules')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'normal-next-link-fixture', setup(buildPlugin: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path?: string; namespace?: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void }) {
      buildPlugin.onResolve({ filter: /^@\// }, (args) => {
        const base = join(process.cwd(), args.path.slice(2))
        const source = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js'].find((candidate) => existsSync(candidate))
        return { path: source || base }
      })
      buildPlugin.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
      buildPlugin.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: jsxRuntimePath }))
      buildPlugin.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
      buildPlugin.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: reactDomClientPath }))
      buildPlugin.onResolve({ filter: /^scheduler$/ }, () => ({ path: schedulerPath }))
      buildPlugin.onResolve({ filter: /^\.\// }, (args) => {
        const base = join(args.resolveDir, args.path)
        const source = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js'].find((candidate) => existsSync(candidate))
        return source ? { path: source } : {}
      })
      buildPlugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
      buildPlugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })

  const json = async (request: import('node:http').IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>
  }
  const config = {
    version: 1,
    enabled: true,
    title: '幸运抽奖',
    description: '完成平台任务后获得一次资格。',
    mode: 'MANUAL',
    drawAt: '2026-10-20T04:00:00.000Z',
    eligibilityDeadline: '2026-10-19T04:00:00.000Z',
    addressDeadline: '2026-10-25T04:00:00.000Z',
    publishWinners: true,
    retentionDays: 90,
    sourceEntryIds: ['entry-weibo'],
    prizes: [{ id: 'prize-stable-1', name: '限定明信片', description: '一套明信片', imageUrl: '/images/prize.png', quantity: 1, sortOrder: 0 }],
  }
  let drawWrites = 0
  let patchWrites = 0
  let addressWrites = 0
  let adminAddressReads = 0
  let publicReads = 0
  let adminReads = 0
  let activeMode = ''
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const queryMode = url.searchParams.get('mode') || ''
    if (queryMode) {
      activeMode = queryMode
      if (queryMode === 'public-poll') publicReads = 0
      if (queryMode === 'admin-poll') adminReads = 0
    }
    const mode = activeMode
    const send = (body: unknown, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)) }
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(build.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end('*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif}button,input,textarea,select{font:inherit}'); return }
    if (url.pathname === '/api/activities/activity-one/v2/lottery') {
      publicReads++
      if (mode === 'public-disabled') return send({ enabled: false, config: { ...config, enabled: false }, state: 'DISABLED', candidateCount: 0, myStatus: 'NOT_ENABLED', myEligibility: null, myWinner: null, winners: [] })
      const pollingDrawn = mode === 'public-poll' && publicReads >= 2
      return send({ enabled: true, config, state: pollingDrawn ? 'DRAWN' : 'COLLECTING', candidateCount: 1, myStatus: mode === 'public-no-winner' ? 'NOT_WON' : 'ELIGIBLE', myEligibility: { count: 1 }, myWinner: mode === 'public-no-winner' ? null : { id: 'winner-one', prize: config.prizes[0], wonAt: '2026-10-20T04:01:00.000Z', addressDeadline: config.addressDeadline, shippingStatus: 'WAITING_ADDRESS', addressSaved: false, claimUrl: '/activities/activity-one/lottery/claims/winner-one' }, winners: [{ nickname: '公开昵称', uid: 'ECFC001', prizeName: '限定明信片' }] })
    }
    if (url.pathname === '/api/admin/activities/activity-one/v2/lottery') {
      adminReads++
      const adminConfig = mode === 'admin-no-key' ? { ...config, enabled: false } : config
      if (request.method === 'PATCH') { await json(request); patchWrites++; return send({ config: adminConfig, configLocked: mode === 'admin-locked', addressEncryptionReady: mode !== 'admin-no-key', state: 'COLLECTING', candidateCount: 1, pendingSubmissionCount: 0, canShip: mode !== 'admin-noperm', winners: [], draw: null }) }
      const pollingDrawn = mode === 'admin-poll' && adminReads >= 2
      return send({ config: adminConfig, configLocked: mode === 'admin-locked', addressEncryptionReady: mode !== 'admin-no-key', state: pollingDrawn ? 'DRAWN' : 'COLLECTING', candidateCount: pollingDrawn ? 2 : 1, pendingSubmissionCount: 0, canShip: mode !== 'admin-noperm', winners: [{ id: 'winner-one', nickname: '中奖用户', uid: 'ECFC001', prizeName: '限定明信片', wonAt: '2026-10-20T04:01:00.000Z', addressDeadline: config.addressDeadline, addressSaved: true, shippingStatus: 'WAITING_ADDRESS', shippedAt: null }], draw: null })
    }
    if (url.pathname === '/api/admin/activities/activity-one/v2/lottery/draw' && request.method === 'POST') {
      drawWrites++
      if (mode === 'admin-draw-error') return send({ message: '本地模拟开奖失败' }, 500)
      return send({ state: 'DRAWN' })
    }
    if (url.pathname.endsWith('/v2/lottery/winners/winner-one/address') && url.pathname.startsWith('/api/admin/')) {
      adminAddressReads++
      if (mode === 'admin-noperm') return send({ message: '没有物流权限' }, 403)
      return send({ winner: { id: 'winner-one', prizeName: '限定明信片', addressDeadline: config.addressDeadline, shippingStatus: 'WAITING_ADDRESS' }, address: { recipient: '保密收件人', phone: '13800000000', province: '广东省', city: '广州市', district: '天河区', address: '保密地址', remark: '' }, shipment: null })
    }
    if (url.pathname.endsWith('/v2/lottery/winners/winner-one/shipment') && request.method === 'POST') return send({ ok: true })
    if (url.pathname === '/api/activities/activity-one/v2/lottery/winners/winner-one/address') {
      if (request.method === 'PUT') { await json(request); addressWrites++; if (addressWrites === 1) return send({ message: '本地模拟保存失败' }, 500); return send({ winner: { id: 'winner-one', prizeName: '限定明信片', addressDeadline: config.addressDeadline, shippingStatus: 'ADDRESS_SAVED' }, address: { recipient: '测试收件人', phone: '13800000000', province: '广东省', city: '广州市', district: '天河区', address: '测试详细地址', remark: '门卫代收' }, shipment: null }) }
      return send({ winner: { id: 'winner-one', prizeName: '限定明信片', addressDeadline: config.addressDeadline, shippingStatus: 'WAITING_ADDRESS' }, address: null, shipment: null })
    }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const browser = await chromium.launch({ headless: true, ...(require('node:fs').existsSync(edge) ? { executablePath: edge } : {}) })
  try {
    for (const width of [1024, 360, 390, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${port}/?mode=public`)
      await page.getByRole('heading', { name: '幸运抽奖', exact: true }).waitFor()
      await page.getByText('你已获得本次抽奖资格', { exact: false }).waitFor()
      assert.equal(await page.locator('form').count(), 0, '中奖公开模块不应直接渲染地址表单')
      assert.equal(await page.getByText('保密地址', { exact: false }).count(), 0, '公开模块不能泄露收货地址')
      await page.goto(`http://127.0.0.1:${port}/?mode=public-no-winner`)
      await page.getByText('本次未中奖', { exact: false }).waitFor()
      assert.equal(await page.locator('form').count(), 0, '未中奖用户不应看到收货表单')
      await context.close()
      assert.deepEqual(errors, [], 'public component should not crash at width ' + width)
    }

    const disabledContext = await browser.newContext({ viewport: { width: 1024, height: 844 } })
    const disabledPage = await disabledContext.newPage()
    const disabledResponse = disabledPage.waitForResponse((response) => response.url().includes('/api/activities/activity-one/v2/lottery') && response.request().method() === 'GET')
    await disabledPage.goto(`http://127.0.0.1:${port}/?mode=public-disabled`)
    await disabledResponse
    assert.equal(await disabledPage.getByRole('region', { name: '活动实物抽奖' }).count(), 0, 'disabled lottery should not render a duplicate public entry point')
    await disabledContext.close()

    const publicPollContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const publicPollPage = await publicPollContext.newPage()
    await publicPollPage.clock.install()
    await publicPollPage.goto(`http://127.0.0.1:${port}/?mode=public-poll`)
    await publicPollPage.getByRole('heading', { name: '幸运抽奖', exact: true }).waitFor()
    assert.equal(publicReads, 1, 'public panel performs its initial read once')
    await publicPollPage.clock.fastForward(30_000)
    await publicPollPage.getByText('已开奖', { exact: true }).waitFor()
    assert.equal(publicReads, 2, 'visible public panel refreshes after the bounded interval')
    await publicPollPage.clock.fastForward(30_000)
    assert.equal(publicReads, 2, 'public polling stops after DRAWN')
    await publicPollContext.close()

    const adminPollContext = await browser.newContext({ viewport: { width: 1024, height: 844 } })
    const adminPollPage = await adminPollContext.newPage()
    await adminPollPage.clock.install()
    await adminPollPage.goto(`http://127.0.0.1:${port}/?mode=admin-poll`)
    await adminPollPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await adminPollPage.getByText('候选资格：1', { exact: true }).waitFor()
    assert.equal(adminReads, 1, 'admin panel performs its initial read once')
    await adminPollPage.evaluate(() => window.dispatchEvent(new Event('focus')))
    await adminPollPage.getByText('候选资格：2', { exact: true }).waitFor()
    assert.equal(adminReads, 2, 'focus refresh observes review changes from another browser')
    await adminPollPage.clock.fastForward(30_000)
    assert.equal(adminReads, 2, 'admin polling stops after DRAWN')
    await adminPollContext.close()

    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const adminPage = await adminContext.newPage()
    await adminPage.goto(`http://127.0.0.1:${port}/?mode=admin`)
    await adminPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await adminPage.getByLabel('启用实物抽奖（旧活动默认关闭）').waitFor()
    await adminPage.getByText('需至少1张截图，不能作为抽奖资格来源', { exact: false }).waitFor()
    assert.equal(await adminPage.getByRole('checkbox', { name: '选择资格来源：无截图平台 · 文字任务' }).isDisabled(), true, 'source with maxImages < 1 cannot be selected')
    assert.equal(await adminPage.getByLabel('启用实物抽奖（旧活动默认关闭）').isChecked(), true)
    await adminPage.getByLabel('启用实物抽奖（旧活动默认关闭）').uncheck()
    assert.equal(await adminPage.getByLabel('启用实物抽奖（旧活动默认关闭）').isChecked(), false)
    await adminPage.getByLabel('启用实物抽奖（旧活动默认关闭）').check()
    const prizeId = await adminPage.getByText('奖品编号：', { exact: false }).first().textContent()
    await adminPage.getByRole('button', { name: '添加奖品', exact: true }).click()
    assert.notEqual(await adminPage.getByText('奖品编号：', { exact: false }).last().textContent(), prizeId, 'new prize gets a stable UI-created id')
    await adminPage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).click()
    await adminPage.getByText('实物抽奖配置已保存', { exact: false }).waitFor()
    await adminPage.getByRole('button', { name: '确认开奖', exact: true }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: '确认开奖', exact: true }).click()
    await adminPage.getByText('开奖已确认', { exact: false }).waitFor()
    assert.equal(drawWrites, 1)
    await adminContext.close()

    const lockedContext = await browser.newContext({ viewport: { width: 1024, height: 844 } })
    const lockedPage = await lockedContext.newPage()
    await lockedPage.goto(`http://127.0.0.1:${port}/?mode=admin-locked`)
    await lockedPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await lockedPage.getByText('资格与库存已锁定', { exact: true }).waitFor()
    assert.equal(await lockedPage.getByLabel('奖品名称').isDisabled(), true, 'fairness lock disables prize edits')
    assert.equal(await lockedPage.getByLabel('数量').isDisabled(), true, 'fairness lock disables inventory edits')
    await lockedContext.close()

    const failedDrawContext = await browser.newContext({ viewport: { width: 1024, height: 844 } })
    const failedDrawPage = await failedDrawContext.newPage()
    await failedDrawPage.goto(`http://127.0.0.1:${port}/?mode=admin-draw-error`)
    await failedDrawPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await failedDrawPage.getByRole('button', { name: '确认开奖', exact: true }).click()
    await failedDrawPage.getByRole('dialog').getByRole('button', { name: '确认开奖', exact: true }).click()
    await failedDrawPage.getByRole('alert').filter({ hasText: '本地模拟开奖失败' }).last().waitFor()
    assert.equal(await failedDrawPage.getByRole('heading', { name: '实物奖品与库存', exact: true }).count(), 1, 'API failure keeps admin page open')
    await failedDrawContext.close()

    const noKeyContext = await browser.newContext({ viewport: { width: 1024, height: 844 } })
    const noKeyPage = await noKeyContext.newPage()
    await noKeyPage.goto(`http://127.0.0.1:${port}/?mode=admin-no-key`)
    await noKeyPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await noKeyPage.getByText('收件资料加密未配置，暂不可启用实物抽奖', { exact: true }).waitFor()
    assert.equal(await noKeyPage.getByLabel('启用实物抽奖（旧活动默认关闭）').isDisabled(), true, 'missing key blocks enabling while default remains disabled')
    await noKeyContext.close()

    const noPermissionContext = await browser.newContext({ viewport: { width: 1024, height: 844 } })
    const noPermissionPage = await noPermissionContext.newPage()
    await noPermissionPage.goto(`http://127.0.0.1:${port}/?mode=admin-noperm`)
    await noPermissionPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await noPermissionPage.getByText('中奖用户', { exact: false }).waitFor()
    assert.equal(await noPermissionPage.getByRole('button', { name: '查看收货信息', exact: true }).count(), 0, 'shipping permission hides PII entry point')
    await noPermissionContext.close()

    const claimContext = await browser.newContext({ viewport: { width: 360, height: 844 }, isMobile: true, hasTouch: true })
    const claimPage = await claimContext.newPage()
    await claimPage.goto(`http://127.0.0.1:${port}/?mode=claim`)
    await claimPage.getByLabel('收件人').fill('测试收件人')
    await claimPage.getByLabel('联系电话').fill('13800000000')
    await claimPage.getByLabel('省').fill('广东省')
    await claimPage.getByLabel('市').fill('广州市')
    await claimPage.getByLabel('区 / 县').fill('天河区')
    await claimPage.getByLabel('详细地址').fill('测试详细地址')
    await claimPage.getByLabel('配送备注（可选）').fill('门卫代收')
    await claimPage.getByRole('button', { name: '提交收货信息', exact: true }).click()
    await claimPage.getByText('请先同意', { exact: false }).waitFor()
    assert.equal(addressWrites, 0, 'consent is required before PUT')
    await claimPage.getByText('我同意将以上信息用于本次抽奖奖品配送', { exact: false }).click()
    await claimPage.getByRole('button', { name: '提交收货信息', exact: true }).click()
    await claimPage.getByText('本地模拟保存失败', { exact: true }).waitFor()
    assert.equal(await claimPage.getByLabel('详细地址').inputValue(), '测试详细地址', 'failed save keeps draft')
    await claimPage.getByLabel('我同意将以上信息用于本次抽奖奖品配送，并理解发货后不能修改。').check()
    await claimPage.getByRole('button', { name: '提交收货信息', exact: true }).click()
    await claimPage.getByText('收货信息已保存', { exact: false }).waitFor()
    assert.equal(addressWrites, 2)
    await claimContext.close()
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  assert.equal(patchWrites, 1, 'explicit admin config save uses the lottery PATCH contract')
  assert.equal(adminAddressReads, 0, 'permission-hidden admin path must not be queried')
})
