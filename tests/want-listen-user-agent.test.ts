import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { recordAntiCheatLog } from '../lib/anti-cheat'
import { normalizeStoredUserAgent, STORED_USER_AGENT_MAX_LENGTH } from '../lib/request-metadata'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

test('持久化 User-Agent 统一限制在 WantListen 数据库列长度内', () => {
  const underLimit = 'a'.repeat(STORED_USER_AGENT_MAX_LENGTH - 1)
  const exactLimit = 'b'.repeat(STORED_USER_AGENT_MAX_LENGTH)
  const overLimit = 'c'.repeat(STORED_USER_AGENT_MAX_LENGTH + 1)

  assert.equal(normalizeStoredUserAgent(underLimit), underLimit)
  assert.equal(normalizeStoredUserAgent(exactLimit), exactLimit)
  assert.equal(normalizeStoredUserAgent(overLimit)?.length, STORED_USER_AGENT_MAX_LENGTH)
  assert.equal(normalizeStoredUserAgent(overLimit), overLimit.slice(0, STORED_USER_AGENT_MAX_LENGTH))
  assert.equal(normalizeStoredUserAgent(null), null)
  assert.equal(normalizeStoredUserAgent(undefined), null)
  assert.equal(normalizeStoredUserAgent(''), null)
})

test('长 Android / 桌面端微信 User-Agent 仍可安全写入反作弊日志', async () => {
  const created: Array<Record<string, unknown>> = []
  const database = {
    gameAntiCheatLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data)
        return args.data
      },
    },
  }
  const androidWechatUserAgent = `Mozilla/5.0 (Linux; Android 15; ${'Pixel '.repeat(30)}wv) AppleWebKit/537.36 MicroMessenger/8.0.60`
  const desktopWechatUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${'Chrome/'.repeat(35)}MicroMessenger/3.9.12`

  await recordAntiCheatLog(database, {
    userId: 'user-1',
    gameType: 'want-listen:WANT_LISTEN',
    userAgent: androidWechatUserAgent,
    suspiciousType: 'FAST_ANSWER',
  })
  await recordAntiCheatLog(database, {
    userId: 'user-1',
    gameType: 'want-listen:CANTONESE_FRAGMENT',
    userAgent: desktopWechatUserAgent,
    suspiciousType: 'FAST_ANSWER',
  })
  await recordAntiCheatLog(database, {
    userId: 'user-1',
    gameType: 'want-listen:FALSE_TITLE',
    userAgent: androidWechatUserAgent,
    suspiciousType: 'FAST_ANSWER',
  })

  assert.equal(created.length, 3)
  assert.ok(created.every((row) => typeof row.userAgent === 'string' && row.userAgent.length <= STORED_USER_AGENT_MAX_LENGTH))
})

test('WantListen session 与反作弊日志使用同一个 User-Agent 归一化器', () => {
  const sessionSource = source('lib/want-listen.ts')
  const antiCheatSource = source('lib/anti-cheat.ts')

  assert.match(sessionSource, /userAgent: normalizeStoredUserAgent\(meta\.userAgent\)/)
  assert.doesNotMatch(sessionSource, /meta\.userAgent\?\.slice\(0, 500\)/)
  assert.match(antiCheatSource, /userAgent: normalizeStoredUserAgent\(input\.userAgent\)/)
  assert.match(antiCheatSource, /from '\.\/request-metadata'/)
})
