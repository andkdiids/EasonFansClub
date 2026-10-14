import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, webkit, type Browser, type BrowserType } from 'playwright'

async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(label)
}

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const androidUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const iosUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

test('V6 browser fixtures: real ReplyForm SINGLE confirmation, keyboard boundary, and review API error', { skip: process.env.TOPIC_V6_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const nextShimNamespace = 'topic-v6-fixture-next-shim'
  const nextNavigationShim = 'topic-v6-fixture-next-navigation'
  const nextLinkShim = 'topic-v6-fixture-next-link'
  const result = await esbuild.build({
    stdin: {
      contents: `import React, {useRef, useState} from 'react'; import {createRoot} from 'react-dom/client'; import {ReplyForm} from './components/ReplyForm'; import {ReviewConfirmDialog} from './components/activities/ReviewConfirmDialog'; import {SingleCommentConfirmDialog} from './components/activities/SingleCommentConfirmDialog'; function Fixture(){ const [singleOpen,setSingleOpen]=useState(false); const singleDecisionRef=useRef(null); const [reviewOpen,setReviewOpen]=useState(false); const [reviewAction,setReviewAction]=useState('APPROVED'); const [reviewRejectReason,setReviewRejectReason]=useState(''); const [reviewError,setReviewError]=useState(''); const [reviewLoading,setReviewLoading]=useState(false); const reviewLoadingRef=useRef(false); function beforeSingle(){ if(singleDecisionRef.current) return Promise.resolve(false); setSingleOpen(true); return new Promise((resolve)=>{ singleDecisionRef.current=resolve; }); } function resolveSingle(allowed){ setSingleOpen(false); const resolve=singleDecisionRef.current; singleDecisionRef.current=null; resolve?.(allowed); } function openReview(action){ setReviewError(''); setReviewAction(action); setReviewRejectReason(''); setReviewOpen(true); } async function confirmReview(){ if(reviewLoadingRef.current) return; reviewLoadingRef.current=true; setReviewLoading(true); setReviewError(''); try { const response=await fetch('/review',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:reviewAction,rejectReason:reviewRejectReason})}); if(!response.ok){ setReviewError('审核失败，请重试'); return; } setReviewOpen(false); } finally { reviewLoadingRef.current=false; setReviewLoading(false); } } return <main><ReplyForm postId="post-fixture" beforeSubmit={beforeSingle} onReplyCreated={()=>{}}/><SingleCommentConfirmDialog open={singleOpen} loading={false} onCancel={()=>resolveSingle(false)} onConfirm={()=>resolveSingle(true)}/><button type="button" onClick={()=>openReview('APPROVED')}>打开审核-通过</button><button type="button" onClick={()=>openReview('REJECTED')}>打开审核-拒绝</button><ReviewConfirmDialog open={reviewOpen} action={reviewAction} rejectReason={reviewRejectReason} onRejectReasonChange={setReviewRejectReason} loading={reviewLoading} error={reviewError} onCancel={()=>{if(!reviewLoadingRef.current) setReviewOpen(false)}} onConfirm={()=>void confirmReview()}/></main>} createRoot(document.getElementById('root')!).render(<Fixture/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{
      name: 'topic-v6-fixture-next-shims',
      setup(build: { onResolve: (options: { filter: RegExp }, callback: () => { path: string; namespace: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string; resolveDir: string }) => void }) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: nextNavigationShim, namespace: nextShimNamespace }))
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: nextLinkShim, namespace: nextShimNamespace }))
        build.onLoad({ filter: /.*/, namespace: nextShimNamespace }, ({ path }) => ({
          contents: path === nextNavigationShim
            ? 'export function useRouter(){ return { refresh(){} }; }'
            : 'import React from "react"; export default function Link({children,...props}){ return React.createElement("a", props, children); }',
          loader: 'js',
          resolveDir: process.cwd(),
        }))
      },
    }],
  })
  const bundle = result.outputFiles[0].text
  let singleRequests = 0
  let reviewRequests = 0
  let reviewBodies: Array<Record<string, unknown>> = []
  async function readRequestBody(req: import('node:http').IncomingMessage) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return }
    if (req.method === 'POST' && url.pathname === '/api/posts/post-fixture/replies') {
      singleRequests += 1
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ success: true, reply: { id: `fixture-reply-${singleRequests}`, author: { id: 'fixture-user' }, content: 'fixture reply', parentId: null } }))
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/review') {
      reviewRequests += 1
      try {
        const parsed = JSON.parse(await readRequestBody(req))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) reviewBodies.push(parsed as Record<string, unknown>)
      } catch {
        reviewBodies.push({})
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ message: 'fixture error' }))
      return
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const browsers: Array<{ name: string; type: BrowserType; userAgent: string; executablePath?: string }> = [
    { name: 'Android Mobile Chromium', type: chromium, userAgent: androidUserAgent, ...(existsSync(edge) ? { executablePath: edge } : {}) },
  ]
  let webkitAvailable = true
  try {
    const probe = await webkit.launch({ headless: true })
    await probe.close()
  } catch {
    webkitAvailable = false
  }
  if (!webkitAvailable) t.diagnostic('WebKit unavailable locally; Chromium fixture ran, iOS Safari/WebKit simulation remains pending.')
  if (webkitAvailable) browsers.push({ name: 'iOS Safari WebKit', type: webkit, userAgent: iosUserAgent })
  let browser: Browser | null = null
  try {
    for (const target of browsers) {
      singleRequests = 0
      reviewRequests = 0
      reviewBodies = []
      browser = await target.type.launch({ headless: true, ...(target.executablePath ? { executablePath: target.executablePath } : {}) })
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: target.userAgent, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      page.on('pageerror', (error) => t.diagnostic(`${target.name}: pageerror ${error.message}`))
      await page.goto(`http://127.0.0.1:${port}`)
      const composer = page.locator('form.post-reply-form')
      const input = page.getByPlaceholder('写下你的回复，输入 @ 提及好友…')
      const publishButton = composer.locator('button[type="submit"]')
      assert.equal(await publishButton.count(), 1, `${target.name}: real ReplyForm did not render publish button; body=${await page.locator('body').innerText()}`)

      await input.fill('cancel from the real ReplyForm')
      await publishButton.click()
      await page.getByRole('button', { name: '返回检查' }).click()
      assert.equal(singleRequests, 0, `${target.name}: cancelling SINGLE confirmation must not request`)
      await input.fill('double activation from the real ReplyForm')
      await composer.getByRole('button', { name: '发布回复' }).click()
      const singleConfirm = page.getByRole('button', { name: '确认发送' })
      await singleConfirm.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
      await until(async () => singleRequests === 1, `${target.name}: SINGLE confirmation should send exactly one request`)
      await context.close()

      // The existing keyboard contract deliberately keeps Ctrl/Meta+Enter as
      // multiline input. Plain desktop Enter is the actual submit shortcut and
      // must still cross the same controlled SINGLE confirmation boundary.
      singleRequests = 0
      const desktopContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, userAgent: target.userAgent, isMobile: false, hasTouch: false })
      const desktopPage = await desktopContext.newPage()
      await desktopPage.goto(`http://127.0.0.1:${port}`)
      const desktopInput = desktopPage.getByPlaceholder('写下你的回复，输入 @ 提及好友…')
      await desktopInput.fill('modifier keyboard path')
      await desktopInput.press('Control+Enter')
      await desktopInput.press('Meta+Enter')
      assert.equal(await desktopPage.getByRole('dialog').count(), 0, `${target.name}: Ctrl/Meta+Enter preserve multiline and must not bypass confirmation`)
      assert.equal(singleRequests, 0, `${target.name}: Ctrl/Meta+Enter must not request`)
      await desktopInput.press('Enter')
      await until(async () => await desktopPage.getByRole('dialog').count() === 1, `${target.name}: desktop Enter should open SINGLE confirmation`)
      await desktopPage.getByRole('button', { name: '返回检查' }).click()
      assert.equal(singleRequests, 0, `${target.name}: cancelling keyboard SINGLE confirmation must not request`)
      await desktopInput.press('Enter')
      await desktopPage.getByRole('button', { name: '确认发送' }).click()
      await until(async () => singleRequests === 1, `${target.name}: confirming keyboard SINGLE submission should send exactly one request`)

      await desktopPage.getByRole('button', { name: '打开审核-通过' }).click()
      await desktopPage.getByRole('button', { name: '取消' }).click()
      assert.equal(reviewRequests, 0, `${target.name}: cancelling review must not request`)
      await desktopPage.getByRole('button', { name: '打开审核-通过' }).click()
      const reviewConfirm = desktopPage.getByRole('button', { name: '确认通过' })
      assert.equal(await reviewConfirm.getAttribute('type'), 'button', `${target.name}: approve action must use an explicit button`)
      await reviewConfirm.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
      await until(async () => reviewRequests === 1, `${target.name}: review confirmation should send exactly one request`)
      await until(async () => reviewBodies.length === 1, `${target.name}: approve request body should arrive`)
      assert.equal(reviewBodies[0]?.status, 'APPROVED', `${target.name}: approve action should send APPROVED`)
      await until(async () => await desktopPage.getByRole('alert').count() === 1, `${target.name}: API error should stay in modal`)
      assert.equal(await desktopPage.getByRole('dialog').count(), 1, `${target.name}: API error should keep the modal open`)
      await desktopPage.getByRole('button', { name: '取消' }).click()

      await desktopPage.getByRole('button', { name: '打开审核-拒绝' }).click()
      const rejectDialog = desktopPage.getByRole('dialog')
      const rejectReason = rejectDialog.locator('textarea')
      await rejectReason.fill('fixture reject reason')
      const rejectConfirm = rejectDialog.getByRole('button', { name: '确认拒绝' })
      assert.equal(await rejectConfirm.count(), 1, `${target.name}: reject action must render exactly one confirm button`)
      assert.equal(await rejectConfirm.getAttribute('type'), 'button', `${target.name}: reject action must use an explicit button`)
      await rejectConfirm.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
      await until(async () => reviewRequests === 2, `${target.name}: rejected review confirmation should send exactly one request`)
      await until(async () => reviewBodies.length === 2, `${target.name}: reject request body should arrive`)
      assert.equal(reviewBodies[1]?.status, 'REJECTED', `${target.name}: reject action should send REJECTED`)
      assert.equal(reviewBodies[1]?.rejectReason, 'fixture reject reason', `${target.name}: reject reason should be sent`)
      await until(async () => await desktopPage.getByRole('alert').count() === 1, `${target.name}: rejected API error should stay in modal`)
      assert.equal(await desktopPage.getByRole('dialog').count(), 1, `${target.name}: rejected API error should keep the modal open`)
      assert.equal(await rejectReason.inputValue(), 'fixture reject reason', `${target.name}: reject reason should remain after API error`)
      await desktopContext.close()
      await browser.close()
      browser = null
    }
  } finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
