import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calculateFriendListRestoredScrollTop,
  createFriendListReturnState,
  FRIEND_LIST_RETURN_STATE_KEY,
  FRIEND_LIST_RETURN_STATE_TTL_MS,
  parseFriendListReturnState,
} from '../lib/friend-list-return-state'

const read = (path: string) => readFileSync(path, 'utf8')
const friendDock = read('components/FriendDock.tsx')

test('return state records the friend anchor, inner list scroll and viewport context', () => {
  const state = createFriendListReturnState({ friendId: 'friend-a', scrollTop: 1824, scrollY: 320, viewportOffset: 96, query: 'A' })
  assert.deepEqual(state, {
    friendId: 'friend-a', scrollTop: 1824, scrollY: 320, viewportOffset: 96, query: 'A', createdAt: state.createdAt,
  })
  assert.equal(FRIEND_LIST_RETURN_STATE_KEY, 'friends:list:return-state')
  assert.match(friendDock, /sessionStorage\.setItem\(FRIEND_LIST_RETURN_STATE_KEY/)
  assert.match(friendDock, /saveFriendListReturnState\(friend\.id\)/)
})

test('opening chat saves the anchor before asynchronous conversation loading', () => {
  assert.match(friendDock, /const chatSession = \+\+chatSessionRef\.current\n    if \(activeTab === 'contacts'\) saveFriendListReturnState\(friend\.id\)/)
  assert.match(friendDock, /setChatFriend\(friend\)[\r\n]+    if \(activeTab === 'contacts'\) friendListRestorePendingRef\.current = true/)
})

test('an existing target is restored by its current position after sorting changes', () => {
  const next = calculateFriendListRestoredScrollTop({
    currentScrollTop: 0,
    fallbackScrollTop: 1824,
    maxScrollTop: 5000,
    containerTop: 100,
    friendTop: 980,
    savedViewportOffset: 220,
  })
  assert.equal(next, 660)
  assert.match(friendDock, /data-friend-id=\{friend\.id\}/)
  assert.match(friendDock, /querySelectorAll<HTMLElement>\('\[data-friend-id\]'\)/)
})

test('missing targets fall back to the saved list scroll without throwing', () => {
  assert.equal(calculateFriendListRestoredScrollTop({
    currentScrollTop: 0, fallbackScrollTop: 1824, maxScrollTop: 1200, containerTop: 0, friendTop: null, savedViewportOffset: 96,
  }), 1200)
  assert.match(friendDock, /fallbackScrollTop: state\?\.scrollTop \|\| 0/)
})

test('return state expires and malformed storage is ignored', () => {
  const now = 10_000
  const valid = createFriendListReturnState({ friendId: 'friend-a', scrollTop: 1, scrollY: 2, createdAt: now - FRIEND_LIST_RETURN_STATE_TTL_MS })
  assert.ok(parseFriendListReturnState(JSON.stringify(valid), now))
  assert.equal(parseFriendListReturnState(JSON.stringify({ ...valid, createdAt: now - FRIEND_LIST_RETURN_STATE_TTL_MS - 1 }), now), null)
  assert.equal(parseFriendListReturnState('{broken', now), null)
})

test('successful restoration consumes session state, while ordinary close clears it', () => {
  assert.match(friendDock, /clearFriendListReturnState\(\)/)
  assert.match(friendDock, /if \(!row && attempts < 4\)/)
  assert.match(friendDock, /friendListRestorePendingRef\.current = false/)
  assert.match(friendDock, /window\.sessionStorage\.removeItem\(FRIEND_LIST_RETURN_STATE_KEY\)/)
})

test('the list waits for normal and grouped data before restoring', () => {
  assert.match(friendDock, /if \(!open \|\| chatFriend \|\| activeTab !== 'contacts'\) return/)
  assert.match(friendDock, /const listDataReady = debouncedQuery/)
  assert.match(friendDock, /groupScopes\.every\(/)
  assert.match(friendDock, /collapsedGroupIds\.has\(scope\.id\) \|\| scope\.count === 0 \|\| groupFriends\[scope\.id\] !== undefined/)
  assert.match(friendDock, /void refreshLoadedFriendGroups\(\)\n    resetChat\(\)/)
  assert.match(friendDock, /const pageAfterLoadedRange = pagination\?\.hasMore \? lastLoadedPage \+ 1 : lastLoadedPage/)
})

test('search state is part of the return record and is not silently replaced', () => {
  assert.match(friendDock, /query: debouncedQuery/)
  assert.match(friendDock, /if \(state\.query !== debouncedQuery\) \{\n      clearFriendListReturnState\(\)/)
  const resetChat = friendDock.slice(friendDock.indexOf('const resetChat'), friendDock.indexOf('const closeDock'))
  assert.doesNotMatch(resetChat, /setQuery/)
})

test('each new friend click overwrites the previous anchor instead of reusing an old one', () => {
  const first = createFriendListReturnState({ friendId: 'friend-a', scrollTop: 100, scrollY: 0 })
  const second = createFriendListReturnState({ friendId: 'friend-b', scrollTop: 800, scrollY: 0 })
  assert.notEqual(first.friendId, second.friendId)
  assert.equal(second.scrollTop, 800)
  assert.match(friendDock, /saveFriendListReturnState\(friend\.id\)/)
})

test('mobile and desktop use the same internally scrollable list ref', () => {
  assert.match(friendDock, /const friendListRef = useRef<HTMLDivElement>\(null\)/)
  assert.match(friendDock, /<div ref=\{friendListRef\} className="friend-dock-list">/)
  assert.match(read('app/globals.css'), /\.friend-dock-list \{[^}]*overflow-x:hidden;[^}]*overflow-y:auto/)
})
