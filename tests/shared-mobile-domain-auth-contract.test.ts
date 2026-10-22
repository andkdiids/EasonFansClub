import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('SHARED_AUTH_CONTRACT_TEST: Profile, Account Security, and Topic Activity use one Bearer/Cookie resolver', () => {
  const sharedSecurity = source('lib/security.ts')
  const mobileAuth = source('lib/mobile-auth.ts')
  const middleware = source('middleware.ts')

  for (const path of [
    'app/api/profile/view-history/route.ts',
    'app/api/users/[userId]/relationship/route.ts',
    'app/api/users/[userId]/followers/route.ts',
    'app/api/users/[userId]/following/route.ts',
    'app/api/account/security/route.ts',
    'app/api/account/security/questions/route.ts',
    'app/api/account/security/password/change/route.ts',
    'app/api/activities/[activityId]/v2/tasks/route.ts',
    'app/api/activities/[activityId]/v2/poll/route.ts',
    'app/api/activities/[activityId]/v2/test/route.ts',
    'app/api/activities/me/topic-participations/route.ts',
  ]) {
    assert.match(source(path), /requireRequestUser\(request\)/, `${path} must use the shared protected-route guard`)
  }

  for (const path of [
    'app/api/users/[userId]/public-modules/route.ts',
    'app/api/activities/[activityId]/v2/route.ts',
  ]) {
    assert.match(source(path), /resolveRequestAuth\(request\)/, `${path} must preserve optional public/Cookie/Bearer identity resolution`)
  }

  assert.match(sharedSecurity, /if \(request\.headers\.has\('authorization'\)\)/)
  assert.match(sharedSecurity, /const token = getBearerToken\(request\.headers\.get\('authorization'\)\)/)
  assert.match(sharedSecurity, /if \(!token\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(sharedSecurity, /if \(!mobileAccess\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(sharedSecurity, /getCurrentUserById\(mobileAccess\.claims\.userId\)/)
  assert.match(mobileAuth, /setExpirationTime\(issuedAt \+ MOBILE_ACCESS_TOKEN_TTL_SECONDS\)/)
  assert.match(mobileAuth, /revokedAt: null[\s\S]*expiresAt: \{ gt: new Date\(\) \}/)
  assert.match(middleware, /if \(isMobileBearerBusinessRequest\(request, pathname\)\) \{/)
  assert.match(middleware, /!isMobileAuthPath && isCrossSiteRequest\(request\)/)
  assert.doesNotMatch(middleware, /Access-Control-Allow-Origin\s*:\s*\*|allow-origin.*\*/i)
})

test('blocked profile relationships do not expose follower or following lists', () => {
  const connections = source('lib/profile-connections.ts')
  assert.match(connections, /if \(viewerId !== userId\)[\s\S]*?prisma\.block\.findFirst/)
  assert.match(connections, /if \(block\) return paginatedUsers\(\[\], 0, page, pageSize\)/)
  assert.match(source('app/api/users/[userId]/followers/route.ts'), /getProfileConnectionPage\(target\.id, guard\.user\.id, 'followers'/)
  assert.match(source('app/api/users/[userId]/following/route.ts'), /getProfileConnectionPage\(target\.id, guard\.user\.id, 'following'/)
})
