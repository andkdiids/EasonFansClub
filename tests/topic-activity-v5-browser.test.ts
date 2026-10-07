import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Locator, type Browser } from 'playwright'

async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(label)
}
const expect = Object.assign((locator: Locator) => ({
  toHaveCount: (count: number) => until(async () => await locator.count() === count, `Expected locator count ${count}`),
  toBeVisible: () => until(() => locator.isVisible(), 'Expected visible element'),
  toBeEnabled: () => until(() => locator.isEnabled(), 'Expected enabled element'),
}), { poll: (read: () => unknown) => ({ toBe: (value: unknown) => until(async () => read() === value, `Expected value ${value}`) }) })

// Optional directed browser QA uses ONLY local API fixtures. No app server,
// database, COS credentials or production requests are involved.
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
test('V5 browser: collapsed shared form, global image, submit, live admin count and reply-only management', { skip: process.env.TOPIC_V5_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityFormParticipation} from './components/activities/TopicActivityFormParticipation'; import {TopicActivityFormSubmissionEntry} from './app/admin/activities/TopicActivityFormSubmissionManager'; createRoot(document.getElementById('root')).render(<><TopicActivityFormParticipation activityId="topic-fixture" isAuthenticated={true}/><TopicActivityFormSubmissionEntry activityId="topic-fixture" count={0}/></>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"' },
  })
  const bundle = result.outputFiles[0].text
  const asset = { assetId: 'asset-fixture', storageKey: 'local-fixture.webp', mimeType: 'image/webp', width: 1, height: 1, size: 100, url: '/fixture.svg', thumbnailUrl: '/fixture.svg' }
  type Row = { id: string; activityId: string; userId: string; status: string; submittedAt: string; user: { id: string; nickname: string; avatarUrl: null }; formSchemaSnapshot: unknown; answersSnapshot: unknown[]; attachments: typeof asset[]; replies: Array<{ id: string; content: string; images: typeof asset[]; createdAt: string; sender: { nickname: string } }> }
  const rows: Row[] = []
  const posts: Array<{ answers: Record<string, string>; attachmentAssetIds: string[] }> = []
  let allowImages = true
  const schema = { version: 1, fields: [{ id: 'answer', label: '资料', type: 'TEXT', required: true, placeholder: '填写资料', options: [], multiple: false, maxImages: 0 }] }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const json = (body: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return }
    if (url.pathname === '/fixture.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="orange"/></svg>'); return }
    if (url.pathname.endsWith('/form')) { json({ schema, allowImageAttachments: allowImages, participationMode: 'BOTH', activity: { id: 'topic-fixture', startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() } }); return }
    if (url.pathname.endsWith('/my-form-submissions')) { json({ submissions: rows, page: 1, hasMore: false }); return }
    if (url.pathname === '/api/uploads/topic-activity-image') { for await (const chunk of req) void chunk; json({ asset }); return }
    if (req.method === 'POST' && url.pathname.endsWith('/form-submissions')) {
      let text = ''; for await (const chunk of req) text += chunk
      const body = JSON.parse(text) as typeof posts[number]; posts.push(body)
      rows.push({ id: `form-fixture-${rows.length}`, activityId: 'topic-fixture', userId: 'user-fixture', status: 'SUBMITTED', submittedAt: new Date().toISOString(), user: { id: 'user-fixture', nickname: '本地用户', avatarUrl: null }, formSchemaSnapshot: schema, answersSnapshot: [{ fieldId: 'answer', label: '资料', type: 'TEXT', value: body.answers.answer }], attachments: body.attachmentAssetIds?.length ? [asset] : [], replies: [] })
      json({ success: true, submission: rows[rows.length - 1] }); return
    }
    if (req.method === 'POST' && url.pathname.endsWith('/replies')) {
      let text = ''; for await (const chunk of req) text += chunk
      const body = JSON.parse(text) as { content: string; assetIds: string[] }
      const reply = { id: `reply-${rows[0].replies.length}`, content: body.content, images: body.assetIds.length ? [asset] : [], createdAt: new Date().toISOString(), sender: { nickname: '本地管理员' } }
      rows[0].replies.push(reply); rows[0].status = 'REPLIED'; json({ reply }); return
    }
    if (url.pathname.startsWith('/api/admin/activities/') && url.pathname.endsWith('/form-submissions')) {
      const replied = rows.filter((row) => row.replies.length > 0)
      const filtered = url.searchParams.get('replyStatus') === 'REPLIED' ? replied : url.searchParams.get('replyStatus') === 'UNREPLIED' ? rows.filter((row) => !row.replies.length) : rows
      json({ submissions: filtered, counts: { formSubmissions: rows.length, repliedForms: replied.length, unrepliedForms: rows.length - replied.length, commentSubmissions: 0, approvedUsers: 0 }, page: 1, total: filtered.length, hasMore: false }); return
    }
    if (url.pathname.startsWith('/api/')) { res.statusCode = 404; json({ message: '本地 fixture 未定义' }); return }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`http://127.0.0.1:${address.port}`)
    await expect(page.locator('form')).toHaveCount(0)
    await page.getByRole('button', { name: /^填写(参与)?表单$/ }).click()
    await expect(page.locator('form')).toHaveCount(1)
    await page.getByRole('button', { name: /收起(参与)?表单/ }).click()
    await expect(page.locator('form')).toHaveCount(0)
    await page.getByRole('button', { name: /^填写(参与)?表单$/ }).click()
    await page.locator('form input:not([type=file]):not([type=checkbox])').first().fill('资料答案')
    await page.locator('form input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64') })
    await expect(page.locator('form img')).toHaveCount(1)
    await page.getByRole('button', { name: '移除图片', exact: true }).click()
    await expect(page.locator('form img')).toHaveCount(0)
    await page.locator('form input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64') })
    await expect(page.locator('form img')).toHaveCount(1)
    const submit = page.locator('form button[type=submit]')
    await expect(submit).toBeEnabled()
    await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await expect.poll(() => posts.length).toBe(1)
    assert.deepEqual(posts[0].attachmentAssetIds, ['asset-fixture'])
    await expect(page.getByRole('button', { name: /表单提交（1）/ })).toBeVisible()
    await expect(page.getByText('表单已提交成功。', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: /表单提交（1）/ }).click()
    await page.getByRole('button', { name: /查看详情/ }).last().click()
    assert.equal(await page.getByRole('button', { name: /^(通过|拒绝|确认通过|确认拒绝)$/ }).count(), 0)
    await page.locator('textarea').last().fill('资料已收到')
    await page.getByRole('button', { name: '发送回复', exact: true }).click()
    await expect.poll(() => rows[0].replies.length).toBe(1)
    await expect(page.getByText('资料已收到').last()).toBeVisible()
    await page.locator('input[type=file]').last().setInputFiles({ name: 'reply.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64') })
    await expect(page.getByRole('button', { name: '发送回复', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '发送回复', exact: true }).click()
    await expect.poll(() => rows[0].replies.length).toBe(2)
    assert.equal(rows[0].replies[1].images.length, 1)
    await expect(page.getByText('资料已收到').last()).toBeVisible()
    allowImages = false
    await page.reload()
    await page.getByRole('button', { name: /^填写(参与)?表单$|^再次填写$/ }).first().click()
    await expect(page.locator('form input[type=file]')).toHaveCount(0)
  } finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
