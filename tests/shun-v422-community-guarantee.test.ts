import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { defaultShunItemDefinitions, defaultShunItemRules, validateShunItemDraft } from '../lib/shun-item-config'
import { communityCheckBudget, SHUN_COMMUNITY_GUARANTEE_MARK, SHUN_COMMUNITY_TOTAL_COUNTER } from '../lib/shun-item-rewards'
import { shunItemSourceLabel } from '../lib/shun-master'

const draft = () => ({
  enabled: true,
  definitions: JSON.parse(JSON.stringify(defaultShunItemDefinitions)) as typeof defaultShunItemDefinitions,
  rules: JSON.parse(JSON.stringify(defaultShunItemRules)) as Record<string, unknown>,
})

test('社区互动保底额度由配置动态计算，不硬编码 20', () => {
  const base = validateShunItemDraft(draft())
  assert.ok(base)
  assert.equal(communityCheckBudget(base.rules), 20)

  // 后台把评论每日判定从 5 调到 3，额度必须跟着变成 18。
  const tuned = draft()
  ;(tuned.rules.drops as Record<string, { chance: number; dailyChecks: number }>).COMMENT.dailyChecks = 3
  const next = validateShunItemDraft(tuned)
  assert.ok(next)
  assert.equal(communityCheckBudget(next.rules), 18)
})

test('保底使用既有计数器与内部标记，不需要新增数据库字段', () => {
  assert.equal(SHUN_COMMUNITY_TOTAL_COUNTER, 'COMMUNITY_TOTAL')
  assert.equal(SHUN_COMMUNITY_GUARANTEE_MARK, 'GUARANTEE')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  // 复用 ShunItemDailyCounter，不得为保底新增模型/字段。
  assert.match(schema, /model ShunItemDailyCounter \{\n  userId String\n  day String @db\.Char\(10\)\n  counter String @db\.VarChar\(32\)\n  count Int @default\(0\)/)
  assert.equal(/guarantee/i.test(schema), false, 'schema 中不得出现保底专用字段')
  // 保底必须在同一个奖励事务里累加计数，不能依赖客户端。
  const rewards = readFileSync('lib/shun-item-rewards.ts', 'utf8')
  assert.match(rewards, /await bumpCommunityCheckTotal\(tx, userId, day, rules\)/)
})

test('保底投放与概率掉落共用同一池与已落库的随机结果', () => {
  const rewards = readFileSync('lib/shun-item-rewards.ts', 'utf8')
  const block = rewards.slice(rewards.indexOf('const hit = event.dropRoll < drop.chance'), rewards.indexOf('await tx.shunItemDaily.update({ where, data: { behaviorGranted: true } })'))
  assert.match(block, /guarantee = !hit && budget > 0 && used >= budget/, '保底只在全部额度用尽且未命中时触发')
  // 两条分支都复用 grant(...) 的 event.itemRoll，不重新抽道具。
  assert.match(block, /await grant\('COMMUNITY_DROP', guarantee/, '保底走同一条发放路径')
  assert.match(block, /event\.itemRoll\)/, '两者都必须复用事件上已持久化的 itemRoll')
  assert.equal(/randomInt|drawShunItem/.test(block), false, '保底不得重新抽随机数')
})

test('保底在用户可见处完全不可见，仅后台可区分', () => {
  const box = readFileSync('app/shun-master/ShunItemBox.tsx', 'utf8')
  for (const word of ['保底', '必定获得', '剩余保底']) {
    assert.equal(box.includes(word), false, `百宝箱不得出现「${word}」`)
  }
  const master = readFileSync('lib/shun-master.ts', 'utf8')
  const boxPayload = master.slice(master.indexOf('export async function shunItemBox'), master.indexOf('export type ShunItemHistoryFilter'))
  assert.equal(/保底|guarantee/i.test(boxPayload), false, '用户端 items 响应不得含保底字段')
  // 后台接口显式提供内部指标。
  const adminRoute = readFileSync('app/api/admin/shun-master/items/route.ts', 'utf8')
  assert.match(adminRoute, /communityGuarantee: \{ budget:/)
  assert.match(adminRoute, /endsWith: ':GUARANTEE'/)
})

test('保底记录在用户端显示为普通社区互动并保留真实来源', () => {
  assert.equal(shunItemSourceLabel('COMMUNITY_DROP', '2026-11-28:LIKE:GUARANTEE'), '点赞帖子')
  assert.equal(shunItemSourceLabel('COMMUNITY_DROP', '2026-11-28:COMMENT'), '有效评论')
  assert.equal(shunItemSourceLabel('COMMUNITY_DROP', '2026-11-28'), null)
  assert.equal(shunItemSourceLabel('WEEKLY_REWARD', '2026-11-23:5'), '连续 5 天')
})

test('获取方式两段总结说明已彻底移除，不留占位', () => {
  const box = readFileSync('app/shun-master/ShunItemBox.tsx', 'utf8')
  assert.equal(box.includes('社区行为最多额外获得 1 个道具'), false)
  assert.equal(box.includes('以上概率与次数来自服务端当前生效配置'), false)
  // 只保留渠道条目，不新增总结段落
  const guide = box.slice(box.indexOf("tab === 'guide'"), box.indexOf("tab === 'history'"))
  assert.equal(/itemFootnote/.test(guide), false, '获取方式不得保留脚注容器')
})

test('默认关闭：内容只在打开时挂载，且关闭态 display:none', () => {
  const css = readFileSync('app/shun-master/shun.module.css', 'utf8')
  assert.match(css, /\.itemBox:not\(\[open\]\)\{display:none\}/)
  const box = readFileSync('app/shun-master/ShunItemBox.tsx', 'utf8')
  assert.match(box, /\{!open \? null : <>/)
})
