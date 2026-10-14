import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'

async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)) }
  assert.fail(label)
}

// Real React components + browser; local fixtures only. MicroMessenger UA is
// a branch test, NOT evidence of physical WeChat/iOS/Android save behavior.
test('V6.1 browser: original preview/download and non-resetting admin reply queue', { skip: process.env.TOPIC_V61_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const originalPath = '/api/activities/fixture/form-submissions/form-1/replies/reply-1/assets/asset-1/original'
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityOriginalImage} from './components/activities/TopicActivityOriginalImage'; import {TopicActivityFormSubmissionManager} from './app/admin/activities/TopicActivityFormSubmissionManager'; createRoot(document.getElementById('root')).render(location.pathname==='/admin'?<TopicActivityFormSubmissionManager activityId="fixture" onClose={()=>{}}/>:<TopicActivityOriginalImage originalUrl="${originalPath}"/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"' },
  })
  const originalBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64')
  type Reply = { id: string; content: string; createdAt: string; images: never[] }
  type Row = { id: string; status: 'SUBMITTED' | 'REPLIED'; submittedAt: string; replies: Reply[]; answersSnapshot: never[]; user: { id: string; nickname: string; avatarUrl: null } }
  let rows: Row[] = []
  let failReply = false, failNext = false, failOriginal = false, failPage = false
  const listQueries: URLSearchParams[] = []
  const replyBodies: Array<{ requestId: string; content: string }> = []
  const originalQueries: string[] = []
  const reset = () => {
    rows = Array.from({ length: 23 }, (_, index) => ({ id: 'form-' + String(23 - index).padStart(2, '0'), status: 'SUBMITTED', submittedAt: new Date(Date.UTC(2026, 9, 8, 0, 0, 23 - index)).toISOString(), replies: [], answersSnapshot: [], user: { id: 'user-' + index, nickname: '用户 ' + (23 - index), avatarUrl: null } }))
    listQueries.length = 0; replyBodies.length = 0; failReply = false; failNext = false; failPage = false
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(result.outputFiles[0].text); return }
    if (url.pathname === originalPath) {
      originalQueries.push(url.search)
      if (failOriginal) { res.statusCode = 401; json({ message: '请登录后查看原图' }); return }
      res.setHeader('Content-Type', 'image/png'); res.setHeader('Content-Disposition', "inline; filename*=UTF-8''original.png"); res.setHeader('Cache-Control', 'private, no-store'); res.end(originalBytes); return
    }
    if (url.pathname === '/api/admin/activities/fixture/form-submissions') {
      listQueries.push(new URLSearchParams(url.searchParams))
      const size = Number(url.searchParams.get('pageSize')) || 20
      if (size === 1 && failNext) { res.statusCode = 500; json({ message: '下一份 fixture 失败' }); return }
      const status = url.searchParams.get('replyStatus')
      const oldest = url.searchParams.get('sort') !== 'NEWEST'
      const filtered = rows.filter((row) => status === 'UNREPLIED' ? !row.replies.length : status === 'REPLIED' ? !!row.replies.length : true).sort((a, b) => (oldest ? 1 : -1) * a.id.localeCompare(b.id))
      const cursor = url.searchParams.get('cursor')
      if (cursor && failPage) { res.statusCode = 503; json({ message: '分页 fixture 网络中断' }); return }
      if (cursor) await new Promise((resolve) => setTimeout(resolve, 100))
      const afterCursor = cursor ? filtered.filter((row) => oldest ? row.id > cursor : row.id < cursor) : filtered
      const resultRows = afterCursor.slice(0, size)
      json({ submissions: resultRows, total: filtered.length, nextCursor: resultRows.at(-1)?.id || null, page: Number(url.searchParams.get('page')) || 1, hasMore: afterCursor.length > size, counts: { formSubmissions: rows.length, repliedForms: rows.filter((row) => row.replies.length).length, unrepliedForms: rows.filter((row) => !row.replies.length).length, commentSubmissions: 0, approvedUsers: 0 } }); return
    }
    if (req.method === 'POST' && url.pathname.endsWith('/replies')) {
      let text = ''; for await (const chunk of req) text += chunk
      const body = JSON.parse(text); replyBodies.push(body)
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (failReply) { res.statusCode = 500; json({ message: '发送 fixture 失败' }); return }
      const row = rows.find((row) => url.pathname.includes('/' + row.id + '/'))!
      const reply = { id: 'reply-' + body.requestId, content: body.content, createdAt: new Date().toISOString(), images: [] as never[] }
      if (!row.replies.some((item) => item.id === reply.id)) row.replies.push(reply)
      row.status = 'REPLIED'; json({ reply }); return
    }
    if (url.pathname.startsWith('/api/')) { res.statusCode = 404; json({ message: 'undefined fixture' }); return }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>article{min-height:95px}button{min-height:40px}textarea{display:block}body{margin:12px}</style><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  let browser: Browser | null = null
  try {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    await t.test('MicroMessenger UA exposes authorized preview, guidance and retry; no public URL', async () => {
      const context = await browser!.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 Android MicroMessenger/8.0' })
      const page = await context.newPage()
      await page.goto(origin)
      failOriginal = true
      await page.getByRole('link', { name: '下载原图', exact: true }).click()
      await until(() => page.getByRole('alert').isVisible(), 'download auth error is visible')
      assert.match(await page.getByRole('alert').innerText(), /请登录/)
      failOriginal = false
      await page.getByRole('link', { name: '重试下载原图' }).click()
      const img = page.getByRole('img', { name: '授权原图，可尝试长按保存' })
      await until(() => img.isVisible(), 'inline original visible')
      assert.match(await img.getAttribute('src') || '', /^blob:/)
      assert.equal(await page.getByRole('link', { name: '打开授权原图', exact: true }).getAttribute('href'), originalPath + '?view=1')
      assert.match(await page.getByRole('dialog').innerText(), /长按.*系统浏览器/)
      assert.ok(originalQueries.every((query) => query === '?view=1'))
      assert.equal(originalQueries.length, 2, 'failure + successful fetch; image preview does not request original twice')
      await context.close()
    })
    await t.test('normal browser emits actual file download with byte-identical payload and fallback', async () => {
      const page = await browser!.newPage()
      await page.goto(origin)
      const event = page.waitForEvent('download')
      await page.getByRole('link', { name: '下载原图', exact: true }).click()
      const download = await event
      assert.equal(download.suggestedFilename(), 'original.png')
      const path = await download.path()
      assert.ok(path)
      const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
      assert.equal(hash(readFileSync(path)), hash(originalBytes))
      await page.getByRole('button', { name: '查看原图', exact: true }).click()
      await until(() => page.getByRole('dialog').isVisible(), 'fallback available')
      await page.close()
    })
    await t.test('reply failure keeps draft; success locally updates and opens next; pages and cursor persist', async () => {
      reset()
      const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
      let documents = 0
      page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents += 1 })
      await page.goto(origin + '/admin')
      await until(async () => await page.locator('article').count() === 20, 'first 20')
      await page.getByRole('combobox', { name: '提交排序' }).selectOption('NEWEST')
      await until(async () => listQueries.at(-1)?.get('sort') === 'NEWEST' && await page.locator('article').count() === 20, 'newest loaded')
      await page.getByRole('button', { name: /^加载全部剩余/ }).click()
      await until(async () => await page.locator('article').count() === 23, 'load more appends')
      assert.equal(listQueries.at(-1)?.get('cursor'), 'form-04')
      const listPageReads = listQueries.filter((query) => query.get('pageSize') === '20').length
      await page.locator('#admin-form-form-02').getByRole('button', { name: '查看详情 / 回复' }).click()
      await page.locator('textarea').fill('保留输入内容')
      failReply = true
      const send = page.getByRole('button', { name: '发送回复', exact: true })
      await send.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await until(() => page.getByRole('alert').isVisible(), 'failed reply visible')
      assert.equal(replyBodies.length, 1)
      assert.equal(await page.locator('textarea').inputValue(), '保留输入内容')
      assert.equal(await page.locator('article').count(), 23)
      failReply = false
      await send.click()
      await until(async () => await page.locator('#admin-form-form-23 textarea').count() === 1, 'next pending opened')
      assert.equal(replyBodies[0].requestId, replyBodies[1].requestId, 'uncertain retry retains idempotency key')
      assert.equal(rows.find((row) => row.id === 'form-02')?.replies.length, 1)
      assert.equal(await page.locator('article').count(), 23)
      assert.equal(listQueries.filter((query) => query.get('pageSize') === '20').length, listPageReads)
      assert.equal(documents, 1, 'no page reload')
      assert.match(await page.locator('#admin-form-form-02').innerText(), /已回复/)
      // Only the last pending item remains in the fixture. Next lookup fails
      // after successful reply, then retrying the lookup must NOT resend.
      rows.forEach((row) => { if (row.id !== 'form-23' && !row.replies.length) row.replies.push({ id: 'external-' + row.id, content: '另一管理员已处理', createdAt: new Date().toISOString(), images: [] }) })
      failNext = true
      await page.locator('textarea').fill('最后一份')
      await send.click()
      await until(() => page.getByRole('button', { name: '重试定位下一份（不会重发回复）' }).isVisible(), 'next retry exposed')
      const sent = replyBodies.length
      failNext = false
      await page.getByRole('button', { name: '重试定位下一份（不会重发回复）' }).click()
      await until(() => page.getByText('当前待回复表单已处理完成', { exact: true }).isVisible(), 'queue completed')
      assert.equal(replyBodies.length, sent)
      assert.equal(await page.locator('article').count(), 23)
      await page.close()
    })
    await t.test('UNREPLIED filter keeps loaded cursor despite local removal and never repeats replied rows', async () => {
      reset()
      const page = await browser!.newPage()
      await page.goto(origin + '/admin')
      await until(async () => await page.locator('article').count() === 20, 'loaded')
      await page.getByRole('combobox', { name: '提交排序' }).selectOption('NEWEST')
      await page.getByRole('button', { name: '未回复', exact: true }).click()
      await until(async () => listQueries.at(-1)?.get('replyStatus') === 'UNREPLIED' && await page.locator('article').count() === 20, 'filter loaded')
      await page.locator('#admin-form-form-23').getByRole('button', { name: '查看详情 / 回复' }).click()
      await page.locator('textarea').fill('处理第一份')
      await page.getByRole('button', { name: '发送回复', exact: true }).click()
      await until(async () => await page.locator('#admin-form-form-22 textarea').count() === 1, 'next unreplied opened')
      assert.equal(await page.locator('#admin-form-form-23').count(), 0)
      await page.evaluate(() => window.scrollTo(0, 100))
      const scrollBefore = await page.evaluate(() => window.scrollY)
      await page.getByRole('button', { name: /^加载全部剩余/ }).evaluate((button: HTMLButtonElement) => button.click())
      await until(async () => await page.locator('article').count() === 22, 'all remaining rows appended without skip')
      assert.equal(listQueries.at(-1)?.get('cursor'), 'form-04')
      assert.equal(listQueries.at(-1)?.get('replyStatus'), 'UNREPLIED')
      assert.equal(await page.locator('#admin-form-form-22 textarea').count(), 1, 'expanded detail retained on append')
      const ids = await page.locator('article').evaluateAll((nodes) => nodes.map((node) => node.id))
      assert.equal(new Set(ids).size, 22)
      assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore) <= 2, 'append preserves scroll position')
      await page.close()
    })
    await t.test('REPLIED filter retains its page while auto-next is visible as a separate pending editor', async () => {
      reset()
      rows[0].status = 'REPLIED'
      rows[0].replies.push({ id: 'previous-reply', content: '上一条回复', createdAt: new Date().toISOString(), images: [] })
      const page = await browser!.newPage()
      await page.goto(origin + '/admin')
      await until(async () => await page.locator('article').count() === 20, 'initial loaded')
      await page.getByRole('combobox', { name: '提交排序' }).selectOption('NEWEST')
      await page.getByRole('button', { name: '已回复', exact: true }).click()
      await until(async () => await page.locator('article').count() === 1, 'replied filter loaded')
      await page.locator('#admin-form-form-23').getByRole('button', { name: '查看详情 / 回复' }).click()
      await page.locator('textarea').fill('追加说明')
      await page.getByRole('button', { name: '发送回复', exact: true }).click()
      await until(async () => await page.locator('#admin-form-form-22 textarea').count() === 1, 'next pending visible despite filter')
      assert.match(await page.locator('#admin-form-form-22').innerText(), /下一份待回复.*列表仍按已回复筛选/)
      assert.equal(listQueries.filter((query) => query.get('pageSize') === '20').at(-1)?.get('replyStatus'), 'REPLIED')
      assert.equal(await page.locator('#admin-form-form-23').count(), 1, 'filtered page retained')
      await page.close()
    })
    await t.test('V612 oldest default, one-click bounded pages, progress, partial failure and resume; sort/filter reset', async () => {
      reset()
      rows = Array.from({ length: 65 }, (_, index) => ({ ...rows[0], id: 'form-' + String(index + 1).padStart(3, '0'), replies: [], status: 'SUBMITTED' as const }))
      const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(origin + '/admin')
      await until(async () => await page.locator('article').count() === 20, 'first bounded page')
      assert.equal(await page.locator('article').first().getAttribute('id'), 'admin-form-form-001')
      assert.equal(listQueries.at(-1)?.get('sort'), 'OLDEST')
      assert.ok(await page.getByRole('button', { name: '加载全部剩余（45）', exact: true }).isVisible())
      failPage = true
      await page.getByRole('button', { name: /^加载全部剩余/ }).click()
      await until(() => page.getByRole('alert').isVisible(), 'page failure visible')
      assert.equal(await page.locator('article').count(), 20)
      assert.equal(replyBodies.length, 0)
      failPage = false
      await page.getByRole('button', { name: /^加载全部剩余/ }).click()
      await until(() => page.getByText(/正在加载 \d+ \/ 65/).isVisible(), 'progress visible')
      await until(async () => await page.locator('article').count() === 65, 'single click drains remaining bounded pages')
      const ids = await page.locator('article').evaluateAll((elements) => elements.map((element) => element.id))
      assert.equal(new Set(ids).size, 65)
      assert.equal(listQueries.filter((query) => query.has('cursor')).at(0)?.get('cursor'), 'form-020')
      assert.ok(listQueries.every((query) => Number(query.get('pageSize')) <= 20))
      assert.equal(replyBodies.length, 0, 'reads have no reply/reward side effects')
      await page.getByRole('button', { name: '未回复', exact: true }).click()
      await until(async () => await page.locator('article').count() === 20, 'filter resets pages')
      await page.getByRole('combobox', { name: '提交排序' }).selectOption('NEWEST')
      await until(async () => await page.locator('article').first().getAttribute('id') === 'admin-form-form-065', 'sort newest resets cursor')
      assert.equal(listQueries.at(-1)?.get('replyStatus'), 'UNREPLIED')
      assert.equal(listQueries.at(-1)?.has('cursor'), false)
      await page.close()
    })
    await t.test('V612 large queue yields bounded requests and stops at explicit 1000-row safety cap', async () => {
      reset()
      rows = Array.from({ length: 1020 }, (_, index) => ({ ...rows[0], id: 'form-' + String(index + 1).padStart(4, '0'), replies: [], status: 'SUBMITTED' as const }))
      const page = await browser!.newPage()
      await page.goto(origin + '/admin')
      await until(async () => await page.locator('article').count() === 20, 'bounded first page')
      await page.getByRole('button', { name: /^加载全部剩余/ }).click()
      await until(() => page.getByText('为保持页面流畅，最多加载 1000 份；请用回复状态筛选缩小范围', { exact: true }).isVisible(), 'safety cap message')
      assert.equal(await page.locator('article').count(), 1000)
      assert.ok(await page.getByRole('button', { name: '加载全部剩余（20）', exact: true }).isDisabled())
      assert.equal(listQueries.length, 50)
      assert.equal(replyBodies.length, 0)
      const ids = await page.locator('article').evaluateAll((elements) => elements.map((element) => element.id))
      assert.equal(new Set(ids).size, 1000)
      assert.equal(await page.locator('article').first().evaluate((element) => element.style.contentVisibility), 'auto')
      await page.getByRole('combobox', { name: '提交排序' }).selectOption('NEWEST')
      await until(async () => await page.locator('article').count() === 20 && await page.locator('article').first().getAttribute('id') === 'admin-form-form-1020', 'cap allows new ordered/filter scope')
      await page.close()
    })
  } finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
