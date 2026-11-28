import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { defaultShunItemDefinitions, defaultShunItemRules, SHUN_GIFT_DAILY_RECEIVE_LIMIT, validateShunItemDraft } from '../lib/shun-item-config'
import { SHUN_GIFT_WEIGHTS } from '../lib/shun-item-rules'

const draft = () => ({
  enabled: true,
  // 深拷贝：defaultShunItemDefinitions 是模块级共享数组，测试里改写会污染其它用例。
  definitions: JSON.parse(JSON.stringify(defaultShunItemDefinitions)) as typeof defaultShunItemDefinitions,
  rules: JSON.parse(JSON.stringify(defaultShunItemRules)) as Record<string, unknown>,
})

test('V4.2.1 每日收礼上限默认与归一化都是 1', () => {
  assert.equal(SHUN_GIFT_DAILY_RECEIVE_LIMIT, 1)
  assert.equal(defaultShunItemRules.giftsReceived, 1)
  const defaults = validateShunItemDraft(draft())
  assert.ok(defaults)
  assert.equal(defaults.rules.giftsReceived, 1)

  // 线上旧配置仍是 2：校验不能失败（否则百宝箱与奖励链路一起停摆），但必须按 1 生效。
  const legacy = draft()
  legacy.rules.giftsReceived = 2
  const normalized = validateShunItemDraft(legacy)
  assert.ok(normalized, '旧配置必须仍然通过校验')
  assert.equal(normalized.rules.giftsReceived, 1, '旧配置的 2 次上限必须归一化为 1')
})

test('天使的礼物说明改为双向赠礼且不可被后台改写', () => {
  const defaults = validateShunItemDraft(draft())
  assert.ok(defaults)
  const gift = defaults.definitions.find((item) => item.code === 'FRIEND_GIFT')
  assert.ok(gift)
  assert.match(gift.description, /回礼/)

  const tampered = draft()
  const row = (tampered.definitions as { code: string; description: string }[]).find((item) => item.code === 'FRIEND_GIFT')
  assert.ok(row)
  row.description = '随便写点什么'
  const normalized = validateShunItemDraft(tampered)
  assert.ok(normalized)
  assert.match(normalized.definitions.find((item) => item.code === 'FRIEND_GIFT')!.description, /回礼/)
})

