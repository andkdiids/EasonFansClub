import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { createDefaultTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'

test('wizard actual React UI: five-step CREATE/EDIT, images and publish fixture transport at desktop/mobile widths', { skip: process.env.TOPIC_WIZARD_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>
  }
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TopicActivityWizard} from './components/activities/TopicActivityWizard';function Fixture(){const [open,setOpen]=useState(true);const [edited,setEdited]=useState('');const [activityId,setActivityId]=useState<string|null>(null);return <main><button onClick={()=>{setActivityId(null);setOpen(true)}}>重新打开向导</button><button onClick={()=>{setActivityId('fixture-edit');setOpen(true)}}>编辑已有活动</button><output aria-label="已打开活动编辑">{edited}</output><TopicActivityWizard key={activityId||'create'} open={open} mode={activityId?'EDIT':'CREATE'} activityId={activityId} onClose={()=>setOpen(false)} onOpenEditor={async id=>{setEdited(id);setActivityId(id)}} badgeOptions={[{id:'fixture-badge',name:'测试勋章'}]}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, nodePaths: require.resolve.paths('react') ?? [],
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const css = (await require('postcss')([require('tailwindcss')({
    content: ['./components/activities/TopicActivityWizard*.tsx', './components/ConfirmDialog.tsx'],
  })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css as string
  const apiRequests: string[] = []
  let savedActivity: Record<string, unknown> | null = null
  let postedActivity: Record<string, unknown> | null = null
  let savedProgram = createDefaultTopicActivityV2Program()
  let savedLottery = defaultTopicLotteryConfig()
  let editActivity: Record<string, unknown> = { id: 'fixture-edit', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', title: '已发布活动', description: '已存在介绍', coverUrl: null,
    startsAt: '2030-10-01T01:00:00.000Z', endsAt: '2030-10-10T10:00:00.000Z', participationRule: '提交相关内容', participationMode: 'COMMENT', allowImageAttachments: true }
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) apiRequests.push(`${req.method} ${req.url}`)
    if (req.url?.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST' && req.url === '/api/uploads/activity-image') { res.end(JSON.stringify({ url: 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/activities/cover-fixture/source.webp' })); return }
      if (req.method === 'POST' && req.url === '/api/admin/activities') {
        let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
          postedActivity = JSON.parse(body)
          savedActivity = { ...postedActivity, id: 'fixture-activity-001' }
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
      if (req.url === '/api/admin/activities/fixture-edit') {
        if (req.method === 'GET') { res.end(JSON.stringify({ activity: editActivity })); return }
        if (req.method === 'PATCH') {
          let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
            const payload = JSON.parse(body); assert.equal('status' in payload, false); editActivity = { ...editActivity, ...payload }; res.end(JSON.stringify({ activity: editActivity }))
          }); return
        }
      }
      if (req.url === '/api/admin/activities/fixture-edit/v2') {
        if (req.method === 'GET') { res.end(JSON.stringify({ activity: editActivity, canReview: true, program: savedProgram, statistics: { testParticipants: 0 } })); return }
        if (req.method === 'PATCH') { let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => { savedProgram = JSON.parse(body).program; res.end(JSON.stringify({ program: savedProgram })) }); return }
      }
      if (req.url === '/api/admin/activities/fixture-edit/v2/lottery') {
        if (req.method === 'GET') { res.end(JSON.stringify({ config: savedLottery, configLocked: false, addressEncryptionReady: true, state: 'DISABLED', candidateCount: 0, pendingSubmissionCount: 0, draw: null, winners: [], canShip: false })); return }
        if (req.method === 'PATCH') { let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => { savedLottery = JSON.parse(body).config; res.end(JSON.stringify({ config: savedLottery })) }); return }
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
  const serviceUrl = `http://127.0.0.1:${address.port}`
  let serviceProbe: Response
  try {
    serviceProbe = await fetch(serviceUrl)
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const cause = error instanceof Error && 'cause' in error ? String(error.cause) : String(error)
    t.skip(`BROWSER QA: BLOCKED BY ENVIRONMENT; local HTTP probe failed (${cause})`)
    return
  }
  assert.equal(serviceProbe.status, 200, 'local fixture server must answer HTTP before browser startup')
  assert.match(await serviceProbe.text(), /id="root"/, 'local fixture server must serve the wizard test page')
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const configuredBrowser = process.env.TOPIC_WIZARD_CHROMIUM_PATH
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    const executablePath = configuredBrowser && existsSync(configuredBrowser) ? configuredBrowser : existsSync(edge) ? edge : undefined
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    for (const width of [1280, 390, 360]) await t.test(`actual wizard interaction ${width}px`, async () => {
      apiRequests.length = 0
      const page = await browser!.newPage({ viewport: { width, height: 900 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(serviceUrl)
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.ok(await page.getByRole('alert').innerText().then((text) => text.includes('活动名称')))
      await page.getByLabel('活动名称', { exact: true }).fill('天使的礼物')
      await page.getByLabel('活动介绍', { exact: true }).fill('发布相关内容参与本活动。')
      await page.getByLabel('活动开始（北京时间）', { exact: true }).fill('2030-10-01T09:00')
      await page.getByLabel('活动结束（北京时间）', { exact: true }).fill('2030-10-10T18:00')
      await page.getByLabel('活动封面', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64') })
      await page.getByAltText('活动封面本地预览').waitFor()
      assert.equal(await page.getByRole('button', { name: '取消选择', exact: true }).count(), 1)
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
      assert.equal(await page.getByLabel('启用测试题').isChecked(), false)
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
      assert.ok((await page.getByRole('region', { name: '话题活动创建向导' }).innerText()).includes('封面：cover.png'))
      assert.equal(await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).isDisabled(), false)
      await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: '确认创建草稿', exact: true }).count(), 1)
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.deepEqual(apiRequests, [])
      await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).click()
      await page.getByRole('button', { name: '确认创建草稿', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '活动草稿已创建并回读确认' }).waitFor()
      assert.deepEqual(apiRequests, ['POST /api/uploads/activity-image', 'POST /api/admin/activities', 'GET /api/admin/activities/fixture-activity-001'])
      assert.equal(savedActivity?.status, 'DRAFT')
      assert.equal(postedActivity?.coverUrl, 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/activities/cover-fixture/source.webp')
      assert.doesNotMatch(JSON.stringify(postedActivity), /cover\.png|blob:|data:image|selectionId|fileInfo/)
      assert.equal('program' in savedActivity!, false); assert.equal('lottery' in savedActivity!, false)
      assert.equal(await page.getByRole('button', { name: '恢复本地快照' }).isDisabled(), true)
      await page.getByRole('button', { name: '重新回读草稿', exact: true }).click()
      await page.getByRole('button', { name: '确认回读', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="活动保存会话"]')?.textContent?.includes('请求状态：可操作'))
      assert.deepEqual(apiRequests, ['POST /api/uploads/activity-image', 'POST /api/admin/activities', 'GET /api/admin/activities/fixture-activity-001', 'GET /api/admin/activities/fixture-activity-001'])
      await page.getByRole('button', { name: '上一步', exact: true }).click()
      await page.getByLabel('微博挂号费奖励', { exact: true }).fill('21')
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      const beforeProgramCancel = apiRequests.length
      await page.getByRole('button', { name: '保存话题 V2 配置', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(apiRequests.length, beforeProgramCancel)
      await page.getByRole('button', { name: '保存话题 V2 配置', exact: true }).click()
      await page.getByRole('button', { name: '确认保存 V2', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '话题 V2 配置已回读确认' }).waitFor()
      assert.equal(savedProgram.entries[0].points, 21)
      assert.equal(apiRequests.filter((call: string) => call.startsWith('PATCH')).length, 1)
      assert.equal(apiRequests.filter((call: string) => call === 'POST /api/admin/activities').length, 1)
      assert.ok(apiRequests.slice(3).every((call) => !/lottery|publish|draw/.test(call)))
      await page.getByRole('button', { name: '核对 V2 回读', exact: true }).click()
      await page.getByRole('button', { name: '确认核对 V2', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="活动保存会话"]')?.textContent?.includes('请求状态：可操作'))
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
      assert.ok(apiRequests.every((call) => !/\/draw|\/winners|\/shipment|\/address|\/reward|publish/.test(call)))
      await page.getByRole('button', { name: '核对抽奖回读', exact: true }).click()
      await page.getByRole('button', { name: '确认核对抽奖', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="活动保存会话"]')?.textContent?.includes('请求状态：可操作'))
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001/v2/lottery').length, 1)
      assert.equal(savedActivity?.status, 'DRAFT')
      assert.equal(apiRequests.filter((call: string) => call === 'POST /api/admin/activities').length, 1)
      assert.equal(await page.getByRole('button', { name: '核对 V2 回读', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: '收起向导', exact: true }).click()
      await page.getByRole('button', { name: '收起并保留本地输入', exact: true }).click()
      await page.getByRole('button', { name: '重新打开向导', exact: true }).click()
      for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '上一步', exact: true }).click()
      assert.equal(await page.getByLabel('活动名称', { exact: true }).inputValue(), '天使的礼物')
      assert.equal(await page.getByLabel('活动名称', { exact: true }).isDisabled(), true)
      assert.equal(await page.getByAltText('活动封面本地预览').count(), 1)
      for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '下一步', exact: true }).click()
      const beforePublish = apiRequests.length
      await page.getByRole('button', { name: '发布话题活动', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.deepEqual(apiRequests.slice(beforePublish), [])
      await page.getByRole('button', { name: '发布话题活动', exact: true }).click()
      await page.getByRole('button', { name: '确认发布活动', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await page.getByRole('status').filter({ hasText: '活动已发布，GET 回读确认 PUBLISHED' }).waitFor()
      assert.equal(savedActivity?.status, 'PUBLISHED')
      assert.equal(apiRequests.filter((call: string) => call === 'PATCH /api/admin/activities/fixture-activity-001').length, 1)
      assert.equal(apiRequests.at(-1), 'GET /api/admin/activities/fixture-activity-001')
      assert.equal(await page.getByRole('button', { name: '核验发布状态', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '核对抽奖回读', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: '进入简易编辑', exact: true }).click()
      assert.equal(await page.getByLabel('已打开活动编辑').innerText(), 'fixture-activity-001')
      assert.ok(apiRequests.every((call) => !/\/draw|\/winners|\/shipment|\/address|\/reward/.test(call)))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('existing TOPIC_ACTIVITY opens the simple EDIT wizard and PATCHes only changed fields', async () => {
      apiRequests.length = 0
      const page = await browser!.newPage({ viewport: { width: 390, height: 900 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.getByRole('button', { name: '编辑已有活动' }).click()
      await page.getByRole('region', { name: '话题活动编辑向导' }).waitFor()
      await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((input) => input.value === '已发布活动'))
      assert.equal(await page.getByLabel('活动名称', { exact: true }).inputValue(), '已发布活动')
      assert.equal(await page.getByRole('button', { name: '创建话题活动草稿', exact: true }).count(), 0)
      await page.getByLabel('活动名称', { exact: true }).fill('已发布活动（简易编辑）')
      await page.getByRole('button', { name: '保存修改', exact: true }).click()
      await page.getByRole('button', { name: '确认保存修改', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '修改已保存并回读确认' }).waitFor()
      assert.equal(editActivity.title, '已发布活动（简易编辑）')
      assert.equal(editActivity.status, 'PUBLISHED')
      assert.deepEqual(apiRequests.filter((call) => call.startsWith('PATCH')), ['PATCH /api/admin/activities/fixture-edit'])
      assert.equal(apiRequests.some((call) => call.startsWith('POST ')), false)
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
      await page.getByText('快照中的本地封面需重新选择；此项可留空。', { exact: true }).waitFor()
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

test('ActivityAdminManager makes the background list keyboard-inert while the wizard is open', { skip: process.env.TOPIC_WIZARD_KEYBOARD_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>
  }
  const activity = {
    id: 'keyboard-fixture', title: '键盘测试活动', subtitle: null, description: '仅供本地键盘测试', type: 'TOPIC_ACTIVITY', status: 'DRAFT', displayStatus: 'UPCOMING',
    coverUrl: null, bannerUrl: null, locationName: null, locationAddress: null, onlineUrl: null, pointsReward: null, registrationFee: 0, feeDescription: null,
    linkedMaterial: null, signupLimit: null, signupCount: 0, startsAt: '2030-10-01T01:00:00.000Z', endsAt: '2030-10-10T10:00:00.000Z',
    registrationStartAt: null, registrationEndAt: null, verificationMode: 'NONE', organizer: null, contactInfo: null, isFeatured: false, isPinned: false,
    pinToPlaza: false, activityPostId: null, participationRule: '提交相关内容', participationMode: 'COMMENT', allowImageAttachments: true,
    rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null, rewardPoints: null, rewardBadgeCount: 0, rewardBadgeIds: [], sortOrder: 0, viewCount: 0,
    publishedAt: null, createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
  }
  const program = createDefaultTopicActivityV2Program()
  const lottery = defaultTopicLotteryConfig()
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ActivityAdminManager}from'./app/admin/activities/ActivityAdminManager';const activity=${JSON.stringify(activity)};createRoot(document.getElementById('root')!).render(<ActivityAdminManager initialActivities={[activity as any]}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, nodePaths: require.resolve.paths('react') ?? [],
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{
      name: 'topic-wizard-next-link-fixture',
      setup(build: {
        onResolve: (options: { filter: RegExp }, callback: () => { path: string; namespace: string }) => void
        onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: 'tsx'; resolveDir: string }) => void
      }) {
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link-fixture', namespace: 'topic-wizard-fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'topic-wizard-fixture' }, () => ({
          contents: `import React from 'react';export default function Link(props){const{href,children,...rest}=props;return React.createElement('a',{...rest,href},children)}`,
          loader: 'tsx', resolveDir: process.cwd(),
        }))
      },
    }],
  })
  const configuredBrowser = process.env.TOPIC_WIZARD_CHROMIUM_PATH
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const executablePath = configuredBrowser && existsSync(configuredBrowser) ? configuredBrowser : existsSync(edge) ? edge : undefined
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    for (const width of [1280, 390]) await t.test(`keyboard isolation and focus return at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
      await page.evaluate(`(() => {
        const fixture = ${JSON.stringify({ activity, program, lottery })}
        const calls = []
        Object.defineProperty(window, '__topicWizardFetchCalls', { value: calls })
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.href
          calls.push((init?.method || 'GET') + ' ' + url)
          const path = url.split('?')[0]
          let data = {}
          if (path === '/api/admin/activities/badges') data = { badges: [] }
          else if (path.startsWith('/api/admin/activities/materials')) data = { materials: [] }
          else if (path === '/api/admin/activities/keyboard-fixture') data = { activity: fixture.activity }
          else if (path === '/api/admin/activities/keyboard-fixture/v2') data = { activity: fixture.activity, program: fixture.program, statistics: { testParticipants: 0 } }
          else if (path === '/api/admin/activities/keyboard-fixture/v2/lottery') data = { config: fixture.lottery, configLocked: false, addressEncryptionReady: true, draw: null, winners: [] }
          return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
      })()`)
      const fixtureUuid = await page.evaluate<string>(`(() => {
        Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: function fixtureRandomUUID() {
          const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
          bytes[6] = (bytes[6] & 0x0f) | 0x40
          bytes[8] = (bytes[8] & 0x3f) | 0x80
          const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
          return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
        } })
        return globalThis.crypto.randomUUID()
      })()`)
      assert.match(fixtureUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      const pageErrors: string[] = []
      page.on('pageerror', (error: Error) => pageErrors.push(error.message))
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      const list = page.locator('#activity-list')
      const edit = list.getByRole('button', { name: '编辑', exact: true })
      await page.waitForTimeout(100)
      assert.equal(await list.count(), 1, `manager fixture did not render its list; root=${await page.locator('#root').innerHTML()}; pageErrors=${pageErrors.join('; ')}`)
      assert.equal(await edit.count(), 1, `manager fixture did not render its edit action; list=${await list.innerText()}; pageErrors=${pageErrors.join('; ')}`)

      await edit.focus()
      assert.equal(await edit.evaluate((node: HTMLButtonElement) => document.activeElement === node), true, 'the closed wizard leaves list controls focusable')
      await page.keyboard.press('Enter')
      const wizard = page.getByRole('region', { name: '话题活动编辑向导' })
      await wizard.waitFor()
      const wizardHeading = page.locator('#topic-activity-wizard h2').first()
      await page.waitForFunction(() => document.activeElement?.tagName === 'H2')
      await page.getByLabel('活动名称', { exact: true }).waitFor()
      assert.equal(await wizardHeading.evaluate((node: HTMLHeadingElement) => document.activeElement === node), true, 'opening moves focus into the wizard')
      assert.equal(await list.evaluate((node: HTMLElement & { inert: boolean }) => node.inert), true)
      assert.equal(await list.getAttribute('aria-disabled'), null, 'native inert, not aria-disabled, controls the background')

      const beforeKeyboardAttempts = await page.evaluate(() => (window as unknown as { __topicWizardFetchCalls: string[] }).__topicWizardFetchCalls.length)
      await list.getByRole('button', { name: '发布', exact: true }).click({ force: true })
      assert.equal(await page.evaluate(() => (window as unknown as { __topicWizardFetchCalls: string[] }).__topicWizardFetchCalls.length), beforeKeyboardAttempts, 'background pointer clicks must not start a publish request')
      for (let index = 0; index < 40; index++) {
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#activity-list'))), false, 'Tab must skip every background list control')
      }
      for (const label of ['编辑', '高级设置', '发布', '取消活动']) {
        const target = list.getByRole('button', { name: label, exact: true })
        await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
        await target.evaluate((node: HTMLButtonElement) => node.focus())
        assert.equal(await target.evaluate((node: HTMLButtonElement) => document.activeElement === node), false, `${label} cannot receive focus while inert`)
        await page.keyboard.press('Enter')
        await page.keyboard.press('Space')
      }
      assert.equal(await page.evaluate(() => (window as unknown as { __topicWizardFetchCalls: string[] }).__topicWizardFetchCalls.length), beforeKeyboardAttempts, 'background Enter/Space must not start any API action')

      await wizard.getByRole('button', { name: '返回活动管理', exact: true }).first().click()
      await page.waitForFunction(() => !document.querySelector('#activity-list')?.hasAttribute('inert'))
      assert.equal(await edit.evaluate((node: HTMLButtonElement) => document.activeElement === node), true, 'closing restores focus to the opening list control')
      await page.keyboard.press('Enter')
      await wizard.waitFor()
      await wizard.getByRole('button', { name: '返回活动管理', exact: true }).first().click()
      await page.close()
    })
  } finally {
    await browser.close()
  }
})
