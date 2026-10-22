import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describePasswordRecoveryError } from '../lib/password-recovery-errors'
import { buildSecurityQuestionChallengeResponse, maskSecurityQuestion } from '../lib/password-recovery-question'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('公开找回链路返回安全的结构化错误，而不是把服务端异常暴露给用户', () => {
  const request = source('app/api/auth/password/request/route.ts')
  const linkReset = source('app/api/auth/password/reset/route.ts')
  const securityReset = source('app/api/auth/forgot-password/reset/route.ts')
  const securityVerify = source('app/api/auth/forgot-password/security/verify/route.ts')

  assert.match(request, /EMAIL_PASSWORD_RECOVERY_DISABLED/)
  assert.match(linkReset, /EMAIL_PASSWORD_RECOVERY_DISABLED/)
  assert.match(securityReset, /PASSWORD_RESET_FAILED/)
  assert.match(securityReset, /RESET_TOKEN_USED/)
  assert.match(securityVerify, /RESET_CHALLENGE_INVALID/)
  assert.match(securityVerify, /密保答案不正确/)
  assert.match(securityReset, /validateNewPassword\(password, confirmPassword\)/)
  assert.doesNotMatch(linkReset, /validateNewPassword/)
})

test('找回页面会显示字段错误并在网络异常后恢复提交状态', () => {
  const publicForm = source('app/forgot-password/ForgotPasswordForm.tsx')
  const linkForm = source('app/forgot-password/EmailPasswordLinkForm.tsx')
  const resetForm = source('app/reset-password/ResetPasswordForm.tsx')

  assert.match(publicForm, /setFieldErrors\(nextFieldErrors\)/)
  assert.match(publicForm, /catch \{\s*setError\('网络连接失败，请稍后再试'\)/)
  assert.match(publicForm, /finally \{\s*setBusy\(false\)/)
  assert.match(publicForm, /fieldError\('answer'\)/)
  assert.match(publicForm, /fieldError\('password'\)/)
  assert.match(linkForm, /data\.errors\?\.email/)
  assert.match(resetForm, /fieldErrors\.confirmPassword/)
  const forgotPage = source('app/forgot-password/page.tsx')
  const resetPage = source('app/reset-password/page.tsx')
  assert.doesNotMatch(forgotPage, /EmailPasswordLinkForm|emailEnabled|邮箱验证码/)
  assert.doesNotMatch(resetPage, /ResetPasswordForm/)
})

test('公开密保找回页面在深色面板上保持文字和输入对比度', () => {
  const forgotPage = source('app/forgot-password/page.tsx')
  const form = source('app/forgot-password/ForgotPasswordForm.tsx')

  assert.match(forgotPage, /密保问题找回<\/h2>/)
  assert.match(forgotPage, /<h2 className="[^"]*text-white[^"]*">密保问题找回/)
  assert.match(forgotPage, /<p className="[^"]*text-slate-200[^"]*">使用设置账号时保存的密保答案[\s\S]*仅显示部分密保问题/)
  assert.match(form, /text-sm font-black text-slate-100">账号/)
  assert.match(form, /text-sm font-black text-slate-100">密保答案/)
  assert.match(form, /text-slate-950 caret-slate-950 outline-none placeholder:text-slate-500 selection:bg-sky-200 selection:text-slate-950/)
  assert.match(form, /disabled:bg-slate-600 disabled:text-slate-100 disabled:opacity-100/)
})

test('实际密保重置表单有两个独立、可访问的密码显隐按钮', () => {
  const form = source('app/forgot-password/ForgotPasswordForm.tsx')

  assert.match(form, /const \[showPassword, setShowPassword\] = useState\(false\)/)
  assert.match(form, /const \[showConfirmPassword, setShowConfirmPassword\] = useState\(false\)/)
  assert.match(form, /type=\{showPassword \? 'text' : 'password'\}/)
  assert.match(form, /type=\{showConfirmPassword \? 'text' : 'password'\}/)
  assert.match(form, /aria-label=\{showPassword \? '隐藏新密码' : '显示新密码'\}/)
  assert.match(form, /aria-label=\{showConfirmPassword \? '隐藏确认密码' : '显示确认密码'\}/)
  assert.match(form, /aria-controls="forgot-reset-new-password"/)
  assert.match(form, /aria-controls="forgot-reset-confirm-password"/)
  assert.match(form, /type="button" aria-label=\{showPassword/)
  assert.match(form, /type="button" aria-label=\{showConfirmPassword/)
  assert.match(form, /setShowPassword\(\(current\) => !current\)/)
  assert.match(form, /setShowConfirmPassword\(\(current\) => !current\)/)
  assert.match(form, /value=\{password\} onChange=/)
  assert.match(form, /value=\{confirmPassword\} onChange=/)
  assert.match(form, /setResetToken\(''\)[\s\S]*setShowPassword\(false\)[\s\S]*setShowConfirmPassword\(false\)/)
})

test('密保问题提示由服务端按 Unicode code point 脱敏并使用固定省略号', () => {
  const cases = [
    ['你小时候最好的朋友叫什么名字？', '你小时候最好的……'],
    ['ABCDEFGHIJ', 'ABCDE……'],
    ['ABCDEFG', 'ABCD……'],
    ['猫狗鱼', '猫……'],
    ['ABCDE', 'AB……'],
    ['你喜欢🍜吗？', '你喜……'],
    ['The best song?', 'The bes……'],
  ] as const

  for (const [question, expected] of cases) {
    const masked = maskSecurityQuestion(question)
    assert.equal(masked, expected)
    assert.notEqual(masked, question)
  }

  const emojiMasked = maskSecurityQuestion('A😀BCDEF')
  assert.equal(emojiMasked, 'A😀BC……')
  for (const character of Array.from(emojiMasked)) {
    const codePoint = character.codePointAt(0) || 0
    assert.equal(codePoint >= 0xd800 && codePoint <= 0xdfff && character.length === 1, false)
  }
  assert.equal(maskSecurityQuestion('ABCD?'), 'A……')
  assert.equal(maskSecurityQuestion('ABCD'), 'A……')
  assert.equal(maskSecurityQuestion('？'), '……')
})

test('挑战响应只在可用账号路径添加 maskedQuestion 且不含其他密保字段', () => {
  const rawQuestion = '你小时候最好的朋友叫什么名字？'
  const available = buildSecurityQuestionChallengeResponse({
    challenge: 'synthetic-challenge',
    message: '如果账号可使用密保找回，请输入你设置的密保答案。',
    genericQuestion: '请输入设置密保时保存的答案',
    question: rawQuestion,
  })
  const serialized = JSON.stringify(available)
  assert.equal(available.maskedQuestion, '你小时候最好的……')
  assert.equal(serialized.includes(rawQuestion), false)
  assert.deepEqual(Object.keys(available).sort(), ['challenge', 'maskedQuestion', 'message', 'questions'])
  assert.deepEqual(available.questions, [{ question: '请输入设置密保时保存的答案', sortOrder: 1 }])
  assert.doesNotMatch(serialized, /answerHash|passwordHash|userId|resetToken|credential|securityQuestionId/i)

  for (const question of [undefined, null]) {
    const generic = buildSecurityQuestionChallengeResponse({
      challenge: 'synthetic-challenge',
      message: '如果账号可使用密保找回，请输入你设置的密保答案。',
      genericQuestion: '请输入设置密保时保存的答案',
      question,
    })
    assert.equal('maskedQuestion' in generic, false)
    assert.doesNotMatch(JSON.stringify(generic), /USER_NOT_FOUND|ACCOUNT_DOES_NOT_EXIST|NO_SECURITY_QUESTION_FOR_THIS_USER/)
  }
})

test('查询接口仅对可用密保账号返回服务端提示，未知或不可用账号保持通用响应', () => {
  const route = source('app/api/auth/forgot-password/security/questions/route.ts')

  assert.match(route, /const genericQuestion = '请输入设置密保时保存的答案'/)
  assert.match(route, /function challengeResponse\(challenge: string, question\?: string \| null\)/)
  assert.match(route, /if \(!user \|\| !availability\.available\) return challengeResponse\(challenge\)/)
  assert.match(route, /return challengeResponse\(challenge, user\.UserSecurityQuestion\?\.question\)/)
  assert.match(route, /UserSecurityQuestion: \{ select: \{ question: true \} \}/)
  assert.doesNotMatch(route, /UserSecurityQuestion: \{ select: \{[^}]*answerHash\s*:/)
  assert.match(route, /buildSecurityQuestionChallengeResponse/)
  assert.match(route, /consumeRateLimitFailClosed\(`ip:\$\{ip\}`,[\s\S]*'password-reset:questions', 12, 15 \* 60/)
  assert.ok(route.indexOf('consumeRateLimitFailClosed') < route.indexOf('prisma.user.findFirst'))
  assert.match(route, /if \(!limit\) return NextResponse\.json\(\{ code: 'PASSWORD_RECOVERY_UNAVAILABLE'/)
  assert.match(route, /if \(limit\.limited\) return NextResponse\.json/)
  assert.doesNotMatch(route, /USER_NOT_FOUND|ACCOUNT_DOES_NOT_EXIST|NO_SECURITY_QUESTION_FOR_THIS_USER/)
})

test('限流存储异常 fail-closed 且 maskedQuestion 不参与答案验证', () => {
  const route = source('app/api/auth/forgot-password/security/questions/route.ts')
  const verifyRoute = source('app/api/auth/forgot-password/security/verify/route.ts')
  const helper = source('lib/password-recovery-question.ts')

  assert.match(route, /consumeRateLimitFailClosed\([^;]+\.catch\(\(\) => null\)/)
  assert.match(route, /if \(!limit\) return NextResponse\.json\(\{ code: 'PASSWORD_RECOVERY_UNAVAILABLE'/)
  assert.match(verifyRoute, /verifySecurityAnswers\(record\.User\.UserSecurityQuestion \? \[record\.User\.UserSecurityQuestion\] : \[\], body\?\.answers\)/)
  assert.doesNotMatch(verifyRoute, /maskedQuestion|maskSecurityQuestion/)
  assert.doesNotMatch(helper, /answerHash|passwordHash|prisma|DATABASE_URL|userId|resetToken/i)
})

test('查询设置、用户或挑战创建异常时保持脱敏的 503 响应', () => {
  const route = source('app/api/auth/forgot-password/security/questions/route.ts')
  assert.equal((route.match(/logPasswordRecoveryError\('\/api\/auth\/forgot-password\/security\/questions', error/g) || []).length, 3)
  assert.equal((route.match(/status: 503, headers: noStoreHeaders/g) || []).length, 4)
  assert.doesNotMatch(route, /error\.message|JSON\.stringify\(error\)|NextResponse\.json\(error/)
})

test('密保提示明确标记有限枚举侧信道并保持 no-store', () => {
  const route = source('app/api/auth/forgot-password/security/questions/route.ts')
  const helper = source('lib/password-recovery-question.ts')
  assert.match(route, /Cache-Control': 'no-store, max-age=0'/)
  assert.match(route, /INTENTIONAL_LIMITED_ENUMERATION_TRADEOFF/)
  assert.match(helper, /INTENTIONAL_LIMITED_ENUMERATION_TRADEOFF/)
})

test('前端只渲染 API 脱敏字段并提供高对比问题提示', () => {
  const form = source('app/forgot-password/ForgotPasswordForm.tsx')
  assert.match(form, /const \[maskedQuestion, setMaskedQuestion\] = useState\(''\)/)
  assert.match(form, /typeof data\.maskedQuestion === 'string' \? data\.maskedQuestion : ''/)
  assert.match(form, /{maskedQuestion \? <div[\s\S]*?密保问题[\s\S]*?{maskedQuestion}[\s\S]*? : null}/)
  assert.match(form, /仅显示部分密保问题/)
  assert.doesNotMatch(form, /data\.question|data\.questions\[|securityQuestion\.question/)
})

test('答案验证仍使用挑战绑定的完整服务端 answerHash 关系', () => {
  const verifyRoute = source('app/api/auth/forgot-password/security/verify/route.ts')
  assert.match(verifyRoute, /UserSecurityQuestion: \{ select: \{ sortOrder: true, answerHash: true \} \}/)
  assert.match(verifyRoute, /verifySecurityAnswers\(record\.User\.UserSecurityQuestion \? \[record\.User\.UserSecurityQuestion\] : \[\], body\?\.answers\)/)
  assert.doesNotMatch(verifyRoute, /questionHint|maskedQuestion|questionPrefix/)
})

test('查询阶段先执行 IP 限流，再访问用户资料', () => {
  const route = source('app/api/auth/forgot-password/security/questions/route.ts')
  const rateLimit = route.indexOf("'password-reset:questions', 12, 15 * 60")
  const userLookup = route.indexOf('prisma.user.findFirst')
  assert.ok(rateLimit >= 0 && userLookup > rateLimit)
  assert.match(route, /if \(limit\.limited\)[\s\S]*?status: 429/)
  assert.match(route, /if \(!limit\)[\s\S]*?status: 503/)
})

test('密码重置成功产生的安全日志会使旧的无状态 JWT 失效', () => {
  const auth = source('lib/auth.ts')
  assert.match(auth, /sessionIssuedAtMs/)
  assert.match(auth, /PASSWORD_RESET_SUCCEEDED/)
  assert.match(auth, /PASSWORD_RESET_WITH_SECURITY_QUESTION/)
  assert.match(auth, /PASSWORD_CHANGED_WITH_CURRENT_PASSWORD/)
  assert.match(auth, /PASSWORD_RESET_BY_ADMIN/)
  assert.match(auth, /hasPasswordInvalidationAfterSessionIssue\(sessionUser\)/)
  assert.match(auth, /createdAt: \{ gt: new Date\(issuedAt\) \}/)
  assert.match(auth, /await hasPasswordInvalidationAfterSessionIssue\(sessionUser\)/)
})

test('密码恢复错误日志会脱敏邮件、token、密码和数据库连接信息', () => {
  const described = describePasswordRecoveryError(Object.assign(
    new Error('email=test@example.com token=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 mysql://root:secret@db.example/app passwordHash=synthetic-hash-placeholder'),
    { code: 'P1001', meta: { passwordHash: 'synthetic-hash-placeholder', connectionString: 'mysql://root:secret@db.example/app' } },
  ))
  assert.equal(described.errorCode, 'P1001')
  const serialized = JSON.stringify(described)
  assert.doesNotMatch(serialized, /test@example\.com|abcdef0123456789|root:secret|passwordHash|synthetic-hash-placeholder/i)
  assert.equal(described.message, 'Password recovery operation failed')
})