test('赠礼专属池固定为三种道具，合计 100%，且不含天使的礼物', () => {
  assert.deepEqual(SHUN_GIFT_WEIGHTS, { EXTRA_ATTEMPT: 45, EXTRA_SUSPECT: 30, REVENGE: 25 })
  assert.equal(Object.values(SHUN_GIFT_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100)
  for (const forbidden of ['FRIEND_GIFT', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE']) {
    assert.equal(Object.hasOwn(SHUN_GIFT_WEIGHTS, forbidden), false, `${forbidden} 不得进入赠礼专属池`)
  }
  const defaults = validateShunItemDraft(draft())
  assert.ok(defaults)
  assert.equal(defaults.rules.gifts.EXTRA_ATTEMPT, 45)
})

test('百宝箱三分页、紧凑卡片与赠礼文案在组件中落地', () => {
  const box = readFileSync('app/shun-master/ShunItemBox.tsx', 'utf8')
  for (const label of ['我的道具', '获取方式', '历史记录', '礼物已送达！', 'TA 收到了', '你也收到了']) {
    assert.ok(box.includes(label), `百宝箱缺少文案：${label}`)
  }
  // 历史记录必须来自服务端分页接口，而不是一次性平铺。
  assert.match(box, /item-history/)
  // 获取方式必须由服务端配置驱动，避免后台调整后说明不一致。
  assert.match(box, /box\.guide/)
  assert.match(box, /guide\.giftsReceived/)
})

test('百宝箱布局：H5 双列、PC 三列、弹窗限高且内容独立滚动', () => {
  const css = readFileSync('app/shun-master/shun.module.css', 'utf8')
  assert.match(css, /\.itemGrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /@media \(min-width:720px\)\{\.itemGrid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\}/)
  assert.match(css, /\.itemBox\{[^}]*max-height:85dvh/)
  assert.match(css, /\.itemBody\{[^}]*overflow-y:auto/)
})

test('顺取结果弹窗两个按钮上下等宽排列', () => {
  const client = readFileSync('app/shun-master/ShunMasterClient.tsx', 'utf8')
  const css = readFileSync('app/shun-master/shun.module.css', 'utf8')
  assert.match(css, /\.stackedActions\{display:grid;grid-template-columns:1fr;gap:8px/)
  assert.match(css, /\.stackedActions button\{width:100%/)
  // 匿名留言与「不留言并再顺一手」必须落在同一个 stackedActions 容器里。
  const section = client.slice(client.indexOf('className={styles.stackedActions}'))
  const firstButton = section.indexOf('匿名留言')
  const secondButton = section.indexOf('不留言并再顺一手')
  assert.ok(firstButton > 0 && secondButton > firstButton, '两个按钮必须在同一纵向容器内依次排列')
  assert.ok(section.slice(0, secondButton + 40).includes('styles.wide'), '两个按钮都必须占满整行')
})

test('顺取前快捷使用道具只在真正可用时弹出', () => {
  const client = readFileSync('app/shun-master/ShunMasterClient.tsx', 'utf8')
  assert.match(client, /const ATTACK_ORDER = \['TARGET_FRIEND', 'DOUBLE_AMOUNT', 'EXTRA_SUSPECT'\]/)
  assert.match(client, /const takeItems = box\?\.enabled \? box\.items\.filter\(\(item\) => \(ATTACK_ORDER as readonly string\[\]\)\.includes\(item\.code\)/)
  assert.match(client, /function startTake\(\)/)
  assert.match(client, /要使用道具吗？/)
  assert.match(client, /不使用道具/)
  assert.match(client, /选择本次使用的道具/)
  assert.match(client, /全部取消/)
  assert.match(client, /可同时选择多种道具，效果将叠加生效。/)
  assert.match(client, /aria-label="关闭"/)
  // 顺一手按钮必须走 startTake，而不是直接 attempt()。
  assert.match(client, /onClick=\{startTake\}/)
})

test('历史记录接口校验筛选与分页参数', () => {
  const route = readFileSync('app/api/shun-master/[action]/route.ts', 'utf8')
  assert.match(route, /action === 'item-history'/)
  assert.match(route, /筛选条件无效/)
  assert.match(route, /分页参数无效/)
})

// V4.2.2 生产故障回归：V4.2.1 给 .itemBox 加了 display:flex，作者样式优先级
// 高于浏览器对 dialog:not([open]) 的 display:none，导致未点击入口时百宝箱
// 整块内容留在页面流里（无遮罩、与主页面重叠、被按钮遮挡）。
test('百宝箱关闭态隐藏由 dialog 契约保证，不靠 z-index 掩盖', () => {
  const css = readFileSync('app/shun-master/shun.module.css', 'utf8')
  assert.match(css, /\.itemBox:not\(\[open\]\)\{display:none\}/, '关闭态必须显式 display:none')
  assert.match(css, /\.itemBox\[open\]\{display:flex;flex-direction:column\}/, '分栏布局只能在打开态生效')
  const base = css.match(/^\.itemBox\{[^}]*\}/m)?.[0] ?? ''
  assert.ok(base, '必须存在 .itemBox 基础声明')
  assert.equal(/display\s*:/.test(base), false, '基础 .itemBox 不得声明 display，否则会再次覆盖 dialog 默认隐藏')
})

test('百宝箱只在打开时挂载内容，关闭即整体卸载', () => {
  const box = readFileSync('app/shun-master/ShunItemBox.tsx', 'utf8')
  assert.match(box, /\{!open \? null : <>\s*\n\s*<div className=\{styles\.itemBoxHeader\}>/, '内容必须由 open 控制挂载')
  const openGuard = box.indexOf('{!open ? null : <>')
  const headerIndex = box.indexOf('styles.itemBoxHeader')
  assert.ok(openGuard > 0 && openGuard < headerIndex, '挂载守卫必须包裹全部内容')
})
