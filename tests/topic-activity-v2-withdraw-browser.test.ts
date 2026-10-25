import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

declare global {
  interface Window { __withdrawRefreshCount?: number }
}

test('screenshot withdrawal confirmation, loading, refresh event and failures work on mobile and desktop', {
  skip: process.env.TOPIC_V2_WITHDRAW_BROWSER_QA !== '1', timeout: 120_000,
}, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const reactPath = require.resolve('react')
  const jsxRuntimePath = require.resolve('react/jsx-runtime')
  const reactDomClientPath = require.resolve('react-dom/client')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>
  }
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TopicActivityV2SubmissionWithdrawButton}from'./components/activities/TopicActivityV2SubmissionWithdrawButton';function Harness(){const[status,setStatus]=useState('PENDING');return <><span>{status}</span><TopicActivityV2SubmissionWithdrawButton activityId="activity-one" submissionId="submission-one" onWithdrawn={()=>setStatus('WITHDRAWN')}/></>}createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    nodePaths: [join(process.cwd(), 'node_modules')], define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'withdraw-next-link-fixture', setup(build: {
      onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string }) => void
    }) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: jsxRuntimePath }))
      build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: reactDomClientPath }))
    } }],
  })

  let responseMode: 'success' | 'conflict' | 'network' = 'success'
  let requests = 0
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
    if (url.pathname.endsWith('/withdraw') && request.method === 'POST') {
      requests++
      if (responseMode === 'network') { response.destroy(); return }
      if (responseMode === 'conflict') {
        response.statusCode = 409; response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ code: 'TOPIC_V2_SUBMISSION_NOT_PENDING', message: '提交状态已变化，请刷新后重试。' })); return
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, status: 'WITHDRAWN' })); return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [360, 1024]) {
      responseMode = 'success'; requests = 0
      const page = await browser.newPage({ viewport: { width, height: 800 } })
      await page.addInitScript(() => {
        window.__withdrawRefreshCount = 0
        window.addEventListener('topic-activity-v2-changed', () => { window.__withdrawRefreshCount = (window.__withdrawRefreshCount || 0) + 1 })
      })
      await page.goto('http://127.0.0.1:' + port + '/')
      const trigger = page.getByRole('button', { name: '撤回截图', exact: true })
      await trigger.click()
      await page.getByRole('dialog', { name: '确认撤回这张截图？' }).waitFor()
      await page.getByText('你可以重新上传并提交正确截图', { exact: false }).waitFor()
      const cancel = page.getByRole('button', { name: '保留当前提交' })
      await cancel.click()
      assert.equal(requests, 0, 'cancel must not send a request')
      await trigger.click()
      const confirm = page.getByRole('button', { name: '确认撤回截图' })
      await confirm.evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByRole('button', { name: '正在撤回…' }).waitFor()
      assert.equal(await page.getByRole('button', { name: '处理中…' }).isDisabled(), true)
      await page.getByRole('status').filter({ hasText: '截图已撤回，可以重新上传。' }).waitFor()
      await page.getByText('WITHDRAWN', { exact: true }).waitFor()
      assert.equal(requests, 1, 'a double click must produce only one withdrawal')
      assert.equal(await page.evaluate(() => window.__withdrawRefreshCount), 1)
      await page.close()
    }

    responseMode = 'conflict'; requests = 0
    const conflictPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await conflictPage.goto('http://127.0.0.1:' + port + '/')
    await conflictPage.getByRole('button', { name: '撤回截图', exact: true }).click()
    await conflictPage.getByRole('button', { name: '确认撤回截图' }).click()
    await conflictPage.getByRole('alert').filter({ hasText: '提交状态已变化，请刷新后重试。' }).waitFor()
    await conflictPage.getByRole('button', { name: '撤回截图', exact: true }).waitFor()
    assert.equal(requests, 1)
    responseMode = 'network'; requests = 0
    await conflictPage.reload()
    await conflictPage.getByRole('button', { name: '撤回截图', exact: true }).click()
    await conflictPage.getByRole('button', { name: '确认撤回截图' }).click()
    await conflictPage.getByRole('alert').filter({ hasText: '网络异常，撤回失败，请稍后重试。' }).waitFor()
    await conflictPage.getByRole('button', { name: '撤回截图', exact: true }).waitFor()
    await conflictPage.close()
  } finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
