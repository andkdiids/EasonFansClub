import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync('app/api/friends/list/route.ts', 'utf8').replace(/\r\n/g, '\n')

test('authenticated profile lookup selects and sanitizes only the public custom background field', () => {
  assert.match(route, /const guard = await requireRequestUser\(request\)/)
  assert.match(route, /const publicProfileLookupSelect = \{[\s\S]*?Profile: \{ select: \{[^}]*backgroundUrl: true[^}]*\} \}/)
  assert.match(route, /nicknameUsers,[\s\S]*?select: publicProfileLookupSelect/)
  assert.match(route, /remarkOnlyUsers[\s\S]*?select: publicProfileLookupSelect/)
  assert.match(route, /backgroundUrl: publicImageUrl\(friend\.Profile\.backgroundUrl\)/)
  assert.match(route, /relationshipStatus =([\s\S]*?)blockedIds\.has\(item\.id\) \? 'BLOCKED'/)
  assert.match(route, /profile: friend\.Profile \? \{[\s\S]*?backgroundUrl !== undefined/)
  assert.doesNotMatch(route, /backgroundImageSecret|privateBackground|backgroundAccessToken/)
})

test('the normal friend list query remains on its narrower pre-existing DTO', () => {
  const friendListCalls = [...route.matchAll(/select: publicFriendSelect/g)]
  assert.equal(friendListCalls.length, 2)
  assert.match(route, /const publicFriendSelect = \{[\s\S]*?Profile: \{ select: \{[^}]+bioModerationStatus: true \} \}/)
})
