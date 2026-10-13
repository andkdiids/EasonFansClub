import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'

// This is an opt-in local browser fixture. It exercises the real ReplyForm and
// ContentImageUploader bundle, but it is not a physical WeChat/Android result.
test('V6.1.2 browser: comment image queue/failure/retry and draft preservation', { skip: process.env.CONTENT_IMAGE_V612_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild')
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ReplyForm} from './components/ReplyForm';
    import {ContentImageUploader} from './components/ContentImageUploader';
    function Fixture(){const [draft,setDraft]=useState('');return <ReplyForm postId="post-fixture" draftContent={draft} onDraftChange={setDraft} onDraftClear={()=>setDraft('')} onReplyCreated={()=>{}}/>}
    function CapacityFixture(){const [value,setValue]=useState(Array.from({length:8},(_,index)=>'/existing-'+index));return <ContentImageUploader value={value} onChange={setValue}/>}
    createRoot(document.getElementById('root')).render(location.search.includes('cap')?<CapacityFixture/>:<Fixture/>);
  `
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{
      name: 'navigation-fixture',
      setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string }) => void }) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function useRouter(){return {refresh(){}}}', loader: 'js' }))
      },
    }],
  })
  const bundle = built.outputFiles[0].text
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64')
  let uploadMode: 'hold' | 'fail' | 'success' = 'hold'
  let releaseUpload: (() => void) | null = null
  let uploadRequests = 0
  let replyRequests = 0
  let replyMode: 'fail' | 'success' = 'fail'
  const replyBodies: Array<Record<string, unknown>> = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const json = (body: unknown, status = 200) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(body))
    }
    if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(bundle)
      return
    }
    if (url.pathname === '/image.png') {
      response.setHeader('Content-Type', 'image/png')
      response.end(imageBytes)
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/uploads/content-image') {
      uploadRequests += 1
      for await (const chunk of request) void chunk
      if (uploadMode === 'hold') await new Promise<void>((resolve) => { releaseUpload = resolve })
      if (uploadMode === 'fail') {
        json({ code: 'UPLOAD_FAILED', message: '图片上传失败，请稍后重试' }, 502)
        return
      }
      json({ url: '/image.png', mimeType: 'image/png' })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/posts/post-fixture/replies') {
      replyRequests += 1
      let body = ''
      for await (const chunk of request) body += chunk
      replyBodies.push(JSON.parse(body) as Record<string, unknown>)
      if (replyMode === 'fail') {
        json({ message: '评论暂时无法发送，请稍后重试' }, 500)
        return
      }
      json({ success: true, reply: { id: 'reply-1', author: { id: 'user-1' } } })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      json({ friends: [], stickers: [], categories: [] })
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let browser: Browser | null = null
  try {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })

    await t.test('pending upload disables publish and exposes exact guard; success/edit/failure preserve draft', async () => {
      const page = await browser!.newPage({ viewport: { width: 480, height: 900 } })
      await page.goto(origin)
      const form = page.locator('form.post-reply-form')
      const input = form.locator('textarea')
      await input.fill('保留这段评论草稿')
      await form.locator('input[type=file]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: imageBytes })
      await form.getByText('上传中…', { exact: true }).first().waitFor()
      assert.equal(await form.locator('button[type=submit]').isDisabled(), true)
      await form.getByText('图片尚未上传完成。', { exact: true }).waitFor()
      assert.equal(replyRequests, 0)

      uploadMode = 'success'
      releaseUpload?.()
      await form.getByRole('img', { name: '已上传内容，拖拽可调整顺序' }).waitFor()
      await form.getByText('上传成功', { exact: true }).waitFor()
      assert.equal(await form.locator('button[type=submit]').isEnabled(), true)

      await form.getByRole('button', { name: '编辑', exact: true }).click()
      const editor = page.getByRole('dialog', { name: '图片编辑' })
      await editor.waitFor()
      await editor.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(await input.inputValue(), '保留这段评论草稿')
      assert.equal(await form.getByRole('img', { name: '已上传内容，拖拽可调整顺序' }).count(), 1)

      await form.locator('button[type=submit]').click()
      await form.getByText('评论暂时无法发送，请稍后重试', { exact: true }).waitFor()
      assert.equal(await input.inputValue(), '保留这段评论草稿')
      assert.equal(await form.getByRole('img', { name: '已上传内容，拖拽可调整顺序' }).count(), 1)
      assert.equal(replyRequests, 1)

      replyMode = 'success'
      await form.locator('button[type=submit]').click()
      await page.waitForFunction(() => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.value === '')
      await page.close()
    })

    await t.test('failed upload remains visible and stops after bounded retries', async () => {
      uploadMode = 'fail'
      const page = await browser!.newPage({ viewport: { width: 480, height: 900 } })
      await page.goto(origin)
      const form = page.locator('form.post-reply-form')
      const input = form.locator('textarea')
      await input.fill('失败后仍保留的草稿')
      await form.locator('input[type=file]').setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: imageBytes })
      await form.getByText(/上传失败（0\/3 次重试）/, { exact: false }).waitFor()
      assert.equal(await form.locator('button[type=submit]').isDisabled(), true)
      await form.getByText('图片上传失败，请重试或删除失败图片后再发布。', { exact: true }).first().waitFor()
      const beforeDoubleClick = uploadRequests
      await form.getByRole('button', { name: '重试', exact: true }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await form.getByText(/上传失败（1\/3 次重试）/, { exact: false }).waitFor()
      assert.equal(uploadRequests, beforeDoubleClick + 1)
      for (const count of [2, 3]) {
        await form.getByRole('button', { name: '重试', exact: true }).click()
        await form.getByText(new RegExp(`上传失败（${count}\\/3 次重试）`), { exact: false }).waitFor()
      }
      assert.equal(await form.getByRole('button', { name: '重试次数已达上限', exact: true }).isDisabled(), true)
      assert.equal(await input.inputValue(), '失败后仍保留的草稿')
      await page.close()
    })

    await t.test('失败项不预占旧名额，但达到 9 张后禁止重试而不丢状态', async () => {
      uploadMode = 'fail'
      const page = await browser!.newPage({ viewport: { width: 480, height: 900 } })
      await page.goto(origin + '/?cap=1')
      const input = page.locator('input[type=file]')
      await input.setInputFiles({ name: 'failed-at-cap.png', mimeType: 'image/png', buffer: imageBytes })
      const failed = page.locator('article').filter({ hasText: '上传失败' }).first()
      await failed.waitFor()
      uploadMode = 'success'
      await input.setInputFiles({ name: 'ninth.png', mimeType: 'image/png', buffer: imageBytes })
      await page.locator('img[alt="已上传内容，拖拽可调整顺序"]').nth(8).waitFor()
      const retry = failed.getByRole('button', { name: '请先删除图片', exact: true })
      await retry.waitFor()
      assert.equal(await retry.isDisabled(), true)
      await failed.getByText('已达到图片数量上限，请先删除图片后再重试。', { exact: true }).waitFor()
      await page.close()
    })
  } finally {
    ;(releaseUpload as (() => void) | null)?.()
    await browser?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
