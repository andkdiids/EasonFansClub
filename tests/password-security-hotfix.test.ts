import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import { verifySecurityAnswers } from '../lib/account-security'
import {
  consumeRateLimitFailClosed,
  RateLimitUnavailableError,
  type AtomicRateLimitUpsertInput,
} from '../lib/fail-closed-rate-limit'
import {
  commitPasswordChange,
  consumeResetTokenAndChangePassword,
  PasswordChangeConflictError,
} from '../lib/password-security-transaction'
import { hashPassword, verifyPassword } from '../lib/password'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function transactionFixture(options: { passwordUpdateCount?: number; resetAvailable?: boolean } = {}) {
  const calls: Array<{ operation: string; input?: unknown }> = []
  let resetAvailable = options.resetAvailable ?? true
  const tx = {
    user: {
      updateMany: async (input: unknown) => {
        calls.push({ operation: 'user.updateMany', input })
        return { count: options.passwordUpdateCount ?? 1 }
      },
    },
    passwordResetToken: {
      updateMany: async (input: unknown) => {
        calls.push({ operation: 'passwordResetToken.updateMany', input })
        const where = (input as { where?: { id?: string } }).where
        if (where?.id) {
          if (!resetAvailable) return { count: 0 }
          resetAvailable = false
          return { count: 1 }
        }
        return { count: 1 }
      },
    },
    onlineSession: {
      deleteMany: async (input: unknown) => { calls.push({ operation: 'onlineSession.deleteMany', input }); return { count: 2 } },
    },
    mobileAuthSession: {
      updateMany: async (input: unknown) => { calls.push({ operation: 'mobileAuthSession.updateMany', input }); return { count: 3 } },
    },
    accountSecurityLog: {
      create: async (input: unknown) => {
        calls.push({ operation: 'accountSecurityLog.create', input })
        return {}
      },
    },
  }
  return { tx: tx as never, calls }
}

test('敏感限流固定窗口内原子计数并在超过上限后拒绝', async () => {
  const buckets = new Map<string, { count: number; expiresAt: Date }>()
  const store = {
    async upsert(input: AtomicRateLimitUpsertInput) {
      const current = buckets.get(input.where.id)
      const next = current
        ? { ...current, count: current.count + 1 }
        : { count: 1, expiresAt: input.create.expiresAt }
      buckets.set(input.where.id, next)
      return next
    },
  }
  const start = new Date('2026-10-20T00:00:01.000Z')
  const results = await Promise.all(Array.from({ length: 8 }, () => consumeRateLimitFailClosed(store, 'opaque-account-key', 'password-test', 5, 60, start)))
  assert.equal(results.filter((item) => !item.limited).length, 5)
  assert.equal(results.filter((item) => item.limited).length, 3)
  assert.equal(buckets.size, 1)
})

test('敏感限流存储异常 fail-closed 且不传播底层异常或凭据', async () => {
  const store = { upsert: async () => { throw new Error('mysql://user:password@private/db') } }
  await assert.rejects(
    consumeRateLimitFailClosed(store, 'key', 'password-test', 5, 60),
    (error: unknown) => {
      assert.ok(error instanceof RateLimitUnavailableError)
      assert.equal(error.message, 'Password security rate limiting is unavailable')
      assert.equal(error.cause, undefined)
      assert.doesNotMatch(error.message, /mysql:\/\/|private|user:password/i)
      return true
    },
  )
})

test('统一密码事务更新哈希、消费恢复凭证、撤销 Web 与 Mobile 会话并记录非敏感审计', async () => {
  const { tx, calls } = transactionFixture()
  await commitPasswordChange(tx, {
    userId: 'user-a',
    expectedPasswordHash: 'old-hash',
    passwordHash: 'new-hash',
    action: 'PASSWORD_CHANGED_WITH_CURRENT_PASSWORD',
    method: 'CURRENT_PASSWORD',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    now: new Date('2026-10-20T00:00:00.000Z'),
  })
  assert.deepEqual(calls.map((call) => call.operation), [
    'user.updateMany',
    'passwordResetToken.updateMany',
    'onlineSession.deleteMany',
    'mobileAuthSession.updateMany',
    'accountSecurityLog.create',
  ])
  assert.deepEqual((calls[0].input as { where: unknown }).where, { id: 'user-a', passwordHash: 'old-hash' })
  assert.deepEqual((calls[3].input as { where: unknown }).where, { userId: 'user-a', revokedAt: null })
  const audit = calls[4].input as { data: { metadata: unknown } }
  assert.deepEqual(audit.data.metadata, { method: 'CURRENT_PASSWORD' })
  assert.doesNotMatch(JSON.stringify(audit), /old-hash|new-hash|passwordHash/i)
})

