import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'dotenv'

function loadEcosystemApps(): Array<{ name: string; env: Record<string, string> }> {
  const source = readFileSync(path.resolve('ecosystem.config.js'), 'utf8')
  const mod = { exports: {} as { apps?: Array<{ name: string; env: Record<string, string> }> } }
  runInNewContext(source, { module: mod, exports: mod.exports })
  return Array.isArray(mod.exports.apps) ? mod.exports.apps : []
}

// 2026-11-28 生产故障回归：SHUN_ITEMS_ENABLED 曾只靠临时 PM2 注入，
// ecosystem.config.js 未包含该开关，导致标准 pm2 reload(--update-env) /
// resurrect / 服务器重启后开关丢失，用户看不到百宝箱与道具功能。
// 本测试锁定开关在 PM2 原生启动配置中的持久化契约。

test('ecosystem 将顺大师道具开关持久化为字符串 true', () => {
  const apps = loadEcosystemApps()
  const web = apps.find((app) => app.name === 'easonfansclub')
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

// systemd 以 `pm2 resurrect` 启动 PM2，只会恢复 `pm2 save` 写出的 dump。
// 部署只 reload 不 save 时，dump 停留在上一次人工快照，重启后新开关丢失。
// full 数据库档位直接 reload 单个应用、app-only 档位走批量 reload，
// 因此快照必须在两者共用的 reload_pm2 汇聚点刷新。
test('部署成功后刷新 pm2 resurrect 快照', () => {
  const script = readFileSync('scripts/deploy-production-git.sh', 'utf8')
  // 函数体内含内联 NODE heredoc（其闭合花括号在第 0 列），正则截取会被截断，
  // 因此按下一个顶层定义的位置切片。
  const start = script.indexOf('reload_pm2() {')
  const end = script.indexOf('reload_release_processes() {')
  assert.ok(start >= 0 && end > start, '必须存在 reload_pm2 与 reload_release_processes 函数')
  const reload = script.slice(start, end)
  assert.match(
    reload,
    /pm2 save/,
    'reload_pm2 成功后必须执行 pm2 save，否则 full 档位部署后重启会恢复陈旧环境',
  )
  assert.ok(
    reload.indexOf('PM2_RELEASE_SHA_MATCH') < reload.indexOf('pm2 save'),
    'pm2 save 必须发生在健康校验通过之后',
  )
  const batch = script.slice(end, end + 600)
  assert.match(batch, /reload_pm2/, '批量 reload 必须复用同一汇聚点')
})
