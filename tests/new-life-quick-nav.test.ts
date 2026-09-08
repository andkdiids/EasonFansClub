import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getEconomyReport, getTasksByKind, resolveGrowthTaskDestination } from '@/lib/growth-tasks/registry'

const read = (path: string) => readFileSync(path, 'utf8')

const expectedDestinations = [
  ['PROFILE_COMPLETE', '完善个人资料', '/profile?edit=1', '直接打开资料编辑器。'],
  ['FIRST_POST', '发表第一篇帖子', '/posts/new', '进入现有发帖编辑器。'],
  ['FIRST_COMMENT', '第一次回复他人', '/forum', '进入广场寻找可回复的帖子。'],
  ['FIRST_RECEIVED_COMMENT', '第一次收到回复', null, '这是别人对用户帖子的被动互动，没有用户可主动开始的目标。'],
  ['FIRST_FRIEND', '成为第一位好友', '/friends', '进入好友页建立好友关系。'],
  ['FIRST_WALL_MESSAGE', '第一次留言', '/friends', '从好友页进入目标用户并留言。'],
  ['FIRST_EASMUSIC_RATING', '第一次使用 EasMusic 评分', '/ratings', '进入 EasMusic 评分入口。'],
  ['COMPLETE_TOP27', '完成 Top 27', '/ratings?view=personal&type=songs', '直接进入个人 Top 27 编辑视图。'],
  ['COMPLETE_TOP10_ALBUM', '完成 Top 10 专辑', '/ratings?view=personal&type=albums', '直接进入个人 Top 10 专辑编辑视图。'],
  ['FIRST_SALON', '第一次投稿沙龙', '/salon/upload', '直接进入沙龙投稿页。'],
  ['FIRST_BEAD_PROJECT', '第一次保存贝多芬与我作品', '/studio/beads', '直接进入贝多芬与我创作工具。'],
  ['FIRST_ACTIVITY_REGISTRATION', '第一次报名活动', '/activities', '进入活动中心选择活动报名。'],
  ['FIRST_ACTIVITY_ATTENDANCE', '第一次参加活动', null, '现场核销由人工或二维码完成，不伪造可操作的线上入口。'],
  ['FIRST_BADGE', '获得第一枚非初始勋章', '/badges', '进入勋章展览馆查看可获得的勋章。'],
  ['FIRST_BADGE_EQUIP', '第一次佩戴勋章', '/badges', '进入勋章展览馆进行佩戴。'],
  ['FIRST_CONCERT_SEEN', '第一次记录看过的演唱会', '/music/live/me', '进入我的现场记录入口。'],
] as const

test('16 项新生活逐项绑定统一目的地，奖励总额和项目数不变', () => {
  const items = getTasksByKind('newLife')
  const expectedCodes = expectedDestinations.map(([code]) => code)
  assert.equal(items.length, 16)
  assert.deepEqual(items.map((item) => item.code), expectedCodes)
  assert.equal(getEconomyReport().newLifeTotal, 208)

  for (const [code, title, destination] of expectedDestinations) {
    const item = items.find((candidate) => candidate.code === code)
    assert.ok(item, `missing task ${code}`)
    assert.equal(item?.title, title)
    assert.equal(item?.actionHref || null, destination)
    assert.equal(resolveGrowthTaskDestination(code as typeof items[number]['code']) || null, destination)
  }
})

test('只有有意义目的地的项目可点击，被动/人工核销项目没有链接或箭头', () => {
  const items = getTasksByKind('newLife')
  const clickable = items.filter((item) => Boolean(item.actionHref))
  const passive = items.filter((item) => !item.actionHref)
  assert.equal(clickable.length, 14)
  assert.equal(passive.length, 2)
  assert.deepEqual(passive.map((item) => item.code), ['FIRST_RECEIVED_COMMENT', 'FIRST_ACTIVITY_ATTENDANCE'])
})

test('新生活整行复用 registry actionHref；完成状态仍可导航，领取按钮阻止行事件', () => {
  const panel = read('components/GrowthPanel.tsx')
  assert.match(panel, /function GrowthNewLifeRow/)
  assert.match(panel, /if \(item\.actionHref && completed && !claimed\)/)
  assert.match(panel, /<Link href=\{item\.actionHref\}/)
  assert.match(panel, /growth-new-life-row-link/)
  assert.match(panel, /event\.stopPropagation\(\)/)
  assert.match(panel, /overview\.newLife\.items\.map\(\(item\) => <GrowthNewLifeRow/)
  assert.doesNotMatch(panel, /去完成/)
  assert.doesNotMatch(panel, /FIRST_(POST|COMMENT|FRIEND).*router\.push/)
})

test('今日任务与新生活都通过同一个 registry destination resolver 输出目的地', () => {
  const service = read('lib/growth-tasks/service.ts')
  assert.match(service, /resolveGrowthTaskDestination\(task\.code\)/)
  assert.match(read('components/GrowthPanel.tsx'), /item\.actionHref \? <Link href=\{item\.actionHref\}/)
})