test('密码重置审计写入前将超长 User-Agent 限制到 VARCHAR(191)', async () => {
  const { tx, calls } = transactionFixture()
  const userAgent = 'A'.repeat(500)

  await commitPasswordChange(tx, {
    userId: 'user-a', passwordHash: 'new-hash', action: 'PASSWORD_RESET_SUCCEEDED',
    method: 'SECURITY_QUESTION', ipAddress: '127.0.0.1', userAgent,
  })

  const audit = calls.at(-1)?.input as { data: { userAgent: string | null } }
  assert.equal(audit.data.userAgent, userAgent.slice(0, 191))
  assert.equal(audit.data.userAgent?.length, 191)
  assert.deepEqual(calls.map((call) => call.operation), [
    'user.updateMany',
    'passwordResetToken.updateMany',
    'onlineSession.deleteMany',
    'mobileAuthSession.updateMany',
    'accountSecurityLog.create',
  ])
})

test('审计写入失败保持事务异常并回滚密码、凭证和全部会话状态', async () => {
  const original = {
    passwordHash: 'old-hash',
    resetConsumed: false,
    onlineSessionCount: 2,
    mobileSessionRevoked: false,
  }
  let committedState = { ...original }
  const calls: string[] = []
  const auditFailure = new Error('synthetic audit write failure')

  const makeTx = (pending: typeof original) => ({
    user: {
      updateMany: async () => {
        calls.push('user.updateMany')
        pending.passwordHash = 'new-hash'
        return { count: 1 }
      },
    },
    passwordResetToken: {
      updateMany: async (input: { where?: { id?: string } }) => {
        calls.push(input.where?.id ? 'passwordResetToken.claim' : 'passwordResetToken.consumeOutstanding')
        pending.resetConsumed = true
        return { count: 1 }
      },
    },
    onlineSession: {
      deleteMany: async () => {
        calls.push('onlineSession.deleteMany')
        pending.onlineSessionCount = 0
        return { count: 2 }
      },
    },
    mobileAuthSession: {
      updateMany: async () => {
        calls.push('mobileAuthSession.updateMany')
        pending.mobileSessionRevoked = true
        return { count: 3 }
      },
    },
    accountSecurityLog: {
      create: async () => {
        calls.push('accountSecurityLog.create')
        throw auditFailure
      },
    },
  })
  const mockTransaction = async <T>(action: (tx: never) => Promise<T>) => {
    const pending = { ...committedState }
    const result = await action(makeTx(pending) as never)
    committedState = pending
    return result
  }

  await assert.rejects(mockTransaction((tx) => consumeResetTokenAndChangePassword(tx, {
    resetTokenId: 'token-a', resetTokenType: 'SECURITY_QUESTION', userId: 'user-a',
    expectedPasswordHash: 'old-hash', passwordHash: 'new-hash', action: 'PASSWORD_RESET_SUCCEEDED',
    method: 'SECURITY_QUESTION', ipAddress: '127.0.0.1', userAgent: 'A'.repeat(500),
  })), auditFailure)
  assert.deepEqual(calls, [
    'passwordResetToken.claim',
    'user.updateMany',
    'passwordResetToken.consumeOutstanding',
    'onlineSession.deleteMany',
    'mobileAuthSession.updateMany',
    'accountSecurityLog.create',
  ])
  assert.deepEqual(committedState, original)
})

test('旧密码并发变更的 CAS 冲突会中止且不撤销会话或写审计', async () => {
  const { tx, calls } = transactionFixture({ passwordUpdateCount: 0 })
  await assert.rejects(commitPasswordChange(tx, {
    userId: 'user-a', passwordHash: 'new-hash', expectedPasswordHash: 'stale-hash',
    action: 'PASSWORD_CHANGED_WITH_CURRENT_PASSWORD', method: 'CURRENT_PASSWORD', ipAddress: '127.0.0.1', userAgent: null,
  }), PasswordChangeConflictError)
  assert.deepEqual(calls.map((call) => call.operation), ['user.updateMany'])
})

