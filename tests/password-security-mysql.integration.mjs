import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export const PASSWORD_SECURITY_MYSQL_ACCEPTANCE_CASES = Object.freeze([
  'current-password-change-and-login-verification',
  'persisted-pbkdf2-and-legacy-bcrypt-security-answers',
  'recovery-expiry-user-binding-consumption-replay-and-answer-rejection',
  'same-recovery-authorization-concurrency-single-winner',
  'concurrent-recovery-cas-and-token-rollback',
  'failed-transaction-fully-rolls-back',
  'admin-reset-shares-password-session-and-audit-transaction',
  'audit-redaction-and-synthetic-user-ledger-isolation',
])

function caseFailure(caseId) {
  const error = new Error(`MYSQL_ACCEPTANCE_CASE_FAILED:${caseId}`)
  error.code = `MYSQL_ACCEPTANCE_CASE_${caseId.replaceAll('-', '_').toUpperCase()}`
  return error
}

async function runCase(caseId, passedCases, action) {
  try {
    await action()
    passedCases.push(caseId)
  } catch {
    // Prisma exceptions and assertion diffs may contain connection or fixture
    // details. Keep the surfaced failure to this fixed, non-sensitive case id.
    throw caseFailure(caseId)
  }
}

export async function runPasswordSecurityMysqlAcceptance(client) {
  if (!client || typeof client.$transaction !== 'function' || !client.user) {
    const error = new Error('MYSQL_ACCEPTANCE_CLIENT_REQUIRED')
    error.code = 'MYSQL_ACCEPTANCE_CLIENT_REQUIRED'
    throw error
  }

  try {
  // These imports happen only when the strict runner has validated the QA
  // gates, connected to the pinned target, and confirmed DATABASE() / VERSION().
  const [passwordModule, bcryptModule, transactionModule, tokenModule, securityModule, authModule] = await Promise.all([
    import('../lib/password.ts'),
    import('bcryptjs'),
    import('../lib/password-security-transaction.ts'),
    import('../lib/tokens.ts'),
    import('../lib/account-security.ts'),
    import('../lib/auth.ts'),
  ])
  const { hashPassword, verifyPassword } = passwordModule
  const bcrypt = bcryptModule.default
  const { commitPasswordChange, consumeResetTokenAndChangePassword, PasswordChangeConflictError } = transactionModule
  const { hashToken } = tokenModule
  const { verifySecurityAnswers } = securityModule
  const { createSessionToken, getCurrentUserFromSessionToken } = authModule

  const runId = randomUUID().replaceAll('-', '')
  const users = []
  const passedCases = []
  const now = () => new Date()
  const future = (minutes = 30) => new Date(Date.now() + minutes * 60_000)
  const makePassword = (label) => `qa-password-${runId}-${label}-not-for-reuse`
  const makeAnswer = (label) => `qa-answer-${runId}-${label}`

  async function createUser(label, password, role = 'USER') {
    const key = `${runId}-${label}`
    const row = await client.user.create({
      data: {
        id: `qa-password-${key}`,
        username: `qa-${key}`,
        usernameNormalized: `qa-${key}`,
        nickname: `Synthetic QA ${label}`,
        passwordHash: await hashPassword(password),
        role,
        securityQuestionRecoveryEnabled: true,
      },
      select: { id: true, uid: true, username: true, nickname: true, passwordHash: true, points: true },
    })
    users.push(row)
    return row
  }

  async function createResetToken(userId, label, expiresAt = future()) {
    const id = `qa-reset-${runId}-${label}`
    await client.passwordResetToken.create({
      data: {
        id,
        tokenHash: hashToken(`synthetic-token-${runId}-${label}`),
        userId,
        type: 'SECURITY_QUESTION',
        stage: 'RESET_TOKEN',
        expiresAt,
      },
    })
    return id
  }

  function resetInput({ tokenId, user, newPassword, action = 'PASSWORD_RESET_SUCCEEDED', now: fixedNow = now() }) {
    return {
      resetTokenId: tokenId,
      resetTokenType: 'SECURITY_QUESTION',
      userId: user.id,
      expectedPasswordHash: user.passwordHash,
      passwordHash: newPassword,
      action,
      method: 'SECURITY_QUESTION',
      ipAddress: '198.51.100.24',
      userAgent: 'synthetic-password-qa-agent',
      now: fixedNow,
    }
  }

  async function createSessions(user) {
    const onlineId = `qa-online-${runId}-${user.id.slice(-8)}`
    const mobileId = `qa-mobile-${runId}-${user.id.slice(-8)}`
    await client.onlineSession.create({
      data: { id: onlineId, userId: user.id, expiresAt: future(24 * 60) },
    })
    await client.mobileAuthSession.create({
      data: {
        id: mobileId,
        userId: user.id,
        refreshTokenHash: hashToken(`synthetic-refresh-${runId}-${user.id}`),
        expiresAt: future(24 * 60),
      },
    })
    return { onlineId, mobileId }
  }

  async function runPasswordTransaction(input) {
    return client.$transaction((tx) => commitPasswordChange(tx, input), { timeout: 15_000, maxWait: 5_000 })
  }

  const currentUser = await createUser('current-change', makePassword('current-old'))
  const currentOldPassword = makePassword('current-old')
  const currentNewPassword = makePassword('current-new')
  const currentNewHash = await bcrypt.hash(currentNewPassword, 4)
  const unusedRejectedHash = await bcrypt.hash(makePassword('unused-rejected'), 4)
  const currentSessions = await createSessions(currentUser)
  const webSession = await createSessionToken({
    id: currentUser.id,
    uid: currentUser.uid,
    username: currentUser.username,
    nickname: currentUser.nickname,
    role: 'USER',
  })
  const issueDelay = () => new Promise((resolve) => setTimeout(resolve, 10))

  await runCase('current-password-change-and-login-verification', passedCases, async () => {
    const before = await client.user.findUnique({ where: { id: currentUser.id }, select: { passwordHash: true } })
    assert.ok(before)
    assert.equal((await verifyPassword(currentOldPassword, before.passwordHash)).valid, true)
    assert.equal((await verifyPassword(makePassword('wrong-current'), before.passwordHash)).valid, false)
    assert.equal((await client.user.findUnique({ where: { id: currentUser.id }, select: { passwordHash: true } })).passwordHash, before.passwordHash)
    assert.equal(await client.onlineSession.count({ where: { userId: currentUser.id } }), 1)
    assert.equal(await client.accountSecurityLog.count({ where: { userId: currentUser.id } }), 0)

    await issueDelay()
    const changedAt = new Date(Date.now() + 1_000)
    await runPasswordTransaction({
      userId: currentUser.id,
      expectedPasswordHash: before.passwordHash,
      passwordHash: currentNewHash,
      action: 'PASSWORD_CHANGED_WITH_CURRENT_PASSWORD',
      method: 'CURRENT_PASSWORD',
      ipAddress: '198.51.100.24',
      userAgent: 'synthetic-password-qa-agent',
      now: changedAt,
    })

    const after = await client.user.findUnique({ where: { id: currentUser.id }, select: { passwordHash: true } })
    assert.ok(after)
    assert.notEqual(after.passwordHash, before.passwordHash)
    assert.equal((await verifyPassword(currentNewPassword, after.passwordHash)).valid, true)
    assert.equal((await verifyPassword(currentOldPassword, after.passwordHash)).valid, false)
    assert.equal(await client.onlineSession.count({ where: { userId: currentUser.id } }), 0)
    const mobile = await client.mobileAuthSession.findUnique({ where: { id: currentSessions.mobileId }, select: { revokedAt: true } })
    assert.ok(mobile?.revokedAt)
    assert.equal(await getCurrentUserFromSessionToken(webSession), null)

    const log = await client.accountSecurityLog.findFirst({
      where: { userId: currentUser.id, action: 'PASSWORD_CHANGED_WITH_CURRENT_PASSWORD' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    })
    assert.deepEqual(log?.metadata, { method: 'CURRENT_PASSWORD' })
  })

  const answerUserPassword = makePassword('answer-user')
  const answerUser = await createUser('security-answer', answerUserPassword)
  const currentAnswer = makeAnswer('pbkdf2')
  const legacyAnswer = makeAnswer('legacy-bcrypt')
  await client.userSecurityQuestion.create({
    data: {
      userId: answerUser.id,
      question: 'Synthetic QA question: first rehearsal city?',
      answerHash: await hashPassword(currentAnswer),
      sortOrder: 1,
    },
  })
  const legacyAnswerUser = await createUser('legacy-security-answer', makePassword('legacy-user'))
  await client.userSecurityQuestion.create({
    data: {
      userId: legacyAnswerUser.id,
      question: 'Synthetic QA question: legacy fixture?',
      answerHash: await bcrypt.hash(legacyAnswer, 4),
      sortOrder: 1,
    },
  })

  let recoveryTokenId
  await runCase('persisted-pbkdf2-and-legacy-bcrypt-security-answers', passedCases, async () => {
    const currentQuestion = await client.userSecurityQuestion.findUnique({ where: { userId: answerUser.id }, select: { sortOrder: true, answerHash: true } })
    const legacyQuestion = await client.userSecurityQuestion.findUnique({ where: { userId: legacyAnswerUser.id }, select: { sortOrder: true, answerHash: true } })
    assert.ok(currentQuestion && legacyQuestion)
    assert.equal(await verifySecurityAnswers([currentQuestion], [{ answer: currentAnswer }]), true)
    assert.equal(await verifySecurityAnswers([legacyQuestion], [{ answer: legacyAnswer }]), true)
    assert.equal(await verifySecurityAnswers([currentQuestion], [{ answer: makeAnswer('wrong') }]), false)
    assert.equal(await client.passwordResetToken.count({ where: { userId: answerUser.id } }), 0)
    recoveryTokenId = await createResetToken(answerUser.id, 'valid')
  })

  const recoveryUser = answerUser
  const recoveryOldPassword = answerUserPassword
  const recoveryNewPassword = makePassword('recovery-new')
  const recoveryNewHash = await bcrypt.hash(recoveryNewPassword, 4)
  const expiredTokenId = await createResetToken(recoveryUser.id, 'expired', new Date(Date.now() - 60_000))
  const wrongIdentityTokenId = await createResetToken(recoveryUser.id, 'wrong-identity')
  const recoverySessions = await createSessions(recoveryUser)
  const recoveryWebSession = await createSessionToken({
    id: recoveryUser.id,
    uid: recoveryUser.uid,
    username: recoveryUser.username,
    nickname: recoveryUser.nickname,
    role: 'USER',
  })
  const unrelatedUser = await createUser('identity-mismatch', makePassword('identity-user'))

  await runCase('recovery-expiry-user-binding-consumption-replay-and-answer-rejection', passedCases, async () => {
    const question = await client.userSecurityQuestion.findUnique({ where: { userId: answerUser.id }, select: { sortOrder: true, answerHash: true } })
    assert.ok(question)
    assert.equal(await verifySecurityAnswers([question], [{ answer: makeAnswer('wrong-recovery-answer') }]), false)

    const expired = await client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, resetInput({
      tokenId: expiredTokenId,
      user: recoveryUser,
      newPassword: unusedRejectedHash,
    })))
    assert.equal(expired, false)
    const tamperedIdentity = await client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, resetInput({
      tokenId: wrongIdentityTokenId,
      user: unrelatedUser,
      newPassword: unusedRejectedHash,
    })))
    assert.equal(tamperedIdentity, false)
    const tamperedTokenId = await client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, resetInput({
      tokenId: `${recoveryTokenId}-tampered`,
      user: recoveryUser,
      newPassword: unusedRejectedHash,
    })))
    assert.equal(tamperedTokenId, false)

    const unchanged = await client.user.findUnique({ where: { id: recoveryUser.id }, select: { passwordHash: true } })
    assert.equal(unchanged?.passwordHash, recoveryUser.passwordHash)
    assert.equal((await client.user.findUnique({ where: { id: unrelatedUser.id }, select: { passwordHash: true } }))?.passwordHash, unrelatedUser.passwordHash)
    assert.equal((await client.passwordResetToken.findUnique({ where: { id: expiredTokenId }, select: { consumedAt: true } }))?.consumedAt, null)
    assert.equal((await client.passwordResetToken.findUnique({ where: { id: wrongIdentityTokenId }, select: { consumedAt: true } }))?.consumedAt, null)
    assert.equal((await client.passwordResetToken.findUnique({ where: { id: recoveryTokenId }, select: { consumedAt: true } }))?.consumedAt, null)

    await issueDelay()
    const committed = await client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, {
      ...resetInput({ tokenId: recoveryTokenId, user: recoveryUser, newPassword: recoveryNewHash, now: new Date(Date.now() + 1_000) }),
    }), { timeout: 15_000, maxWait: 5_000 })
    assert.equal(committed, true)
    const after = await client.user.findUnique({ where: { id: recoveryUser.id }, select: { passwordHash: true } })
    assert.ok(after)
    assert.equal((await verifyPassword(recoveryNewPassword, after.passwordHash)).valid, true)
    assert.equal((await verifyPassword(recoveryOldPassword, after.passwordHash)).valid, false)
    assert.ok((await client.passwordResetToken.findUnique({ where: { id: recoveryTokenId }, select: { consumedAt: true } }))?.consumedAt)
    assert.equal(await client.onlineSession.count({ where: { userId: recoveryUser.id } }), 0)
    assert.ok((await client.mobileAuthSession.findUnique({ where: { id: recoverySessions.mobileId }, select: { revokedAt: true } }))?.revokedAt)
    assert.equal(await getCurrentUserFromSessionToken(recoveryWebSession), null)

    const replay = await client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, {
      ...resetInput({ tokenId: recoveryTokenId, user: recoveryUser, newPassword: unusedRejectedHash }),
    }))
    assert.equal(replay, false)
  })

  const sameTokenUser = await createUser('same-token-concurrency', makePassword('same-token-old'))
  const sameTokenId = await createResetToken(sameTokenUser.id, 'same-token-race')
  const sameTokenHashes = await Promise.all([bcrypt.hash(makePassword('race-a'), 4), bcrypt.hash(makePassword('race-b'), 4)])

  await runCase('same-recovery-authorization-concurrency-single-winner', passedCases, async () => {
    const outcomes = await Promise.allSettled(sameTokenHashes.map((passwordHash) => client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, {
      ...resetInput({ tokenId: sameTokenId, user: sameTokenUser, newPassword: passwordHash }),
    }), { timeout: 15_000, maxWait: 5_000 })))
    const successes = outcomes.filter((item) => item.status === 'fulfilled' && item.value === true)
    assert.equal(successes.length, 1)
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled' && item.value === false).length, 1)
    const token = await client.passwordResetToken.findUnique({ where: { id: sameTokenId }, select: { consumedAt: true } })
    assert.ok(token?.consumedAt)
    const current = await client.user.findUnique({ where: { id: sameTokenUser.id }, select: { passwordHash: true } })
    assert.ok(current && sameTokenHashes.includes(current.passwordHash))
    assert.equal(await client.accountSecurityLog.count({ where: { userId: sameTokenUser.id, action: 'PASSWORD_RESET_SUCCEEDED' } }), 1)
  })

  const casUser = await createUser('cas-concurrency', makePassword('cas-old'))
  const casTokenA = await createResetToken(casUser.id, 'cas-a')
  const casTokenB = await createResetToken(casUser.id, 'cas-b')
  const casHashes = await Promise.all([bcrypt.hash(makePassword('cas-a'), 4), bcrypt.hash(makePassword('cas-b'), 4)])

  await runCase('concurrent-recovery-cas-and-token-rollback', passedCases, async () => {
    const outcomes = await Promise.allSettled([
      client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, { ...resetInput({ tokenId: casTokenA, user: casUser, newPassword: casHashes[0] }) }), { timeout: 15_000, maxWait: 5_000 }),
      client.$transaction((tx) => consumeResetTokenAndChangePassword(tx, { ...resetInput({ tokenId: casTokenB, user: casUser, newPassword: casHashes[1] }) }), { timeout: 15_000, maxWait: 5_000 }),
    ])
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled' && item.value === true).length, 1)
    assert.equal(outcomes.filter((item) => item.status === 'rejected' && item.reason instanceof PasswordChangeConflictError).length, 1)
    const tokens = await client.passwordResetToken.findMany({ where: { id: { in: [casTokenA, casTokenB] } }, select: { consumedAt: true } })
    assert.equal(tokens.filter((item) => item.consumedAt).length, 1)
    assert.equal(await client.accountSecurityLog.count({ where: { userId: casUser.id, action: 'PASSWORD_RESET_SUCCEEDED' } }), 1)
    const finalUser = await client.user.findUnique({ where: { id: casUser.id }, select: { passwordHash: true } })
    assert.ok(finalUser && casHashes.includes(finalUser.passwordHash))
  })

  const rollbackUser = await createUser('rollback', makePassword('rollback-old'))
  const rollbackTokenId = await createResetToken(rollbackUser.id, 'rollback')
  const rollbackSessions = await createSessions(rollbackUser)
  const rollbackNewHash = await bcrypt.hash(makePassword('rollback-new'), 4)

  await runCase('failed-transaction-fully-rolls-back', passedCases, async () => {
    await assert.rejects(client.$transaction(async (tx) => {
      const consumed = await consumeResetTokenAndChangePassword(tx, {
        ...resetInput({ tokenId: rollbackTokenId, user: rollbackUser, newPassword: rollbackNewHash }),
      })
      assert.equal(consumed, true)
      throw new Error('synthetic rollback marker')
    }, { timeout: 15_000, maxWait: 5_000 }), /synthetic rollback marker/u)

    assert.equal((await client.user.findUnique({ where: { id: rollbackUser.id }, select: { passwordHash: true } }))?.passwordHash, rollbackUser.passwordHash)
    assert.equal((await client.passwordResetToken.findUnique({ where: { id: rollbackTokenId }, select: { consumedAt: true } }))?.consumedAt, null)
    assert.equal(await client.onlineSession.count({ where: { userId: rollbackUser.id } }), 1)
    assert.equal((await client.mobileAuthSession.findUnique({ where: { id: rollbackSessions.mobileId }, select: { revokedAt: true } }))?.revokedAt, null)
    assert.equal(await client.accountSecurityLog.count({ where: { userId: rollbackUser.id } }), 0)
  })

  const admin = await createUser('admin-actor', makePassword('admin'), 'SUPER_ADMIN')
  const adminTarget = await createUser('admin-target', makePassword('admin-target-old'))
  const adminSessions = await createSessions(adminTarget)
  const adminWebSession = await createSessionToken({
    id: adminTarget.id,
    uid: adminTarget.uid,
    username: adminTarget.username,
    nickname: adminTarget.nickname,
    role: 'USER',
  })
  const adminTargetNewPassword = makePassword('admin-target-new')
  const adminTargetNewHash = await bcrypt.hash(adminTargetNewPassword, 4)

  await runCase('admin-reset-shares-password-session-and-audit-transaction', passedCases, async () => {
    await issueDelay()
    await client.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: adminTarget.id }, select: { id: true, passwordHash: true } })
      assert.ok(target)
      await commitPasswordChange(tx, {
        userId: target.id,
        expectedPasswordHash: target.passwordHash,
        passwordHash: adminTargetNewHash,
        mustSetupSecurity: true,
        action: 'PASSWORD_RESET_BY_ADMIN',
        method: 'ADMIN_RESET',
        ipAddress: '198.51.100.24',
        userAgent: 'synthetic-password-qa-admin-agent',
        now: new Date(Date.now() + 1_000),
      })
      await tx.adminActionLog.create({
        data: { adminId: admin.id, targetUserId: adminTarget.id, action: 'RESET_USER_PASSWORD', detail: { mustSetupSecurity: true } },
      })
    }, { timeout: 15_000, maxWait: 5_000 })

    const updated = await client.user.findUnique({ where: { id: adminTarget.id }, select: { passwordHash: true, mustSetupSecurity: true } })
    assert.ok(updated?.mustSetupSecurity)
    assert.equal((await verifyPassword(adminTargetNewPassword, updated.passwordHash)).valid, true)
    assert.equal(await client.onlineSession.count({ where: { userId: adminTarget.id } }), 0)
    assert.ok((await client.mobileAuthSession.findUnique({ where: { id: adminSessions.mobileId }, select: { revokedAt: true } }))?.revokedAt)
    assert.equal(await getCurrentUserFromSessionToken(adminWebSession), null)
    assert.equal(await client.accountSecurityLog.count({ where: { userId: adminTarget.id, action: 'PASSWORD_RESET_BY_ADMIN' } }), 1)
    assert.equal(await client.adminActionLog.count({ where: { adminId: admin.id, targetUserId: adminTarget.id, action: 'RESET_USER_PASSWORD' } }), 1)
  })

  await runCase('audit-redaction-and-synthetic-user-ledger-isolation', passedCases, async () => {
    const userIds = users.map((user) => user.id)
    const logs = await client.accountSecurityLog.findMany({ where: { userId: { in: userIds } }, select: { userId: true, action: true, ipAddress: true, userAgent: true, metadata: true } })
    assert.ok(logs.length > 0)
    for (const log of logs) {
      assert.ok(log.metadata && typeof log.metadata === 'object')
      assert.deepEqual(Object.keys(log.metadata).sort(), ['method'])
      const serialized = JSON.stringify(log)
      assert.doesNotMatch(serialized, /qa-password-|qa-answer-|synthetic-token-|synthetic-refresh-|raw-exception|connectionString|DATABASE_URL/u)
    }

    const pointLogs = await client.pointLog.count({ where: { userId: { in: userIds } } })
    assert.equal(pointLogs, 0)
    const userPoints = await client.user.findMany({ where: { id: { in: userIds } }, select: { points: true } })
    assert.ok(userPoints.every((user) => user.points === 0))
  })

  return Object.freeze({
    passedCases: Object.freeze([...passedCases]),
    retainedSyntheticUsers: users.length,
    databaseCleanup: 'NOT_PERFORMED',
  })
  } finally {
    // auth/account-security import the application singleton. Disconnect that
    // QA-targeted pool as well as the runner-owned client after acceptance.
    try {
      const { prisma } = await import('../lib/prisma.ts')
      await prisma.$disconnect()
    } catch {
      // Do not expose connection or datasource details during cleanup.
    }
  }
}
