import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
const appRoot = 'app'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

test('successful forum reply is the only app path that can update User.ipRegion', () => {
  const callSites = sourceFiles(appRoot).flatMap((path) => {
    const source = read(path)
    return /\bupdateUserIpRegion\s*\(/.test(source)
      ? [relative('.', path).split(sep).join('/')]
      : []
  })

  assert.deepEqual(callSites, ['app/api/posts/[postId]/replies/route.ts'])
})

test('profile read and profile edits are read-only for User.ipRegion', () => {
  const route = read('app/api/users/me/route.ts')
  const getRoute = route.slice(0, route.indexOf('export async function PATCH'))
  const patchRoute = route.slice(route.indexOf('export async function PATCH'))
  const profilePage = read('app/profile/page.tsx')

  assert.match(getRoute, /publicProfileIpRegion\(profile\.ipRegion\)/)
  assert.doesNotMatch(getRoute + patchRoute + profilePage, /updateUserIpRegion|resolveIpLocation/)
  assert.match(profilePage, /publicProfileIpRegion\(profile\.ipRegion\)/)
})

test('login, check-in and non-forum comment flows do not update User.ipRegion', () => {
  const paths = [
    'app/api/auth/login/route.ts',
    'app/api/checkin/route.ts',
    'app/api/daily-messages/[messageId]/comments/route.ts',
    'app/api/profile-wall/route.ts',
    'app/api/admin/registration-messages/route.ts',
    'app/api/posts/route.ts',
  ]

  for (const path of paths) {
    assert.doesNotMatch(read(path), /updateUserIpRegion\s*\(/, path)
  }
})

test('forum reply attributes IP only after a committed, non-duplicate reply and never blocks it', () => {
  const route = read('app/api/posts/[postId]/replies/route.ts')
  const postStart = route.indexOf('export async function POST')
  const created = route.indexOf('const createdReply = await tx.reply.create')
  const duplicateCheck = route.indexOf('const duplicateReply = await tx.reply.findFirst')
  const unavailableGuard = route.indexOf("if ('unavailable' in reply)")
  const duplicateGuard = route.indexOf("if ('duplicateReplyId' in reply)")
  const attribution = route.indexOf('const ipLocation = await resolveIpLocation(request).catch(() => null)')

  assert.ok(unavailableGuard >= 0)
  assert.ok(duplicateGuard > unavailableGuard)
  assert.ok(duplicateCheck > postStart)
  assert.ok(created > duplicateCheck)
  assert.ok(duplicateGuard > created)
  assert.ok(attribution > duplicateGuard)
  assert.ok(attribution > created)
  assert.match(route.slice(attribution), /const ipRegion = ipLocation \? await updateUserIpRegion\(user\.id, ipLocation\) : null/)
  assert.match(route.slice(attribution), /if \(ipRegion\)[\s\S]*\.catch\(\(\) => undefined\)/)
  assert.doesNotMatch(route.slice(postStart, attribution), /resolveIpLocation\(request\)|updateUserIpRegion/)
})
