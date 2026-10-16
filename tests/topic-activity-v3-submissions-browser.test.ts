import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'

test('V3 actual submission card: protected images, required rejection, resubmission, approval and authoritative grant receipt', { skip: process.env.TOPIC_V3_SUBMISSIONS_BROWSER_QA !== '1' }, async () => {
  const dependencyRoot = process.env.TOPIC_V3_TEST_DEPENDENCY_ROOT || process.cwd()
  const require = createRequire(join(dependencyRoot, 'package.json'))
  const { chromium } = require('playwright') as typeof import('playwright')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }> }
  const reactDomClient = require.resolve('react-dom/client')
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{TopicActivityPlatformSubmissionCard}from'./components/activities/TopicActivityPlatformSubmissionCard';
      function Fixture(){const role=new URLSearchParams(location.search).get('role')||'owner';const[row,setRow]=useState(null);const[resubmit,setResubmit]=useState(false);const[file,setFile]=useState(null);
      async function load(){setRow(await(await fetch('/fixture/submission')).json())}useEffect(()=>{load();const changed=()=>load();const open=()=>setResubmit(true);window.addEventListener('topic-activity-v2-changed',changed);window.addEventListener('topic-activity-v2-open-task',open);return()=>{window.removeEventListener('topic-activity-v2-changed',changed);window.removeEventListener('topic-activity-v2-open-task',open)}},[]);
      return row?<><TopicActivityPlatformSubmissionCard activityId="activity-one" commentId="comment-one" submission={{...row,canViewPrivate:role!=='other'}} author={{id:'user-one',uid:100,nickname:'用户A'}} currentUserId={role==='owner'?'user-one':'other-user'} canReview={role==='admin'} createdAt="2026-10-16T02:00:00Z"/>{resubmit?<form onSubmit={async(e)=>{e.preventDefault();await fetch('/fixture/tasks',{method:'POST',body:file.name});setResubmit(false);await load()}}><label>新截图<input type="file" onChange={e=>setFile(e.target.files[0])}/></label><button disabled={!file}>提交新截图</button></form>:null}</>:null}createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', absWorkingDir: process.cwd(), nodePaths: [join(dependencyRoot, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '""' },
    alias: { '@': process.cwd(), react: require.resolve('react'), 'react/jsx-runtime': require.resolve('react/jsx-runtime'), 'react-dom/client': reactDomClient, 'react-dom': require.resolve('react-dom'), scheduler: createRequire(reactDomClient).resolve('scheduler') },
  })
  let status = 'PENDING', granted = false, reviewWrites = 0, rewardWrites = 0, historyReads = 0, retryFail = true
  let reason: string | null = null
  const history: Array<Record<string, unknown>> = []
  const screenshot = '/api/activities/activity-one/assets/asset-one/preview'
  const server = createServer(async (req, res) => {
    const path = new URL(req.url || '/', 'http://127.0.0.1').pathname
    const send = (data: unknown, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
    if (path === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    if (path === screenshot) { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhL8AAAAASUVORK5CYII=', 'base64')); return }
    if (path === '/fixture/submission') return send({ id: 'submission-one', rewardEntryId: 'xiaohongshu', status, rejectReason: reason, granted, rewardSnapshotSafe: { platformName: '小红书', title: '隐藏的任务标题', instructions: '隐藏的任务说明', points: 7 }, taskAssets: [{ assetId: 'asset-one', previewAccessUrl: screenshot }] })
    if (path === '/api/activities/activity-one/v2') return send({ entries: [{ id: 'xiaohongshu', platformKey: 'XIAOHONGSHU', platformName: '小红书', enabled: true, allowResubmit: true, maxImages: 3 }], program: { enabled: true, platformRewards: { enabled: true } }, myProgress: { submissions: [{ id: 'submission-one', rewardEntryId: 'xiaohongshu', status }], grants: granted ? [{ rewardEntryId: 'xiaohongshu', status: 'GRANTED' }] : [] }, activity: { status: 'PUBLISHED', allowImageAttachments: true } })
    if (path === '/fixture/tasks') { assert.equal(status, 'REJECTED'); status = 'PENDING'; reason = null; history.push({ id: 'resubmit', fromStatus: 'REJECTED', toStatus: 'PENDING', reviewedAt: new Date().toISOString() }); return send({}) }
    if (path.endsWith('/v2/submissions/submission-one')) {
      if (req.method !== 'PATCH') { historyReads++; return send({ history }) }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      reviewWrites++
      if (retryFail) { retryFail = false; return send({ message: '本地审核失败，保留原因' }, 500) }
      if (body.status === 'REJECTED') assert.ok(body.rejectReason.trim().length >= 2)
      history.push({ id: String(history.length), fromStatus: status, toStatus: body.status, reason: body.rejectReason || null, reviewedAt: new Date().toISOString(), ReviewedBy: { nickname: '管理员' } })
      status = body.status; reason = body.rejectReason || null
      if (status === 'APPROVED' && !granted) { granted = true; rewardWrites++ }
      await new Promise((resolve) => setTimeout(resolve, 50)); return send({ changed: true })
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(existsSync(edge) ? { executablePath: edge } : {}) })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    await page.goto(origin + '/?role=owner'); await page.getByText('待审核', { exact: true }).waitFor()
    assert.equal(await page.getByRole('img', { name: '小红书提交截图 1' }).count(), 1)
    for (const text of ['点赞', '回复', '置顶', '删除', '隐藏的任务标题', '隐藏的任务说明', '7 挂号费']) assert.equal(await page.getByText(text, { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '通过', exact: true }).count(), 0)
    await page.goto(origin + '/?role=other'); await page.getByText('截图仅提交者和审核人员可见').waitFor()
    assert.equal(await page.getByRole('img', { name: '小红书提交截图 1' }).count(), 0)
    await page.goto(origin + '/?role=admin'); await page.getByRole('button', { name: '拒绝', exact: true }).click()
    await page.getByRole('button', { name: '确认拒绝' }).click(); await page.getByText('请填写 2–200 字拒绝原因', { exact: true }).waitFor(); assert.equal(reviewWrites, 0)
    await page.getByRole('textbox').fill('   '); await page.getByRole('button', { name: '确认拒绝' }).click(); assert.equal(reviewWrites, 0)
    await page.getByRole('textbox').fill('截图未达到要求'); await page.getByRole('button', { name: '确认拒绝' }).click()
    await page.getByText('本地审核失败，保留原因').waitFor(); assert.equal(await page.getByRole('textbox').inputValue(), '截图未达到要求')
    await page.getByRole('button', { name: '确认拒绝' }).click(); await page.getByText('未通过', { exact: true }).waitFor()
    assert.equal(rewardWrites, 0)
    await page.goto(origin + '/?role=owner'); await page.getByText('拒绝原因：截图未达到要求').waitFor()
    await page.getByRole('button', { name: '重新提交' }).click(); await page.getByLabel('新截图').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: Buffer.from('new local fixture image') })
    await page.getByRole('button', { name: '提交新截图' }).click(); await page.getByText('待审核', { exact: true }).waitFor()
    await page.goto(origin + '/?role=admin'); await page.getByRole('button', { name: '通过', exact: true }).click()
    await page.getByRole('button', { name: '确认通过' }).evaluate((element) => { const button = element as HTMLButtonElement; button.click(); button.click() })
    await page.getByText('✓ 已通过', { exact: true }).waitFor(); await page.getByText('奖励已发放', { exact: true }).waitFor()
    assert.equal(reviewWrites, 3); assert.equal(rewardWrites, 1)
    assert.equal(await page.getByRole('button', { name: '通过', exact: true }).count(), 0)
    await page.getByRole('button', { name: '审核记录' }).click(); await page.getByText(/PENDING → REJECTED/).waitFor(); assert.equal(historyReads, 1)
    await page.getByRole('button', { name: '审核记录' }).click(); assert.equal(await page.getByText(/PENDING → REJECTED/).count(), 0)
    await page.goto(origin + '/?role=owner'); await page.getByText('奖励已发放', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '重新提交' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '审核记录' }).count(), 0)
    assert.equal(rewardWrites, 1)
    await context.close()
  } finally { await browser?.close(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
