import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { createDefaultTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'

test('wizard actual React UI: draft + V2 + lottery + publish fixture transport at desktop/mobile widths', { skip: process.env.TOPIC_WIZARD_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>
  }
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TopicActivityWizard} from './components/activities/TopicActivityWizard';function Fixture(){const [open,setOpen]=useState(true);const [edited,setEdited]=useState('');return <main><button onClick={()=>setOpen(true)}>重新打开向导</button><output aria-label="已打开活动编辑">{edited}</output><TopicActivityWizard open={open} onClose={()=>setOpen(false)} onOpenEditor={async id=>setEdited(id)} badgeOptions={[{id:'fixture-badge',name:'测试勋章'}]}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"' },
  })
  const css = (await require('postcss')([require('tailwindcss')({
    content: ['./components/activities/TopicActivityWizard*.tsx', './components/ConfirmDialog.tsx'],
  })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css as string
  const apiRequests: string[] = []
  let savedActivity: Record<string, unknown> | null = null
  let savedProgram = createDefaultTopicActivityV2Program()
  let savedLottery = defaultTopicLotteryConfig()
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) apiRequests.push(`${req.method} ${req.url}`)
    if (req.url?.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST' && req.url === '/api/admin/activities') {
        let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
          savedActivity = { ...JSON.parse(body), id: 'fixture-activity-001' }
          savedProgram = createDefaultTopicActivityV2Program()
          savedLottery = defaultTopicLotteryConfig()
          setTimeout(() => { res.statusCode = 201; res.end(JSON.stringify({ activity: savedActivity })) }, 100)
        }); return
      }
      if (req.method === 'GET' && req.url === '/api/admin/activities/fixture-activity-001') { res.end(JSON.stringify({ activity: savedActivity })); return }
      if (req.method === 'PATCH' && req.url === '/api/admin/activities/fixture-activity-001') {
        let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
          assert.deepEqual(JSON.parse(body), { status: 'PUBLISHED' })
          savedActivity = { ...savedActivity, status: 'PUBLISHED' }
          setTimeout(() => res.end(JSON.stringify({ success: true, activityId: 'fixture-activity-001', activity: savedActivity })), 100)
        }); return
      }
      if (req.url === '/api/admin/activities/fixture-activity-001/v2/lottery') {
        if (req.method === 'PATCH') {
          let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
            const payload = JSON.parse(body); assert.deepEqual(Object.keys(payload), ['config'])
            savedLottery = payload.config
            setTimeout(() => res.end(JSON.stringify({ config: savedLottery })), 100)
          }); return
        }
        if (req.method === 'GET') { res.end(JSON.stringify({ config: savedLottery, configLocked: false, addressEncryptionReady: true, state: savedLottery.enabled ? 'NOT_STARTED' : 'DISABLED', candidateCount: 0, pendingSubmissionCount: 0, draw: null, winners: [], canShip: false })); return }
      }
      if (req.url === '/api/admin/activities/fixture-activity-001/v2') {
        if (req.method === 'PATCH') {
          let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
            const payload = JSON.parse(body); assert.deepEqual(Object.keys(payload), ['program'])
            savedProgram = payload.program
            setTimeout(() => res.end(JSON.stringify({ program: savedProgram })), 100)
          }); return
        }
        if (req.method === 'GET') { res.end(JSON.stringify({ activity: savedActivity, canReview: true, program: savedProgram })); return }
      }
      res.statusCode = 404; res.end('{}'); return
    }
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1280, 390, 360]) await t.test(`actual wizard interaction ${width}px`, async () => {
      apiRequests.length = 0
      const page = await browser!.newPage({ viewport: { width, height: 900 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.ok(await page.getByRole('alert').innerText().then((text) => text.includes('活动名称')))
      await page.getByLabel('活动名称', { exact: true }).fill('天使的礼物')
      await page.getByLabel('活动介绍', { exact: true }).fill('发布相关内容参与本活动。')
      await page.getByLabel('活动开始（北京时间）', { exact: true }).fill('2030-10-01T09:00')
      await page.getByLabel('活动结束（北京时间）', { exact: true }).fill('2030-10-10T18:00')
      await page.getByLabel('活动封面', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64') })
      await page.getByAltText('活动封面本地预览').waitFor()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      assert.equal(await page.getByLabel('允许图片附件').isChecked(), true)
      assert.equal(await page.getByLabel('参与评论需要管理员审核（现有规则，不可关闭）').isDisabled(), true)
      await page.getByLabel('用户如何参与话题活动', { exact: true }).fill('提交平台分享截图，等待审核。')
      await page.getByLabel('微博', { exact: true }).check()
      await page.getByLabel('小红书', { exact: true }).check()
      await page.getByLabel('允许图片附件').uncheck()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      assert.ok((await page.getByRole('alert').innerText()).includes('开启图片附件'))
      await page.getByLabel('允许图片附件').check()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByLabel('微博挂号费奖励', { exact: true }).fill('20')
      await page.getByLabel('启用参与勋章').check()
      await page.getByLabel('参与奖励勋章', { exact: true }).selectOption('fixture-badge')
      await page.getByLabel('开启本话题活动抽奖').check()
      assert.equal(await page.getByLabel('微博截图任务审核通过').isChecked(), true)
      await page.getByRole('button', { name: '添加奖品', exact: true }).click()
      await page.getByLabel('奖品 1名称', { exact: true }).fill('纪念礼物')
      await page.getByLabel('奖品 1数量', { exact: true }).fill('3')
      await page.getByLabel('开奖时间（北京时间）', { exact: true }).fill('2030-10-09T18:00')
      await page.getByLabel('收件截止（北京时间）', { exact: true }).fill('2030-10-18T18:00')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      assert.ok((await page.getByRole('alert').innerText()).includes('开奖时间不能早于'))
      await page.getByLabel('开奖时间（北京时间）', { exact: true }).fill('2030-10-11T18:00')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      assert.ok((await page.getByRole('region', { name: '话题活动创建向导' }).innerText()).includes('最多获得一次资格'))
      assert.equal(await page.getByText('测试版本', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: '保存话题 V2 配置', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '保存抽奖配置', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '发布话题活动', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).click()
      assert.ok((await page.getByRole('alert').innerText()).includes('封面尚未上传'))
      assert.deepEqual(apiRequests, [])
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '上一步', exact: true }).click()
      await page.getByRole('button', { name: '移除活动封面', exact: true }).click()
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.deepEqual(apiRequests, [])
      await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).click()
      await page.getByRole('button', { name: '确认创建草稿', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '活动草稿已创建并回读确认' }).waitFor()
      assert.deepEqual(apiRequests, ['POST /api/admin/activities', 'GET /api/admin/activities/fixture-activity-001'])
      assert.equal(savedActivity?.status, 'DRAFT')
      assert.equal('program' in savedActivity!, false); assert.equal('lottery' in savedActivity!, false)
      assert.equal(await page.getByRole('button', { name: '恢复本地快照' }).isDisabled(), true)
      await page.getByRole('button', { name: '重新回读草稿', exact: true }).click()
      await page.getByRole('button', { name: '确认回读', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="活动保存会话"]')?.textContent?.includes('请求锁：空闲'))
      assert.deepEqual(apiRequests, ['POST /api/admin/activities', 'GET /api/admin/activities/fixture-activity-001', 'GET /api/admin/activities/fixture-activity-001'])
      await page.getByRole('button', { name: '上一步', exact: true }).click()
      await page.getByLabel('微博挂号费奖励', { exact: true }).fill('21')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('button', { name: '保存话题 V2 配置', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(apiRequests.length, 3)
      await page.getByRole('button', { name: '保存话题 V2 配置', exact: true }).click()
      await page.getByRole('button', { name: '确认保存 V2', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '话题 V2 配置已回读确认' }).waitFor()
      assert.equal(savedProgram.entries[0].points, 21)
      assert.equal(apiRequests.filter((call: string) => call.startsWith('PATCH')).length, 1)
      assert.equal(apiRequests.filter((call: string) => call.startsWith('POST')).length, 1)
      assert.ok(apiRequests.every((call) => !/lottery|upload|publish|draw/.test(call)))
      await page.getByRole('button', { name: '核对 V2 回读', exact: true }).click()
      await page.getByRole('button', { name: '确认核对 V2', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="活动保存会话"]')?.textContent?.includes('请求锁：空闲'))
      assert.equal(apiRequests.filter((call: string) => call.startsWith('PATCH')).length, 1)
      await page.getByRole('button', { name: '上一步', exact: true }).click()
      assert.equal(await page.getByLabel('微博挂号费奖励', { exact: true }).isDisabled(), true)
      await page.getByLabel('奖品 1数量', { exact: true }).fill('4')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      const beforeLottery = apiRequests.length
      await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(apiRequests.length, beforeLottery)
      await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
      await page.getByRole('button', { name: '确认保存抽奖配置', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '抽奖配置已保存并回读确认' }).waitFor()
      assert.equal(savedLottery.prizes[0].quantity, 4)
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001/v2/lottery').length, 1)
      assert.ok(apiRequests.every((call) => !/\/draw|\/winners|\/shipment|\/address|\/reward|upload|publish/.test(call)))
      await page.getByRole('button', { name: '核对抽奖回读', exact: true }).click()
      await page.getByRole('button', { name: '确认核对抽奖', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="活动保存会话"]')?.textContent?.includes('请求锁：空闲'))
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001/v2/lottery').length, 1)
      assert.equal(savedActivity?.status, 'DRAFT')
      assert.equal(apiRequests.filter((call: string) => call.startsWith('POST')).length, 1)
      assert.equal(await page.getByRole('button', { name: '核对 V2 回读', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: '收起向导', exact: true }).click()
      await page.getByRole('button', { name: '收起并保留本地输入', exact: true }).click()
      await page.getByRole('button', { name: '重新打开向导', exact: true }).click()
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '上一步', exact: true }).click()
      assert.equal(await page.getByLabel('活动名称', { exact: true }).inputValue(), '天使的礼物')
      assert.equal(await page.getByLabel('活动名称', { exact: true }).isDisabled(), true)
      assert.equal(await page.getByAltText('活动封面本地预览').count(), 0)
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步', exact: true }).click()
      const beforePublish = apiRequests.length
      await page.getByRole('button', { name: '发布话题活动', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(apiRequests.length, beforePublish)
      await page.getByRole('button', { name: '发布话题活动', exact: true }).click()
      await page.getByRole('button', { name: '确认发布活动', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '活动已发布，GET 回读确认 PUBLISHED' }).waitFor()
      assert.equal(savedActivity?.status, 'PUBLISHED')
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001').length, 1)
      assert.equal(apiRequests.at(-1), 'GET /api/admin/activities/fixture-activity-001')
      assert.equal(await page.getByRole('button', { name: '核验发布状态', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '核对抽奖回读', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: '进入活动编辑页', exact: true }).click()
      assert.equal(await page.getByLabel('已打开活动编辑').innerText(), 'fixture-activity-001')
      assert.ok(apiRequests.every((call) => !/\/draw|\/winners|\/shipment|\/address|\/reward|upload/.test(call)))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('ordinary discussion cannot enable a lottery without screenshot tasks', async () => {
      apiRequests.length = 0
      const page = await browser!.newPage()
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.getByLabel('活动名称', { exact: true }).fill('普通话题')
      await page.getByLabel('活动介绍', { exact: true }).fill('活动介绍')
      await page.getByLabel('活动开始（北京时间）', { exact: true }).fill('2030-10-01T09:00')
      await page.getByLabel('活动结束（北京时间）', { exact: true }).fill('2030-10-10T18:00')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByLabel('用户如何参与话题活动', { exact: true }).fill('讨论')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByLabel('开启本话题活动抽奖').check()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      assert.ok((await page.getByRole('alert').innerText()).includes('普通讨论评论'))
      assert.deepEqual(apiRequests, [])
      await page.close()
    })
    await t.test('local snapshot restore replaces inputs and requires image re-selection without writes', async () => {
      const page = await browser!.newPage()
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.getByLabel('活动名称', { exact: true }).fill('快照活动')
      await page.getByLabel('活动封面', { exact: true }).setInputFiles({ name: 'snapshot.png', mimeType: 'image/png', buffer: Buffer.from('fixture-only') })
      await page.getByRole('button', { name: '保留本地快照', exact: true }).click()
      await page.getByLabel('活动名称', { exact: true }).fill('快照之后的修改')
      await page.getByRole('button', { name: '恢复本地快照', exact: true }).click()
      await page.getByRole('button', { name: '确认恢复快照', exact: true }).click()
      assert.equal(await page.getByLabel('活动名称', { exact: true }).inputValue(), '快照活动')
      assert.equal(await page.getByAltText('活动封面本地预览').count(), 0)
      await page.getByText('封面文件未保存在快照中，请重新选择。', { exact: true }).waitFor()
      assert.deepEqual(apiRequests, [])
      await page.close()
    })
    await t.test('disabled lottery skips without lottery requests, then publishes with GET-only lottery preflight', async () => {
      apiRequests.length = 0
      const page = await browser!.newPage()
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.getByLabel('活动名称', { exact: true }).fill('无抽奖话题')
      await page.getByLabel('活动介绍', { exact: true }).fill('普通讨论')
      await page.getByLabel('活动开始（北京时间）', { exact: true }).fill('2030-10-01T09:00')
      await page.getByLabel('活动结束（北京时间）', { exact: true }).fill('2030-10-10T18:00')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByLabel('用户如何参与话题活动', { exact: true }).fill('参与讨论')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).click()
      await page.getByRole('button', { name: '确认创建草稿', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '活动草稿已创建并回读确认' }).waitFor()
      await page.getByRole('button', { name: '保存话题 V2 配置', exact: true }).click()
      await page.getByRole('button', { name: '确认保存 V2', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '话题 V2 配置已回读确认' }).waitFor()
      const beforeSkip = apiRequests.length
      await page.getByRole('button', { name: '跳过抽奖配置', exact: true }).click()
      await page.getByRole('button', { name: '确认跳过抽奖', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '已跳过配置保存' }).waitFor()
      assert.equal(apiRequests.length, beforeSkip)
      assert.ok(apiRequests.every((call) => !call.includes('/lottery')))
      await page.getByRole('button', { name: '发布话题活动', exact: true }).click()
      await page.getByRole('button', { name: '确认发布活动', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '活动已发布，GET 回读确认 PUBLISHED' }).waitFor()
      assert.equal(savedActivity?.status, 'PUBLISHED')
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001').length, 1)
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001/v2/lottery').length, 0)
      await page.close()
    })
  } finally {
    await browser?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
