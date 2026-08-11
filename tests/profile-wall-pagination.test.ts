import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('profile wall paginates only visible root messages on the server', () => {
  const route = read('app/api/profile-wall/route.ts')

  assert.match(route, /const PROFILE_WALL_PAGE_SIZE = 10/)
  assert.match(route, /const rootWhere = \{ receiverId: receiver\.id, parentId: null, deletedAt: null \}/)
  assert.match(route, /prisma\.profileWallMessage\.count\(\{ where: rootWhere \}\)/)
  assert.match(route, /skip: \(page - 1\) \* PROFILE_WALL_PAGE_SIZE/)
  assert.match(route, /take: PROFILE_WALL_PAGE_SIZE/)
  assert.match(route, /parentId: \{ in: parentIds \}/)
  assert.match(route, /pagination: \{/)
  assert.doesNotMatch(route, /take: 300/)
})

test('profile wall uses wallPage URL state and local pagination controls', () => {
  const client = read('components/ProfileWall.tsx')

  assert.match(client, /useSearchParams/)
  assert.match(client, /searchParams\.get\('wallPage'\)/)
  assert.match(client, /new URLSearchParams\(searchParams\.toString\(\)\)/)
  assert.match(client, /<Pagination/)
  assert.match(client, /onPageChange=\{\(nextPage\) => replaceWallPage\(nextPage, true\)\}/)
  assert.match(client, /if \(parentId \|\| wallPage === 1\) await load\(\)/)
  assert.match(client, /else replaceWallPage\(1\)/)
})
