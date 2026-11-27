import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'dotenv'

// 2026-11-28 生产故障回归：SHUN_ITEMS_ENABLED 曾只靠临时 PM2 注入，
// ecosystem.config.js 未包含该开关，导致标准 pm2 reload(--update-env) /
// resurrect / 服务器重启后开关丢失，用户看不到百宝箱与道具功能。
// 本测试锁定开关在 PM2 原生启动配置中的持久化契约。

test('ecosystem 将顺大师道具开关持久化为字符串 true', () => {
  const config = require(path.resolve('ecosystem.config.js'))
  const apps = Array.isArray(config.apps) ? config.apps : []
  const web = apps.find((app: { name: string }) => app.name === 'easonfansclub')
  assert.ok(web, 'easonfansclub app 必须存在')
  assert.equal(
    web.env.SHUN_ITEMS_ENABLED,
    'true',
    'SHUN_ITEMS_ENABLED 必须以字符串 "true" 固化在 easonfansclub 的 PM2 env 中',
  )
})

test('部署重写 PM2 环境时保留 ecosystem 中的道具开关', () => {
  const script = readFileSync('scripts/deploy-production-git.sh', 'utf8')
  const source = script.match(/if ! node - "\$\{app_name\}"[^\n]*<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1]
  assert.ok(source, '必须存在部署期 PM2 环境重写脚本')

  let written: { apps: Array<{ env: Record<string, string> }> } | undefined
  const processStub = {
    argv: ['node', '-', 'easonfansclub', 'a'.repeat(40), '3000', '/synthetic-output.json', 'full', ''],
    exitCode: 0,
    stderr: { write: () => undefined },
  }
  runInNewContext(source, {
    URL,
    process: processStub,
    require(name: string) {
      if (name === 'node:path') return path
      if (name === 'dotenv') return { parse }
      if (name === 'node:fs') return {
        readFileSync: () => Buffer.from('DATABASE_URL="mysql://qa:synthetic@db.example/ecfc"\n'),
        writeFileSync: (_name: string, body: string) => { written = JSON.parse(body) },
      }
      if (name === path.resolve('ecosystem.config.js')) {
        return { apps: [{ name: 'easonfansclub', env: { NODE_ENV: 'production', SHUN_ITEMS_ENABLED: 'true' } }] }
      }
      throw Error('UNEXPECTED_REQUIRE ' + name)
    },
  })

  assert.equal(processStub.exitCode, 0)
  assert.equal(
    written?.apps[0].env.SHUN_ITEMS_ENABLED,
    'true',
    '部署重写后的 PM2 配置必须保留 SHUN_ITEMS_ENABLED=true',
  )
})
