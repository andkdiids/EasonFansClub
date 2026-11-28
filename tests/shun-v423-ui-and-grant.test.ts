import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SHUN_ITEM_CATALOG } from '../lib/shun-item-rules'
import {
  normalizeShunItemGrantInput, ShunItemGrantError, SHUN_ITEM_GRANT_PERMISSION,
} from '../lib/shun-item-grants'

const key = 'qa-grant-0001-abcd'
const valid = () => ({ items: [{ code: 'RETRY_CAPTURE', quantity: 1 }], reason: '回馈活动', notify: true, idempotencyKey: key })

test('V4.2.3 页头从首屏就左对齐，动作位预留固定宽度', () => {
  const css = readFileSync('app/shun-master/shun.module.css', 'utf8')
  const heading = css.match(/^\.heading\{[^}]*\}/m)?.[0] ?? ''
  assert.ok(heading, '必须存在 .heading')
  assert.match(heading, /justify-content:flex-start/, '标题区不得居中，否则库存回来后整块会跳')
  assert.equal(/justify-content:center/.test(heading), false, '不得保留居中布局')
  assert.match(css, /\.headingAction\{[^}]*margin-inline-start:auto/, '动作位必须始终存在并占位')
  assert.match(css, /\.headingAction\{[^}]*min-width:118px/, '动作位必须预留固定宽度')
  assert.match(css, /\.itemToggleSkeleton\{[^}]*width:104px/, '加载占位必须固定宽度')
  const client = readFileSync('app/shun-master/ShunMasterClient.tsx', 'utf8')
  // 加载中渲染占位而不是假库存 0：真实按钮只在 box.enabled 时出现。
  assert.match(client, /box === undefined/)
  assert.match(client, /styles\.itemToggleSkeleton/)
  assert.equal(/itemToggleSkeleton[^>]*百宝箱 · /.test(client), false, '占位不得显示任何库存数字')
  assert.match(client, /styles\.headingAction/)
})

