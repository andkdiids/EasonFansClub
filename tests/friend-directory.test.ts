import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  FRIEND_DIRECTORY_LETTERS,
  getFriendSortInfo,
  getInitialLetter,
  groupFriendsByLetter,
  resolveFriendIndexTarget,
  sortFriendsAlphabetically,
} from '../lib/friend-directory'

const read = (path: string) => readFileSync(path, 'utf8')
const friendDock = read('components/FriendDock.tsx')
const alphabetIndex = read('components/FriendAlphabetIndex.tsx')
const friendListRoute = read('app/api/friends/list/route.ts')
const globalStyles = read('app/globals.css')

test('中文昵称按拼音首字母归组', () => {
  const cases = {
    阿明: 'A',
    白白: 'B',
    陈医生: 'C',
    林心诚: 'L',
    王小明: 'W',
    张三: 'Z',
    周周: 'Z',
  } as const

  for (const [name, expected] of Object.entries(cases)) assert.equal(getInitialLetter(name), expected)
})

test('英文、重音拉丁字母、数字和符号使用通讯录规则', () => {
  assert.equal(getInitialLetter('Aaron'), 'A')
  assert.equal(getInitialLetter('apple'), 'A')
  assert.equal(getInitialLetter('Ben'), 'B')
  assert.equal(getInitialLetter('Zoe'), 'Z')
  assert.equal(getInitialLetter('Ángel'), 'A')
  assert.equal(getInitialLetter('00093'), '#')
  assert.equal(getInitialLetter('7仔'), '#')
  assert.equal(getInitialLetter('@Eason'), '#')
  assert.equal(getInitialLetter('❤️Eason'), '#')
  assert.equal(getInitialLetter(''), '#')
  assert.deepEqual(FRIEND_DIRECTORY_LETTERS, [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'])
})

test('中英文混合名以第一个有效排序字符归组，并按完整拼音排序', () => {
  assert.equal(getInitialLetter('Eason陈'), 'E')
  assert.equal(getInitialLetter('陈Eason'), 'C')
  assert.equal(getInitialLetter('A陈奕迅'), 'A')

  const rows = [
    { id: '4', displayName: '陈奕迅' },
    { id: '3', displayName: '陈大' },
    { id: '2', displayName: '陈白' },
    { id: '1', displayName: '陈安' },
  ]
  assert.deepEqual(
    sortFriendsAlphabetically(rows).map((friend) => friend.displayName),
    ['陈安', '陈白', '陈大', '陈奕迅'],
  )
})

test('好友备注优先于 nickname，删除备注后会回到公开昵称首字母', () => {
  const friend = { id: 'friend-1', uid: 1, nickname: '张三', friendRemark: '阿张' }
  const displayName = (item: typeof friend) => item.friendRemark || item.nickname
  assert.equal(getInitialLetter(displayName(friend)), 'A')
  assert.equal(getInitialLetter(displayName({ ...friend, friendRemark: '' })), 'Z')
  assert.equal(getFriendSortInfo('   医生陈   ').sortName, '医生陈')
})

test('# 分组数字优先且排序稳定，空分组不生成 section', () => {
  const rows = [
    { id: 'symbol', uid: 5, displayName: '@ABC' },
    { id: '100', uid: 4, displayName: '100' },
    { id: '001', uid: 1, displayName: '001' },
    { id: '007', uid: 2, displayName: '007' },
    { id: '27', uid: 3, displayName: '27' },
  ]
  const sections = groupFriendsByLetter(rows)
  assert.deepEqual(sections.map((section) => section.letter), ['#'])
  assert.deepEqual(sections[0].friends.map((friend) => friend.displayName), ['001', '007', '27', '100', '@ABC'])
  assert.deepEqual(sections[0].friends.map((friend) => friend.indexLetter), ['#', '#', '#', '#', '#'])
})

test('字母索引点击不存在字母时跳到后面的首个有效分组，末尾则落到最后一组', () => {
  assert.equal(resolveFriendIndexTarget('Q', ['A', 'R', '#']), 'R')
  assert.equal(resolveFriendIndexTarget('Z', ['A', 'R', '#']), '#')
  assert.equal(resolveFriendIndexTarget('#', ['A', 'R', '#']), '#')
  assert.equal(resolveFriendIndexTarget('A', []), null)
})

test('空昵称和空好友列表都能安全处理，不生成空字母分组', () => {
  assert.equal(getInitialLetter('   '), '#')
  assert.deepEqual(groupFriendsByLetter([{ id: 'empty', nickname: '' }]), [{
    letter: '#',
    friends: [{
      id: 'empty',
      nickname: '',
      sortName: '',
      normalizedName: '',
      indexLetter: '#',
      sortKey: '',
    }],
  }])
  assert.deepEqual(groupFriendsByLetter([]), [])
})

test('排序键相同仍使用 uid 作为稳定的最终顺序', () => {
  const rows = [
    { id: 'later', uid: 20, displayName: 'Alice' },
    { id: 'first', uid: 10, displayName: 'alice' },
  ]
  assert.deepEqual(sortFriendsAlphabetically(rows).map((friend) => friend.id), ['first', 'later'])
})

test('搜索态隐藏索引，清空后恢复 A-Z，模式偏好使用 localStorage', () => {
  assert.match(friendDock, /const isSearchMode = query\.trim\(\)\.length > 0/)
  assert.match(friendDock, /!isSearchMode && friendListViewMode === 'alphabetical'/)
  assert.match(friendDock, /localStorage\.setItem\(FRIEND_LIST_VIEW_MODE_STORAGE_KEY, mode\)/)
  assert.match(friendDock, /FRIEND_LIST_VIEW_MODE_STORAGE_KEY = 'friendListViewMode'/)
  assert.match(friendDock, /onClick=\{\(\) => handleFriendSearchChange\('\'\)\}/)
})

test('索引只驱动好友列表内部滚动，并覆盖触控、键盘和安全区要求', () => {
  assert.match(friendDock, /list\.scrollTo\(\{[\s\S]*sectionRect\.top - listRect\.top[\s\S]*behavior: 'auto'/)
  assert.match(alphabetIndex, /<button/)
  assert.match(alphabetIndex, /aria-label=\{`跳转到 \$\{letter\}`\}/)
  assert.match(globalStyles, /\.friend-alphabet-index \{[^}]*position:absolute/)
  assert.match(globalStyles, /\.friend-alphabet-index \{[^}]*touch-action:none/)
  assert.match(globalStyles, /right:max\(2px,env\(safe-area-inset-right,0px\)\)/)
  assert.match(globalStyles, /\.friend-dock-list \{[^}]*overflow-x:hidden/)
})

test('目录请求一次返回完整好友人口，备注/存在状态/徽章继续批量读取', () => {
  assert.match(friendListRoute, /prisma\.friendship\.findMany\(/)
  assert.match(friendListRoute, /const directoryRows = directory \? orderedFriendRows : visibleRows/)
  assert.match(friendListRoute, /const \[unreadByConversation, remarkMap, presenceByFriend, equippedBadgesMap\] = await Promise\.all\(/)
  assert.match(friendListRoute, /friendTotal: total/)
  assert.match(friendListRoute, /hasMore: directory \? false : pageStart \+ pageSize < scopedTotal/)
})

test('FriendDock 使用全量通讯录读取并保留分组、搜索和内部滚动容器', () => {
  assert.match(friendListRoute, /const directory = params\.get\('directory'\) === '1'/)
  assert.match(friendListRoute, /directory\s*\?\s*orderedFriendRows/)
  assert.match(friendDock, /params\.set\('directory', '1'\)/)
  assert.match(friendDock, /friendListViewMode === 'alphabetical'/)
  assert.match(friendDock, /<FriendAlphabetIndex activeLetter=/)
  assert.match(alphabetIndex, /onPointerDown/)
  assert.match(alphabetIndex, /onPointerMove/)
  assert.match(alphabetIndex, /onPointerUp/)
  assert.match(alphabetIndex, /onPointerCancel/)
  assert.match(alphabetIndex, /setPointerCapture/)
  assert.match(friendDock, /behavior: 'auto'/)
  assert.match(friendDock, /friendListViewMode === 'groups'/)
  assert.match(friendDock, /isSearchMode \? visibleUsers\.map/)
  assert.match(friendDock, /<div ref=\{friendListRef\} className="friend-dock-list">/)
  assert.match(friendDock, /friendListScrollTopByModeRef/)
})
