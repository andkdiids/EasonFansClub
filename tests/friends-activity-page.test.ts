import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('好友页面不再重复查询或展示好友列表与用户搜索', () => {
  const page = read('app/friends/page.tsx')
  assert.doesNotMatch(page, /friendship\.findMany/)
  assert.doesNotMatch(page, /搜索 UID、昵称、手机号或邮箱/)
  assert.doesNotMatch(page, /好友列表/)
  assert.doesNotMatch(page, /api\/friends\/list/)
})

test('FriendDock 继续独立使用原好友列表和搜索接口', () => {
  const dock = read('components/FriendDock.tsx')
  const listRoute = read('app/api/friends/list/route.ts')
  assert.match(dock, /fetch\(`\/api\/friends\/list\?\$\{params\}`/)
  assert.match(listRoute, /export async function GET/)
})

test('好友申请合并为默认全部、收到和发出三个分类', () => {
  const page = read('app/friends/page.tsx')
  assert.match(page, /好友申请/)
  assert.match(page, />全部申请</)
  assert.match(page, />收到申请</)
  assert.match(page, />发出申请</)
  assert.match(page, /requestType: RequestTab = .* \? params\.requestType : 'all'/)
  assert.match(page, /FriendRequestDecision/)
  assert.match(page, /FriendRequestCancel/)
  for (const status of ['等待验证', '已通过', '已拒绝', '等待对方确认', '取消申请']) {
    assert.match(page + read('components/FriendRequestActions.tsx'), new RegExp(status))
  }
})

test('好友动态 API 只允许挂号和发帖并执行服务端分页', () => {
  const route = read('app/api/friends/activity/route.ts')
  assert.match(route, /ALLOWED_TYPES = \['CHECKIN', 'POST'\]/)
  assert.match(route, /page = positiveInteger/)
  assert.match(route, /limit = positiveInteger/)
  assert.match(route, /skip: \(page - 1\) \* limit/)
  assert.match(route, /take: limit/)
  assert.match(route, /friendActivity\.count/)
  assert.doesNotMatch(route, /'LIKE'|'COMMENT'|'REPLY'/)
})

test('好友动态默认最近七天并支持日期、类型和分页筛选', () => {
  const panel = read('components/FriendActivityPanel.tsx')
  assert.match(panel, /useState<TimeFilter>\('7days'\)/)
  assert.match(panel, /<option value="today">今天/)
  assert.match(panel, /<option value="yesterday">昨天/)
  assert.match(panel, /<option value="custom">自定义日期/)
  assert.match(panel, /<option value="CHECKIN">今日挂号/)
  assert.match(panel, /<option value="POST">最近发帖/)
  assert.match(panel, /limit: '20'/)
  assert.match(panel, />上一页</)
  assert.match(panel, />下一页</)
})
