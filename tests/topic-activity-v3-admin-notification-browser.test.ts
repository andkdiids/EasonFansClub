import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { serializeActivity } from '@/lib/activity'
import { buildTopicReviewNotification } from '@/lib/topic-activity-review-notification'

test('V3 actual admin partitions and notification center show complete review evidence without opening activity', { skip: process.env.TOPIC_V3_ADMIN_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const { chromium } = require('playwright') as typeof import('playwright')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> }
  const activities = (['PUBLISHED', 'DRAFT', 'PUBLISHED', 'CANCELLED'] as const).map((status, index) => serializeActivity({
    id: `local-${index}`, title: ['当前示例', '草稿示例', '结束示例', '取消示例'][index], description: '仅本地管理分区夹具', type: 'TOPIC_ACTIVITY', status,
    startsAt: '2020-01-01', endsAt: index === 2 ? '2020-02-01' : '2100-01-01', createdAt: '2020-01-01', updatedAt: '2020-01-01',
  }))
  const text = buildTopicReviewNotification({ activityTitle: '天使的礼物', snapshot: { platformName: '小红书', title: '活动分享' }, status: 'APPROVED', rejectReason: null, grant: { status: 'GRANTED', points: 37 }, eligible: true })
  const notice = { ...text, id: 'local-review', source: 'personal', type: 'SYSTEM', typeLabel: '系统', category: 'system', key: 'topic-v2-review:local:APPROVED:1',
    content: text.content, createdAt: '2026-10-16T00:00:00Z', isRead: true, read: true, readAt: '2026-10-16T00:00:00Z', link: '/activities/local-0', actorUid: null, actorName: null, actorProfile: null, actorBadges: [], popup: false, sticky: false }
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ActivityAdminManager}from'./app/admin/activities/ActivityAdminManager';import{NotificationsClient}from'./app/notifications/NotificationsClient';createRoot(document.getElementById('root')).render(location.search.includes('notifications')?<NotificationsClient initialNotifications={[${JSON.stringify(notice)}]} initialPagination={{page:1,pageSize:20,total:1,totalPages:1,hasMore:false}}/>:<ActivityAdminManager initialActivities={${JSON.stringify(activities)}}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', absWorkingDir: process.cwd(), alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '""' },
    plugins: [{ name: 'local-session', setup(build: {
      onResolve(options: { filter: RegExp }, fn: (args: { path: string }) => { path: string; namespace: string }): void
      onLoad(options: { filter: RegExp; namespace: string }, fn: (args: { path: string }) => { contents: string; loader: string; resolveDir: string }): void
    }) {
      build.onResolve({ filter: /^(next\/(link|navigation)|@\/components\/NotificationProvider)$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.includes('NotificationProvider')
        ? `const summary={total:0,notifications:0,system:0,replies:0,likes:0,wall:0,feedback:0,feedbackReplies:0,friendRequests:0,directMessages:0,messages:0,review:0};const noop=()=>{};export function useNotificationSummary(){return{summary,summaryAvailable:true,updateSummary:noop,refresh:noop}}`
        : `import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)};export function useRouter(){return{refresh(){},push(){},replace(){}}};export function usePathname(){return '/admin/activities'};export function useSearchParams(){return new URLSearchParams(location.search)}`,
        loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const css = (await require('postcss')([require('tailwindcss')({ content: ['./app/admin/activities/*.tsx', './app/notifications/*.tsx', './components/*.tsx', './components/activities/*.tsx'] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css as string
  const calls: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname.startsWith('/api/')) {
      calls.push(`${req.method} ${url.pathname}`); res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(url.pathname === '/api/notifications' ? { notifications: [notice], page: 1, pageSize: 20, total: 1, totalPages: 1, hasMore: false } : { badges: [], materials: [], notifications: [], summary: { total: 0 } })); return
    }
    res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  assert.equal((await fetch(origin)).status, 200, 'HTTP probe before browser')
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}), args: ['--disable-gpu'] })
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
      await page.goto(origin)
      const list = page.locator('#activity-list')
      await list.getByRole('heading', { name: '当前示例', exact: true }).waitFor()
      assert.equal(await list.getByText('取消示例', { exact: true }).count(), 0)
      for (const [tab, title] of [['草稿', '草稿示例'], ['已结束', '结束示例'], ['已取消', '取消示例']]) {
        await list.getByRole('tab', { name: tab, exact: true }).click()
        await list.getByRole('heading', { name: title, exact: true }).waitFor()
        assert.equal(await list.getByText('当前示例', { exact: true }).count(), 0)
        assert.equal(await list.getByRole('button', { name: '删除', exact: true }).count(), 0, 'topic history guard is incomplete, so draft/cancelled tabs must not offer physical deletion')
      }
      assert.equal(await list.getByRole('button', { name: '删除', exact: true }).count(), 0)
      await page.goto(origin + '/?notifications')
      const paragraph = page.getByText(text.content, { exact: true })
      await paragraph.waitFor()
      const visible = await paragraph.evaluate((element) => ({ clamp: getComputedStyle(element).webkitLineClamp, text: element.textContent }))
      assert.notEqual(visible.clamp, '2')
      for (const phrase of ['天使的礼物', '小红书', '37 挂号费', '1 次抽奖资格']) assert.ok(visible.text?.includes(phrase))
      assert.equal(await page.locator('[role="dialog"]').count(), 0, 'notification is readable without opening it or the activity')
      assert.deepEqual(errors, [])
      await page.close()
    }
    assert.ok(calls.every((call) => call.startsWith('GET ')), 'QA must not create production or fixture business writes')
  } finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
