import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { NextResponse } from 'next/server'

const read = (path: string) => readFileSync(path, 'utf8')

test('发帖审核通知模板使用正常 UTF-8 中文，不再写入已知乱码', () => {
  const route = read('app/api/posts/route.ts')

  assert.match(route, /title: '新帖子待审核'/)
  assert.doesNotMatch(route, /鏂板笘瀛愬緟瀹℃牳/)
  assert.doesNotMatch(route, /锟斤拷|�/)
})

test('通知中文、繁体、粤语、emoji 经 JSON 序列化后保持不变', () => {
  const values = [
    '陈奕迅',
    '每日处方',
    '终于加入这个民间组织了！',
    '今日歌词',
    '小臣书',
    '粤语',
    '陀飞轮',
    '❤️',
    '🎵',
  ]

  const decoded = JSON.parse(JSON.stringify({ values })) as { values: string[] }
  assert.deepEqual(decoded.values, values)
})

test('通知 API JSON 响应保留中文，通知链路不引入 latin1 或重复 decode', async () => {
  const notifications = read('lib/notifications.ts')
  const route = read('app/api/notifications/route.ts')
  const payload = { title: '新帖子待审核', content: '陈奕迅 · 陀飞轮 🎵' }
  const response = NextResponse.json(payload)
  const decoded = await response.json() as typeof payload

  assert.equal(decoded.title, payload.title)
  assert.equal(decoded.content, payload.content)
  assert.match(response.headers.get('content-type') || '', /^application\/json/)
  assert.doesNotMatch(notifications, /toString\(['"](?:latin1|binary)['"]\)|TextDecoder|iconv|decodeURIComponent/)
  assert.doesNotMatch(route, /toString\(['"](?:latin1|binary)['"]\)|TextDecoder|iconv|decodeURIComponent/)
})