test('reset authorization 绑定用户、类型、阶段、有效期且只能消费一次', async () => {
  const { tx, calls } = transactionFixture()
  const input = {
    resetTokenId: 'token-a', resetTokenType: 'SECURITY_QUESTION' as const, userId: 'user-a',
    expectedPasswordHash: 'old-hash', passwordHash: 'new-hash', action: 'PASSWORD_RESET_SUCCEEDED', method: 'SECURITY_QUESTION',
    ipAddress: '127.0.0.1', userAgent: null, now: new Date('2026-10-20T00:00:00.000Z'),
  }
  assert.equal(await consumeResetTokenAndChangePassword(tx, input), true)
  const claim = calls[0].input as { where: Record<string, unknown> }
  assert.deepEqual(claim.where, {
    id: 'token-a', userId: 'user-a', type: 'SECURITY_QUESTION', stage: 'RESET_TOKEN',
    consumedAt: null, expiresAt: { gt: input.now },
  })
  const replay = transactionFixture({ resetAvailable: false })
  assert.equal(await consumeResetTokenAndChangePassword(replay.tx, input), false)
  assert.deepEqual(replay.calls.map((call) => call.operation), ['passwordResetToken.updateMany'])
})

test('两个不同的合法 reset token 并发修改同一账户时旧哈希 CAS 只允许一个成功', async () => {
  let currentHash = 'old-hash'
  const claimed = new Set<string>()
  const tx = {
    user: {
      updateMany: async (input: { where: { id: string; passwordHash?: string }; data: { passwordHash: string } }) => {
        if (input.where.passwordHash !== currentHash) return { count: 0 }
        currentHash = input.data.passwordHash
        return { count: 1 }
      },
    },
    passwordResetToken: {
      updateMany: async (input: { where: { id?: string } }) => {
        if (!input.where.id) return { count: 1 }
        if (claimed.has(input.where.id)) return { count: 0 }
        claimed.add(input.where.id)
        return { count: 1 }
      },
    },
    onlineSession: { deleteMany: async () => ({ count: 1 }) },
    mobileAuthSession: { updateMany: async () => ({ count: 1 }) },
    accountSecurityLog: { create: async () => ({}) },
  }
  const base = {
    resetTokenType: 'SECURITY_QUESTION' as const, userId: 'user-a', expectedPasswordHash: 'old-hash',
    action: 'PASSWORD_RESET_SUCCEEDED', method: 'SECURITY_QUESTION', ipAddress: '127.0.0.1', userAgent: null,
  }
  const results = await Promise.allSettled([
    consumeResetTokenAndChangePassword(tx as never, { ...base, resetTokenId: 'token-a', passwordHash: 'hash-a' }),
    consumeResetTokenAndChangePassword(tx as never, { ...base, resetTokenId: 'token-b', passwordHash: 'hash-b' }),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled' && result.value).length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected && rejected.status === 'rejected' && rejected.reason instanceof PasswordChangeConflictError)
  assert.ok(currentHash === 'hash-a' || currentHash === 'hash-b')
})

test('历史 bcrypt 密保哈希与当前 PBKDF2 哈希都通过既有验证器校验', async () => {
  const legacyBcryptHash = await bcrypt.hash('hong kong', 4)
  assert.equal(await verifySecurityAnswers([{ sortOrder: 1, answerHash: legacyBcryptHash }], [{ answer: '  HONG   KONG ' }]), true)
  const currentHash = (await import('../lib/account-security')).hashSecurityQuestions
  const questions = await currentHash([{ question: '城市', answer: '香港', sortOrder: 1 }])
  assert.equal(await verifySecurityAnswers(questions, [{ answer: ' 香港 ' }]), true)
  assert.equal(await verifySecurityAnswers(questions, [{ answer: '错误' }]), false)
})

test('当前密码/新密码哈希兼容现有登录验证器，旧密码在变更后拒绝', async () => {
  const existingHash = await hashPassword('existing-passphrase')
  assert.equal((await verifyPassword('existing-passphrase', existingHash)).valid, true)
  assert.equal((await verifyPassword('not-the-password', existingHash)).valid, false)

  const replacementHash = await bcrypt.hash('replacement-passphrase', 4)
  assert.equal((await verifyPassword('replacement-passphrase', replacementHash)).valid, true)
  assert.equal((await verifyPassword('existing-passphrase', replacementHash)).valid, false)
})

test('找回流程不回显密保题目或答案并限制 challenge 尝试次数', () => {
  const questions = source('app/api/auth/forgot-password/security/questions/route.ts')
  const verify = source('app/api/auth/forgot-password/security/verify/route.ts')
  assert.match(questions, /genericQuestion/)
  assert.match(questions, /UserSecurityQuestion: \{ select: \{ question: true \} \}/)
  assert.doesNotMatch(questions, /answerHash/)
  assert.match(questions, /buildSecurityQuestionChallengeResponse/)
  assert.match(verify, /attemptCount >= 5/)
  assert.match(verify, /attemptCount: \{ equals: record\.attemptCount, lt: 5 \}/)
  assert.match(verify, /data: \{\s*attemptCount: \{ increment: 1 \}/)
  assert.doesNotMatch(verify, /NextResponse\.json\(record|NextResponse\.json\(.*answerHash/)
})

test('原密码入口拒绝未登录、忽略 body 用户 ID 并兼容旧字段名', () => {
  const route = source('app/api/account/security/password/change/route.ts')
  const legacy = source('app/api/auth/change-password/route.ts')
  assert.match(route, /const guard = await requireRequestUser\(request\)[\s\S]*guard\.user/)
  assert.match(route, /body\?\.currentPassword[\s\S]*body\?\.oldPassword/)
  assert.match(route, /body\?\.password[\s\S]*body\?\.newPassword/)
  assert.doesNotMatch(route, /body\?\.userId|body\?\.targetUserId/)
  assert.match(legacy, /export \{ POST \}/)
})

test('账户内密保重置保留哈希兼容验证并对失败答案 fail-closed 限流', () => {
  const route = source('app/api/account/security/password/security-question-reset/route.ts')
  assert.match(route, /verifySecurityAnswers\(/)
  assert.match(route, /consumeRateLimitFailClosed\(accountKey, wrongAnswerAction, 5/)
  assert.match(route, /expectedPasswordHash: user\.passwordHash/)
  assert.match(route, /PASSWORD_RESET_WITH_SECURITY_QUESTION/)
  assert.match(route, /commitPasswordChange/)
})

test('四个邮箱密码 API 明确关闭且密码页面不再暴露邮箱入口', () => {
  for (const path of [
    'app/api/auth/password/request/route.ts',
    'app/api/auth/password/reset/route.ts',
    'app/api/auth/forgot-password/email/send/route.ts',
    'app/api/auth/forgot-password/email/verify/route.ts',
  ]) {
    const route = source(path)
    assert.match(route, /EMAIL_PASSWORD_RECOVERY_DISABLED/)
    assert.match(route, /status: 410/)
    assert.doesNotMatch(route, /prisma\.|TENCENT|sendPasswordReset/)
  }
  assert.doesNotMatch(source('app/forgot-password/page.tsx'), /EmailPasswordLinkForm/)
  assert.doesNotMatch(source('components/PasswordManagement.tsx'), /邮箱验证码重置/)
  assert.match(source('app/settings/security/page.tsx'), /label: '邮箱验证'/)
  assert.match(source('app/api/auth/register/send-email-code/route.ts'), /sendRegistrationVerificationCode/)
})

test('所有密码变更入口统一撤销 Mobile refresh 会话并触发 Web JWT 失效审计', () => {
  const helper = source('lib/password-security-transaction.ts')
  const auth = source('lib/auth.ts')
  assert.match(helper, /mobileAuthSession\.updateMany/)
  assert.match(helper, /onlineSession\.deleteMany/)
  assert.match(helper, /accountSecurityLog\.create/)
  assert.match(auth, /PASSWORD_RESET_BY_ADMIN/)
  for (const path of [
    'app/api/auth/forgot-password/reset/route.ts',
    'app/api/account/security/password/change/route.ts',
    'app/api/account/security/password/security-question-reset/route.ts',
    'app/api/admin/users/[userId]/password/route.ts',
  ]) {
    const route = source(path)
    assert.match(route, /commitPasswordChange|consumeResetTokenAndChangePassword/)
  }
})

test('密码找回路由仍在同一 Prisma 事务中消费凭证并传播审计写入失败', () => {
  const route = source('app/api/auth/forgot-password/reset/route.ts')
  const transaction = source('lib/password-security-transaction.ts')

  assert.match(route, /prisma\.\$transaction\(\(tx\) => consumeResetTokenAndChangePassword/)
  assert.match(route, /logPasswordRecoveryError\('\/api\/auth\/forgot-password\/reset', error, \{ stage: 'commit' \}\)/)
  assert.match(transaction, /await tx\.accountSecurityLog\.create/)
  assert.doesNotMatch(transaction, /accountSecurityLog\.create[\s\S]{0,120}catch/)
  assert.match(transaction, /userAgent: normalizeStoredUserAgent\(input\.userAgent\)/)
})

test('所有直接写入 AccountSecurityLog 的 User-Agent 入口共用字段长度归一化', () => {
  for (const path of [
    'app/api/auth/login/route.ts',
    'lib/auth-credentials.ts',
    'lib/security.ts',
  ]) {
    const writer = source(path)
    assert.match(writer, /normalizeStoredUserAgent\(/, `${path} must normalize stored user-agent metadata`)
    assert.doesNotMatch(writer, /userAgent: request\.headers\.get\('user-agent'\)\?\.slice\(0,\s*(255|500)\)/)
  }
})