test('V4.2.3 百宝箱入口为香槟金描边紧凑按钮，红点不影响尺寸', () => {
  const css = readFileSync('app/shun-master/shun.module.css', 'utf8')
  const toggle = css.match(/^\.itemToggle\{[^}]*\}/m)?.[0] ?? ''
  assert.match(toggle, /border:1px solid #c8a878/, '必须有细描边')
  assert.match(toggle, /border-radius:10px/, '必须轻微圆角')
  assert.match(toggle, /background:#f4e9d8/, '浅色模式低饱和米金背景')
  assert.match(toggle, /white-space:nowrap/, '按钮不得换行')
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{[\s\S]*?\.itemToggle\{background:#262019/, '深色模式必须有对应配色')
  assert.match(css, /\.itemDot\{position:absolute/, '红点必须绝对定位，不改变按钮尺寸')
  const client = readFileSync('app/shun-master/ShunMasterClient.tsx', 'utf8')
  assert.match(client, /className=\{styles\.itemToggle\}/)
  assert.match(client, /百宝箱 · \{box\.total\}/)
  // V4.2.2 的关闭态修复不得被改回
  assert.match(css, /\.itemBox:not\(\[open\]\)\{display:none\}/)
})

test('V4.2.3 顶部公共导航移除顺大师专属 LOGO 与文字', () => {
  const topbar = readFileSync('components/layout/Topbar.tsx', 'utf8')
  assert.equal(topbar.includes('ShunMasterLogo'), false, '公共导航不得再引入顺大师 LOGO')
  assert.equal(/aria-current="page"[\s\S]{0,120}顺大师/.test(topbar), false, '不得保留顺大师选中项')
  assert.match(topbar, /app-topbar-brand/, '私家E院品牌位必须保留')
  assert.match(topbar, /app-topbar-actions/, '主题切换与头像必须保留')
  // 顺大师路由与娱乐天空入口保持不变
  assert.ok(readFileSync('app/shun-master/page.tsx', 'utf8').length > 0)
  assert.match(readFileSync('components/games/GameCenter.tsx', 'utf8'), /shun-master-entry/)
})

test('V4.2.3 七种道具都可由管理员直接发放，数量与原因受服务端校验', () => {
  const codes = Object.keys(SHUN_ITEM_CATALOG)
  assert.equal(codes.length, 7)
  for (const code of codes) {
    const parsed = normalizeShunItemGrantInput({ ...valid(), items: [{ code, quantity: 3 }] })
    assert.equal(parsed.items[0].code, code)
    assert.equal(parsed.items[0].quantity, 3)
  }
  const reject = (body: unknown, message: string) =>
    assert.throws(() => normalizeShunItemGrantInput(body), (error: unknown) =>
      error instanceof ShunItemGrantError && error.code === 'INVALID_INPUT', message)
  reject({ ...valid(), items: [] }, '空道具列表')
  reject({ ...valid(), items: [{ code: 'NOT_AN_ITEM', quantity: 1 }] }, '未知道具')
  reject({ ...valid(), items: [{ code: 'REVENGE', quantity: 0 }] }, '数量 0')
  reject({ ...valid(), items: [{ code: 'REVENGE', quantity: 100 }] }, '数量超上限')
  reject({ ...valid(), items: [{ code: 'REVENGE', quantity: 1.5 }] }, '非整数数量')
  reject({ ...valid(), items: [{ code: 'REVENGE', quantity: 1 }, { code: 'REVENGE', quantity: 2 }] }, '重复道具')
  reject({ ...valid(), reason: '   ' }, '空原因')
  reject({ ...valid(), idempotencyKey: 'short' }, '幂等键过短')
  // 多道具组合
  const multi = normalizeShunItemGrantInput({ ...valid(), items: [
    { code: 'RETRY_CAPTURE', quantity: 1 }, { code: 'FRIEND_GIFT', quantity: 2 },
  ] })
  assert.equal(multi.items.length, 2)
  assert.equal(multi.items.reduce((sum, item) => sum + item.quantity, 0), 3)
})

test('V4.2.3 发放任务具备权限、幂等、分批与审计契约', () => {
  const service = readFileSync('lib/shun-item-grants.ts', 'utf8')
  assert.equal(SHUN_ITEM_GRANT_PERMISSION, 'user_reward_manage')
  // 权限在服务端校验
  const route = readFileSync('app/api/admin/shun-master/item-grants/route.ts', 'utf8')
  assert.equal((route.match(/requireAdmin\(SHUN_ITEM_GRANT_PERMISSION\)/g) ?? []).length, 3, 'GET/POST/PATCH 都必须校验权限')
  // 幂等：同键复用任务
  assert.match(service, /findUnique\(\{ where: \{ idempotencyKey: input\.idempotencyKey \} \}\)/)
  assert.match(service, /reused: true/)
  // 快照 + 分批
  assert.match(service, /SHUN_ITEM_GRANT_BATCH = 200/)
  assert.match(service, /createMany\(\{\s*\n\s*data: recipients\.slice/, '用户名单必须快照化')
  // 每个用户一个事务，逐件幂等
  assert.match(service, /requestKey: `grant:\$\{task\.id\}:\$\{item\.code\}:\$\{unit\}`/)
  assert.match(service, /type: 'ADMIN_GRANT'/)
  // 通知按任务合并且幂等
  assert.match(service, /key: `shun:item-grant:\$\{task\.id\}`/)
  assert.equal((service.match(/createNotificationWithDb\(/g) ?? []).length, 1, '多道具必须合并为一条通知')
  // 重试只处理失败行
  assert.match(service, /where: \{ taskId, status: 'FAILED' \}/)
  assert.match(service, /status: 'PENDING', failureReason: null, finishedAt: null/)
  // 取消不撤回已发放
  assert.match(service, /where: \{ taskId, status: 'PENDING' \},\s*\n\s*data: \{ status: 'SKIPPED', failureReason: '任务已取消'/)
  // worker 接入，进程重启可续跑
  assert.match(readFileSync('lib/shun-notify-worker.ts', 'utf8'), /runShunItemGrantSweep/)
})

test('V4.2.3 管理员发放使用独立来源，用户可见文案为 E院赠礼', () => {
  const inventory = readFileSync('lib/shun-item-inventory.ts', 'utf8')
  assert.match(inventory, /ADMIN_GRANT: \[1, 0\]/)
  const master = readFileSync('lib/shun-master.ts', 'utf8')
  assert.match(master, /acquired: \[[^\]]*'ADMIN_GRANT'/, '获取筛选必须包含管理员发放')
  assert.match(master, /grantReason: entry\.type === 'ADMIN_GRANT'/, '历史必须带出用户可见原因')
  const box = readFileSync('app/shun-master/ShunItemBox.tsx', 'utf8')
  assert.match(box, /ADMIN_GRANT: 'E院赠礼'/)
  assert.match(box, /发放原因：/)
  // 不得伪装成其他来源
  assert.equal(/ADMIN_GRANT: '(今天只做一件事|社区互动|收到好友赠礼|赠礼回礼)'/.test(box), false)
})

test('V4.2.3 后台新增道具发放分页且按权限显示', () => {
  const page = readFileSync('app/admin/shun-master/page.tsx', 'utf8')
  assert.match(page, /ShunItemGrantAdmin/)
  assert.match(page, /hasAdminPermission\(user, 'user_reward_manage'\)/)
  const tabs = readFileSync('app/admin/shun-master/ShunAdminTabs.tsx', 'utf8')
  assert.match(tabs, /道具发放/)
  const ui = readFileSync('app/admin/shun-master/ShunItemGrantAdmin.tsx', 'utf8')
  assert.match(ui, /预计发放用户/)
  assert.match(ui, /预计发放总量/)
  assert.match(ui, /确认创建任务/)
  assert.match(ui, /重试失败/)
})
