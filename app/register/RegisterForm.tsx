'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FormError } from '@/components/FormError'
import type { RegistrationMode } from '@/lib/registration'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string
      reset: (widgetId?: string) => void
    }
  }
}

type RegisterPolicy = {
  allowRegister: boolean
  registrationMode: RegistrationMode
  registrationModeLabel: string
  allowPhoneRegistration: boolean
  allowEmailRegistration: boolean
  registrationClosed: boolean
  enableTurnstile: boolean
  turnstileSiteKey: string
  envForcedClosed: boolean
  requireSecurityQuestionsForNewUsers: boolean
  ehospitalCheckEnabled: boolean
}

type RegisterErrors = Partial<Record<
  'nickname' | 'phone' | 'password' | 'confirmPassword' | 'email' | 'emailCode' | 'acceptedAgreement' | 'turnstileToken' | 'securityQuestions' | 'hospitalCheck' | 'form',
  string
>>

type HospitalState = {
  sessionId: string
  status: string
  expiresAt: string
  currentPosition: number
  totalQuestions: number
  audioSeconds: number
  score: number
  correctCount: number
  answeredCount: number
  remainingAttempts: number
  question: { questionId: string; audioUrl: string; options: Array<{ key: string; label: string }>; audioSeconds: number } | null
}

type HospitalAnswerResult = {
  questionId: string
  correct: boolean
  scoreEarned: number
  correctAnswer: string
  selectedOptionKey: string
}

type HospitalAnswerResponse = HospitalState & {
  answerResult?: HospitalAnswerResult
  message?: string
}

type PreparedRegistration = {
  token: string
  email: string
  emailVerified: boolean
  hospitalPassed: boolean
}

const errorFieldOrder: Array<keyof RegisterErrors> = [
  'nickname', 'phone', 'password', 'confirmPassword', 'email', 'securityQuestions', 'acceptedAgreement', 'turnstileToken', 'hospitalCheck', 'emailCode', 'form',
]

function unicodeLength(value: string) {
  return Array.from(value).length
}

function makeRequestKey() {
  return typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function logHospitalClient(event: string, details?: unknown) {
  console.info(`[ehospital][client] ${new Date().toISOString()} ${event}`, details ?? {})
}

let registerPageVisitedInDocument = false

export function RegisterForm({ policy }: { policy: RegisterPolicy }) {
  const [form, setForm] = useState({
    nickname: '',
    phone: '',
    password: '',
    confirmPassword: '',
    email: '',
    acceptedAgreement: false,
    securityQuestions: [{ question: '', answer: '' }],
  })
  const [turnstileToken, setTurnstileToken] = useState('')
  const [draftToken, setDraftToken] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [emailEditing, setEmailEditing] = useState(false)
  const [hospitalState, setHospitalState] = useState<HospitalState | null>(null)
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false)
  const [hospitalStage, setHospitalStage] = useState<'intro' | 'quiz'>('intro')
  const [hospitalLoading, setHospitalLoading] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [hasPlayed, setHasPlayed] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [hospitalAnswerResult, setHospitalAnswerResult] = useState<HospitalAnswerResult | null>(null)
  const [hospitalNextState, setHospitalNextState] = useState<HospitalState | null>(null)
  const [errors, setErrors] = useState<RegisterErrors>({})
  const [message, setMessage] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [registrationDetailsExpanded, setRegistrationDetailsExpanded] = useState(true)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const draftTokenRef = useRef('')
  const requestControllerRef = useRef<AbortController | null>(null)
  const idempotencyKeyRef = useRef('')
  const submitLockedRef = useRef(false)
  const mountedRef = useRef(true)
  const automaticEmailKeyRef = useRef('')
  const registrationRestoreInitializedRef = useRef(false)
  const shouldRenderTurnstile = policy.enableTurnstile && Boolean(policy.turnstileSiteKey) && !policy.registrationClosed
  const hospitalPassed = !policy.ehospitalCheckEnabled || hospitalState?.status === 'PASSED'
  const registrationReadyToCollapse = Boolean(draftToken) && hospitalPassed
  const registrationDetailsComplete = Object.keys(validateClientForm(false)).length === 0

  useEffect(() => {
    mountedRef.current = true
    const audio = audioRef.current
    return () => {
      mountedRef.current = false
      requestControllerRef.current?.abort()
      audio?.pause()
    }
  }, [])

  useEffect(() => {
    if (registrationReadyToCollapse) setRegistrationDetailsExpanded(false)
  }, [registrationReadyToCollapse])

  useEffect(() => {
    if (!shouldRenderTurnstile || !turnstileRef.current || widgetIdRef.current) return
    const render = () => {
      if (!window.turnstile || !turnstileRef.current || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: policy.turnstileSiteKey,
        callback: setTurnstileToken,
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      })
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]')
    if (existing) {
      render()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.addEventListener('load', render)
    document.head.appendChild(script)
    return () => script.removeEventListener('load', render)
  }, [policy.turnstileSiteKey, shouldRenderTurnstile])

  function focusFirstError(nextErrors: RegisterErrors) {
    const field = errorFieldOrder.find((key) => nextErrors[key])
    if (!field) return
    document.querySelector<HTMLElement>(`[data-register-field="${field}"]`)?.focus()
  }

  function updateField(field: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function rememberDraftToken(token: string, source: string) {
    draftTokenRef.current = token
    setDraftToken(token)
    logHospitalClient('draftToken value exists', { source, exists: Boolean(token) })
  }

  function clearRegistrationDraftToken() {
    draftTokenRef.current = ''
    setDraftToken('')
    try {
      window.sessionStorage.removeItem('eason.register.draftToken')
      window.sessionStorage.removeItem('eason.register.hospitalSessionId')
    } catch { /* optional */ }
    logHospitalClient('registration draft token cleared', { reason: 'expired-or-not-found' })
  }

  function updateSecurityQuestion(field: 'question' | 'answer', value: string) {
    setForm((current) => ({ ...current, securityQuestions: [{ ...current.securityQuestions[0], [field]: value }] }))
    setErrors((current) => ({ ...current, securityQuestions: undefined }))
  }

  function validateClientForm(includeTurnstile = true) {
    const nextErrors: RegisterErrors = {}
    if (!form.nickname.trim() || unicodeLength(form.nickname.trim()) < 2 || unicodeLength(form.nickname.trim()) > 16) nextErrors.nickname = '用户名 / 昵称需要 2-16 个字符'
    if (form.phone.trim() && !/^1\d{10}$/.test(form.phone.trim().replace(/\s+/g, ''))) nextErrors.phone = '请输入 11 位中国大陆手机号，或留空'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim().toLowerCase())) nextErrors.email = '请输入有效邮箱'
    if (!form.password || form.password.length < 8) nextErrors.password = '密码至少需要 8 位'
    if (form.confirmPassword !== form.password) nextErrors.confirmPassword = '两次输入的密码不一致'
    if (!form.acceptedAgreement) nextErrors.acceptedAgreement = '请先勾选用户协议'
    if (policy.requireSecurityQuestionsForNewUsers && (!form.securityQuestions[0].question.trim() || !form.securityQuestions[0].answer.trim())) nextErrors.securityQuestions = '请完整填写密保问题和答案'
    if (includeTurnstile && shouldRenderTurnstile && !turnstileToken) nextErrors.turnstileToken = '请先完成人机验证'
    return nextErrors
  }

  async function prepareRegistration(forceNewDraft = false) {
    const existingDraftToken = forceNewDraft ? '' : draftTokenRef.current || draftToken
    if (existingDraftToken) {
      draftTokenRef.current = existingDraftToken
      if (draftToken !== existingDraftToken) setDraftToken(existingDraftToken)
      logHospitalClient('draftToken value exists', { source: draftTokenRef.current === draftToken ? 'state' : 'ref', exists: true })
      return {
        token: existingDraftToken,
        email: form.email.trim().toLowerCase(),
        emailVerified,
        hospitalPassed,
      } satisfies PreparedRegistration
    }
    setErrors({})
    const clientErrors = validateClientForm()
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      focusFirstError(clientErrors)
      return null
    }

    setIsPreparing(true)
    const controller = new AbortController()
    requestControllerRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch('/api/auth/register/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeRequestKey() },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ ...form, registrationType: 'EMAIL', turnstileToken }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const nextErrors = { form: data.message || '注册资料保存失败', ...data.errors }
        setErrors(nextErrors)
        focusFirstError(nextErrors)
        return null
      }
      const token = String(data.registrationToken || '')
      rememberDraftToken(token, 'prepareRegistration')
      logHospitalClient('draft created', { exists: Boolean(token), expiresAt: data.expiresAt || null })
      const recoveredHospitalPassed = data.hospital?.status === 'PASSED'
      const recoveredEmailVerified = Boolean(data.emailVerified)
      const preparedEmail = String(data.draft?.email || data.email || form.email).trim().toLowerCase()
      setEmailVerified(recoveredEmailVerified)
      setEmailCodeSent(recoveredEmailVerified)
      if (data.draft) {
        setForm((current) => ({
          ...current,
          nickname: data.draft.nickname || current.nickname,
          phone: data.draft.phone || current.phone,
          email: preparedEmail,
          acceptedAgreement: typeof data.draft.acceptedAgreement === 'boolean' ? data.draft.acceptedAgreement : current.acceptedAgreement,
        }))
      }
      if (recoveredHospitalPassed) {
        const score = Number(data.hospital.score || 0)
        setHospitalState({
          sessionId: data.hospital.sessionId,
          status: 'PASSED',
          expiresAt: data.hospital.expiresAt,
          currentPosition: 10,
          totalQuestions: 10,
          audioSeconds: 7,
          score,
          correctCount: Math.floor(score / 10),
          answeredCount: 10,
          remainingAttempts: 0,
          question: null,
        })
        setHospitalStage('intro')
        setHospitalModalOpen(false)
        try { window.sessionStorage.setItem('eason.register.hospitalSessionId', data.hospital.sessionId) } catch { /* optional */ }
      }
      setMessage(data.message || '注册资料已保存')
      try { window.sessionStorage.setItem('eason.register.draftToken', token) } catch { /* optional */ }
      window.turnstile?.reset(widgetIdRef.current)
      setTurnstileToken('')
      return token ? {
        token,
        email: preparedEmail,
        emailVerified: recoveredEmailVerified,
        hospitalPassed: recoveredHospitalPassed,
      } satisfies PreparedRegistration : null
    } catch (error) {
      setErrors({ form: error instanceof Error && error.name === 'AbortError' ? '请求超时，请稍后重试' : '网络连接失败，请稍后重试' })
      return null
    } finally {
      window.clearTimeout(timeoutId)
      requestControllerRef.current = null
      logHospitalClient('prepareRegistration cleanup; clear isPreparing', { mounted: mountedRef.current })
      if (mountedRef.current) setIsPreparing(false)
    }
  }

  async function sendEmailCode(token = draftToken, emailOverride = form.email, automatic = false) {
    const email = emailOverride.trim().toLowerCase()
    if (!token) {
      setErrors({ form: '请先完成注册资料并开始 E院体检' })
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors({ email: '请输入有效邮箱' })
      return false
    }
    const automaticKey = `${token}:${email}`
    if (automatic && automaticEmailKeyRef.current === automaticKey) return false
    if (automatic) automaticEmailKeyRef.current = automaticKey
    setIsSendingEmail(true)
    setErrors((current) => ({ ...current, email: undefined, emailCode: undefined, form: undefined }))
    try {
      const response = await fetch('/api/auth/register/send-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ registrationToken: token, email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (automatic) automaticEmailKeyRef.current = ''
        const nextErrors = { form: data.message || '邮箱验证码发送失败', ...data.errors }
        setErrors(nextErrors)
        return false
      }
      setForm((current) => ({ ...current, email: data.email || email }))
      setEmailCodeSent(true)
      setEmailVerified(Boolean(data.emailVerified))
      setEmailCode('')
      setEmailEditing(false)
      setMessage(data.message || `验证码已发送至：${data.email || email}`)
      return true
    } catch {
      if (automatic) automaticEmailKeyRef.current = ''
      setErrors({ form: '网络连接失败，请稍后重试' })
      return false
    } finally {
      if (mountedRef.current) setIsSendingEmail(false)
    }
  }

  async function startHospitalCheck() {
    logHospitalClient('start hospital check clicked')
    const clientErrors = validateClientForm()
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      focusFirstError(clientErrors)
      return
    }
    setErrors({})
    setHospitalLoading(true)
    try {
      const preparation = await prepareRegistration()
      const token = preparation?.token || ''
      logHospitalClient('start hospital check token check', { exists: Boolean(token), refExists: Boolean(draftTokenRef.current) })
      if (!preparation) return
      if (preparation.hospitalPassed) {
        if (!preparation.emailVerified) await sendEmailCode(token, preparation.email, true)
        return
      }
      if (!policy.ehospitalCheckEnabled) {
        await sendEmailCode(token, form.email, true)
        return
      }
      setSelectedAnswer('')
      setHospitalAnswerResult(null)
      setHospitalNextState(null)
      setHospitalStage('intro')
      setHospitalModalOpen(true)
    } finally {
      logHospitalClient('start hospital check cleanup; clear hospitalLoading', { mounted: mountedRef.current })
      if (mountedRef.current) setHospitalLoading(false)
    }
  }

  async function beginHospitalQuiz(retryCount = 0) {
    const registrationToken = draftTokenRef.current || draftToken
    logHospitalClient('beginHospitalQuiz token check', {
      stateExists: Boolean(draftToken),
      refExists: Boolean(draftTokenRef.current),
      exists: Boolean(registrationToken),
    })
    if (!registrationToken) {
      logHospitalClient('begin hospital quiz skipped; registration token missing')
      setErrors({ hospitalCheck: '注册验证已过期，请重新点击开始体检' })
      return
    }
    setHospitalLoading(true)
    const fetchStartedAt = Date.now()
    logHospitalClient('hospital-check fetch started', { endpoint: '/api/auth/hospital-check' })
    setErrors((current) => ({ ...current, hospitalCheck: undefined }))
    try {
      const response = await fetch('/api/auth/hospital-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ registrationToken }),
      })
      logHospitalClient('hospital-check fetch ended', { elapsedMs: Date.now() - fetchStartedAt })
      logHospitalClient('hospital-check response status', { status: response.status, ok: response.ok })
      const data = await response.json().catch(() => ({}))
      logHospitalClient('hospital-check response json', data)
      if (!response.ok) {
        if (response.status === 410 || data.code === 'REGISTRATION_DRAFT_EXPIRED' || data.code === 'REGISTRATION_DRAFT_NOT_FOUND') {
          clearRegistrationDraftToken()
          setHospitalState(null)
          setHospitalStage('intro')

          const refreshed = await prepareRegistration(true)
          if (!refreshed || retryCount >= 1) {
            setHospitalModalOpen(false)
            setErrors({ hospitalCheck: '注册验证已过期，请重新点击开始体检' })
            return
          }

          if (refreshed.hospitalPassed) {
            setHospitalModalOpen(false)
            if (!refreshed.emailVerified) await sendEmailCode(refreshed.token, refreshed.email, true)
            return
          }

          setHospitalModalOpen(true)
          await beginHospitalQuiz(retryCount + 1)
          return
        }

        setErrors({ hospitalCheck: data.message || '体检暂时无法开始' })
        return
      }
      setHospitalStage('quiz')
      setHospitalState(data)
      setSelectedAnswer('')
      setHospitalAnswerResult(null)
      setHospitalNextState(null)
      try { window.sessionStorage.setItem('eason.register.hospitalSessionId', data.sessionId) } catch { /* optional */ }
    } catch (error) {
      logHospitalClient('hospital-check fetch error', { message: error instanceof Error ? error.message : String(error) })
      logHospitalClient('hospital-check cleanup will clear hospitalLoading', { mounted: mountedRef.current })
      setErrors({ hospitalCheck: '网络连接失败，请稍后重试' })
    } finally {
      if (mountedRef.current) setHospitalLoading(false)
    }
  }

  function playHospitalAudio() {
    if (!hospitalState?.question || !audioRef.current) return
    audioRef.current.src = hospitalState.question.audioUrl
    audioRef.current.currentTime = 0
    setHasPlayed(true)
    void audioRef.current.play().catch(() => setHasPlayed(false))
  }

  async function answerHospitalQuestion() {
    if (!hospitalState?.question || !hasPlayed || answering || hospitalAnswerResult || !selectedAnswer || !draftToken) return
    setAnswering(true)
    try {
      const response = await fetch('/api/auth/hospital-check/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ registrationToken: draftToken, sessionId: hospitalState.sessionId, questionId: hospitalState.question.questionId, optionKey: selectedAnswer }),
      })
      const data = await response.json().catch(() => ({})) as HospitalAnswerResponse
      if (!response.ok) {
        setErrors({ hospitalCheck: data.message || '提交答案失败' })
        return
      }
      if (!data.answerResult) {
        setErrors({ hospitalCheck: '体检结果缺失，请重试本题' })
        return
      }
      setErrors((current) => ({ ...current, hospitalCheck: undefined }))
      setHospitalNextState(data)
      setHospitalAnswerResult(data.answerResult)
    } catch {
      setErrors({ hospitalCheck: '网络连接失败，请稍后重试' })
    } finally {
      if (mountedRef.current) setAnswering(false)
    }
  }

  function advanceHospitalQuestion() {
    if (!hospitalNextState || !hospitalAnswerResult) return
    const nextState = hospitalNextState
    setHospitalNextState(null)
    setHospitalAnswerResult(null)
    setSelectedAnswer('')
    setHospitalState(nextState)
    if (nextState.status === 'PASSED') {
      setHospitalModalOpen(false)
      void sendEmailCode(draftToken, form.email, true)
    }
  }

  async function verifyEmailCode() {
    if (!draftToken) return setErrors({ form: '请先完成注册资料和 E院体检' })
    if (!/^\d{6}$/.test(emailCode.trim())) return setErrors({ emailCode: '请输入 6 位验证码' })
    setErrors({})
    try {
      const response = await fetch('/api/auth/register/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ registrationToken: draftToken, code: emailCode }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrors({ emailCode: data.message || '验证码错误或已过期' })
        return
      }
      setEmailVerified(true)
      setEmailCode('')
      setMessage('邮箱验证通过，正在完成注册…')
      void completeRegistration(true)
    } catch {
      setErrors({ emailCode: '网络连接失败，请稍后重试' })
    }
  }

  async function completeRegistration(afterEmailVerification = false) {
    if (isSubmitting || submitLockedRef.current) return
    if (!draftToken) return setErrors({ form: '请先完成 E院体检' })
    if (!hospitalPassed) return setErrors({ hospitalCheck: '请先完成并通过 E院体检' })
    if (!form.acceptedAgreement) return setErrors({ acceptedAgreement: '请先勾选用户协议' })
    if (!afterEmailVerification && !emailVerified) return setErrors({ emailCode: '请先完成邮箱验证码验证' })

    setErrors({})
    setIsSubmitting(true)
    submitLockedRef.current = true
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = makeRequestKey()
    const controller = new AbortController()
    requestControllerRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKeyRef.current },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ registrationToken: draftToken, registrationType: 'EMAIL', nickname: form.nickname, phone: form.phone, email: form.email, password: form.password, confirmPassword: form.confirmPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!mountedRef.current) return
      if (!response.ok) {
        const nextErrors = { form: data.message || '注册失败', ...data.errors }
        setErrors(nextErrors)
        focusFirstError(nextErrors)
        submitLockedRef.current = false
        return
      }
      setMessage(data.message || '注册成功，正在进入欢迎页')
      try {
        window.sessionStorage.removeItem('eason.register.draftToken')
        window.sessionStorage.removeItem('eason.register.hospitalSessionId')
      } catch { /* optional */ }
      window.setTimeout(() => window.location.assign('/welcome'), 450)
    } catch (error) {
      if (!mountedRef.current) return
      setErrors({ form: error instanceof Error && error.name === 'AbortError' ? '注册请求超时，请稍后重试' : '网络连接失败，请稍后重试' })
      submitLockedRef.current = false
      idempotencyKeyRef.current = ''
    } finally {
      window.clearTimeout(timeoutId)
      requestControllerRef.current = null
      if (mountedRef.current) setIsSubmitting(false)
    }
  }

  async function restoreHospitalSession(registrationToken: string, sessionId: string, retryCount = 0) {
    const endpoint = `/api/auth/hospital-check?registrationToken=${encodeURIComponent(registrationToken)}&sessionId=${encodeURIComponent(sessionId)}`
    setHospitalLoading(true)
    logHospitalClient('hospital-check GET started', {
      endpoint: '/api/auth/hospital-check',
      hasRegistrationToken: Boolean(registrationToken),
      hasSessionId: Boolean(sessionId),
      retryCount,
    })
    try {
      console.log('before hospital GET fetch')
      const response = await fetch(endpoint, { cache: 'no-store' })
      console.log('after hospital GET fetch', {
        status: response.status,
        ok: response.ok,
      })
      logHospitalClient('hospital-check GET response', { status: response.status, ok: response.ok })
      console.log('hospital check token response', { status: response.status, ok: response.ok })
      console.log('before hospital GET response.json')
      const data = await response.json().catch(() => null) as (HospitalState & { message?: string; code?: string }) | null
      logHospitalClient('hospital-check GET response json', data)
      console.log('hospital check response json', data)

      if (!response.ok) {
        if (response.status === 410) {
          clearRegistrationDraftToken()
          setHospitalState(null)
          setHospitalStage('intro')

          const refreshed = await prepareRegistration(true)
          if (!refreshed || retryCount >= 1) {
            setHospitalModalOpen(false)
            setErrors({ hospitalCheck: '注册验证已过期，请重新点击开始体检' })
            return null
          }

          if (refreshed.hospitalPassed) {
            setHospitalModalOpen(false)
            if (!refreshed.emailVerified) await sendEmailCode(refreshed.token, refreshed.email, true)
            return null
          }

          return restoreHospitalSession(refreshed.token, sessionId, retryCount + 1)
        }

        setHospitalModalOpen(false)
        setErrors({ hospitalCheck: data?.message || '体检场次加载失败，请重新点击开始体检' })
        return null
      }

      if (!data) {
        setHospitalModalOpen(false)
        setErrors({ hospitalCheck: '体检场次加载失败，请重新点击开始体检' })
        return null
      }

      if (mountedRef.current) {
        setHospitalStage('intro')
        setHospitalState(data)
        setHospitalModalOpen(true)
      }
      return data
    } catch (error) {
      logHospitalClient('hospital-check GET error', { message: error instanceof Error ? error.message : String(error) })
      if (mountedRef.current) {
        setHospitalModalOpen(false)
        setErrors({ hospitalCheck: error instanceof Error && error.name === 'AbortError' ? '体检场次加载超时，请重新点击开始体检' : '体检场次加载失败，请重新点击开始体检' })
      }
      return null
    } finally {
      if (mountedRef.current) setHospitalLoading(false)
      logHospitalClient('hospital-check GET cleanup; clear hospitalLoading', { mounted: mountedRef.current })
    }
  }

  // Restore only after a hard reload of /register. A later visit in the same
  // document is a new registration flow and must not inherit old state.
  useEffect(() => {
    if (registrationRestoreInitializedRef.current) return
    registrationRestoreInitializedRef.current = true
    const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const initialPathname = navigation?.name ? new URL(navigation.name, window.location.href).pathname : ''
    const isRegisterReload = navigation?.type === 'reload' && initialPathname === '/register'
    const shouldRestore = !registerPageVisitedInDocument && isRegisterReload
    registerPageVisitedInDocument = true

    try {
      const savedToken = window.sessionStorage.getItem('eason.register.draftToken') || ''
      const savedSessionId = window.sessionStorage.getItem('eason.register.hospitalSessionId') || ''
      if (!shouldRestore) {
        if (savedToken || savedSessionId) {
          clearRegistrationDraftToken()
          setHospitalState(null)
          setHospitalStage('intro')
          setHospitalModalOpen(false)
        }
        return
      }
      if (!savedToken) {
        if (savedSessionId) window.sessionStorage.removeItem('eason.register.hospitalSessionId')
        return
      }
      setDraftToken(savedToken)
      draftTokenRef.current = savedToken
      logHospitalClient('draftToken value exists', { source: 'sessionStorage', exists: Boolean(savedToken) })
      void fetch('/api/auth/register/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationToken: savedToken }),
        cache: 'no-store',
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !mountedRef.current) return
        if (data.draft) setForm((current) => ({ ...current, nickname: data.draft.nickname || current.nickname, phone: data.draft.phone || current.phone, email: data.draft.email || current.email, acceptedAgreement: typeof data.draft.acceptedAgreement === 'boolean' ? data.draft.acceptedAgreement : current.acceptedAgreement }))
        setEmailVerified(Boolean(data.emailVerified))
        setEmailCodeSent(Boolean(data.emailVerified))
        if (data.hospital?.status === 'STARTED' && savedSessionId && data.hospital.sessionId === savedSessionId) {
          await restoreHospitalSession(savedToken, savedSessionId)
        } else if (data.hospital?.status === 'PASSED' || data.hospital?.status === 'FAILED') {
          const score = Number(data.hospital.score || 0)
          const summary: HospitalState = {
            sessionId: data.hospital.sessionId,
            status: data.hospital.status,
            expiresAt: data.hospital.expiresAt,
            currentPosition: 10,
            totalQuestions: 10,
            audioSeconds: 7,
            score,
            correctCount: Math.floor(score / 10),
            answeredCount: 10,
            remainingAttempts: 0,
            question: null,
          }
          setHospitalState(summary)
          if (data.hospital.status === 'PASSED' && !data.emailVerified) void sendEmailCode(savedToken, data.draft?.email || '', true)
        } else if (!policy.ehospitalCheckEnabled && !data.emailVerified) {
          void sendEmailCode(savedToken, data.draft?.email || '', true)
        }
      }).catch(() => null)
    } catch {
      // sessionStorage is optional; the server remains the source of truth.
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setHasPlayed(false)
    audioRef.current?.pause()
  }, [hospitalState?.question?.questionId])

  if (policy.registrationClosed || !policy.allowEmailRegistration) {
    return <div className="space-y-3"><div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">网站当前暂未开放邮箱验证注册，请关注后续公告。</div>{policy.envForcedClosed ? <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">注册已被服务器环境变量强制关闭。</p> : null}</div>
  }

  const hospitalLabel = !policy.ehospitalCheckEnabled
    ? '已跳过体检'
    : hospitalState?.status === 'PASSED'
      ? '✅ E院体检已通过'
      : hospitalState?.status === 'FAILED'
        ? '体检未通过'
        : hospitalState?.status === 'STARTED'
          ? '体检进行中'
          : '待体检'

  return (
    <>
      <form className="register-form space-y-3" onSubmit={(event) => { event.preventDefault(); void completeRegistration() }}>
        <div data-register-field="form" tabIndex={-1}><FormError message={errors.form} /></div>

        {registrationReadyToCollapse && !registrationDetailsExpanded ? (
          <section className="rounded-xl border border-emerald-100/40 bg-emerald-50/10 p-3" aria-labelledby="registration-summary-title">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="registration-summary-title" className="text-sm font-black text-white">注册资料已确认</h2>
                <p className="mt-1 text-xs font-bold text-emerald-100">{hospitalLabel}</p>
              </div>
              <button type="button" onClick={() => setRegistrationDetailsExpanded(true)} className="rounded-lg border border-white/30 bg-white px-3 py-2 text-xs font-black text-brand-700">修改资料</button>
            </div>
            <dl className="mt-3 grid gap-2 text-xs font-bold text-white/85 sm:grid-cols-2">
              <div><dt className="text-white/55">用户名</dt><dd className="mt-0.5 truncate">{form.nickname || '—'}</dd></div>
              <div><dt className="text-white/55">邮箱</dt><dd className="mt-0.5 truncate">{form.email || '—'}</dd></div>
            </dl>
          </section>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-sm font-bold text-white">用户名 / 昵称</span><input value={form.nickname} onChange={(event) => updateField('nickname', event.target.value)} data-register-field="nickname" autoComplete="nickname" className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-brand-500/20 focus:ring-4" placeholder="2-16 个字符" /><FormError message={errors.nickname} /></label>
              <label className="block"><span className="text-sm font-bold text-white">手机号 <small className="font-normal text-white/60">（选填）</small></span><input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} type="tel" autoComplete="tel" data-register-field="phone" className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-brand-500/20 focus:ring-4" placeholder="可选，用于登录和找回账号" /><FormError message={errors.phone} /></label>
              <label className="block"><span className="text-sm font-bold text-white">密码</span><input value={form.password} onChange={(event) => updateField('password', event.target.value)} type="password" autoComplete="new-password" data-register-field="password" className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-brand-500/20 focus:ring-4" placeholder="至少 8 位" /><FormError message={errors.password} /></label>
              <label className="block"><span className="text-sm font-bold text-white">确认密码</span><input value={form.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} type="password" autoComplete="new-password" data-register-field="confirmPassword" className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-brand-500/20 focus:ring-4" placeholder="再次输入密码" /><FormError message={errors.confirmPassword} /></label>
              <label className="block sm:col-span-2"><span className="text-sm font-bold text-white">邮箱 <small className="font-normal text-white/60">（必填）</small></span><input value={form.email} onChange={(event) => updateField('email', event.target.value)} type="email" autoComplete="email" data-register-field="email" disabled={emailCodeSent && !emailEditing && !emailVerified} className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-brand-500/20 focus:ring-4 disabled:bg-emerald-50" placeholder="用于最终验证码验证" /><FormError message={errors.email} /></label>
            </div>

            {policy.requireSecurityQuestionsForNewUsers ? <fieldset data-register-field="securityQuestions" tabIndex={-1} className="space-y-2 rounded-xl border border-white/20 bg-white/10 p-3"><p className="text-sm font-black text-white">设置密保问题</p><div className="grid gap-2 sm:grid-cols-2"><input value={form.securityQuestions[0].question} onChange={(event) => updateSecurityQuestion('question', event.target.value)} maxLength={120} className="w-full rounded-lg border border-sky-100 px-3 py-2 text-sm font-bold outline-none" placeholder="密保问题" /><input value={form.securityQuestions[0].answer} onChange={(event) => updateSecurityQuestion('answer', event.target.value)} maxLength={200} autoComplete="off" className="w-full rounded-lg border border-sky-100 px-3 py-2 text-sm font-bold outline-none" placeholder="答案" /></div><FormError message={errors.securityQuestions} /></fieldset> : null}
            {shouldRenderTurnstile ? <div ref={turnstileRef} data-register-field="turnstileToken" tabIndex={-1} className="min-h-[52px]" /> : null}<FormError message={errors.turnstileToken} />
            <label className="flex items-start gap-2 rounded-xl bg-white/10 p-3 text-xs font-bold text-white"><input type="checkbox" checked={form.acceptedAgreement} onChange={(event) => updateField('acceptedAgreement', event.target.checked)} data-register-field="acceptedAgreement" className="mt-1" /><span className="leading-5">我已阅读并同意<Link href="/user-agreement" target="_blank" rel="noopener noreferrer" className="font-black underline underline-offset-2">《私家E院用户协议》</Link>和社区管理规范。</span></label><FormError message={errors.acceptedAgreement} />
          </>
        )}

        <section className="rounded-xl border border-white/25 bg-white/10 p-3" aria-labelledby="ehospital-title">
          <div className="flex items-center justify-between gap-3"><div><h2 id="ehospital-title" className="text-base font-black text-white">🏥 E院体检</h2><p className="mt-1 text-xs font-bold leading-5 text-white/80">为了确认你是真正了解 Eason 的粉丝，注册前需要完成一次 E院体检。</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${hospitalPassed ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-brand-700'}`}>{hospitalLabel}</span></div>
          {policy.ehospitalCheckEnabled ? <><button type="button" onClick={() => void startHospitalCheck()} disabled={hospitalPassed || hospitalLoading || isPreparing || !registrationDetailsComplete} className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-50">{hospitalLoading || isPreparing ? '准备中…' : registrationDetailsComplete && hospitalState?.status === 'STARTED' ? '继续体检' : registrationDetailsComplete && hospitalState?.status === 'FAILED' ? '重新体检' : '开始体检'}</button>{!registrationDetailsComplete ? <p className="mt-2 text-xs font-bold text-amber-200">请填写完整注册信息后开始 E院体检。</p> : null}</> : <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs font-black text-white/80">管理员已关闭 E院体检，本次注册将直接进入邮箱验证。</p>}
          <FormError message={errors.hospitalCheck} />
        </section>

        {draftToken && hospitalPassed ? <section className="rounded-xl border border-emerald-100/40 bg-emerald-50/10 p-3" aria-labelledby="email-check-title">
          <div className="flex items-center justify-between gap-2"><h2 id="email-check-title" className="text-sm font-black text-white">邮箱验证码</h2>{emailVerified ? <span className="text-xs font-black text-emerald-200">✅ 已验证</span> : null}</div>
          {emailCodeSent ? <p className="mt-1 text-xs font-bold text-emerald-100">验证码已发送至：{form.email}</p> : <p className="mt-1 text-xs font-bold text-white/75">体检通过后自动发送验证码。</p>}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input value={form.email} onChange={(event) => updateField('email', event.target.value)} type="email" disabled={emailCodeSent && !emailEditing && !emailVerified} className="min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-emerald-50" placeholder="邮箱地址" /><button type="button" onClick={() => { setEmailEditing(true); setEmailVerified(false); setEmailCodeSent(false); setEmailCode(''); setMessage('请填写新的邮箱后重新发送验证码') }} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-brand-700">修改邮箱</button></div>
          {emailEditing || !emailCodeSent ? <button type="button" onClick={() => void sendEmailCode()} disabled={isSendingEmail} className="mt-2 rounded-full bg-white px-4 py-2 text-xs font-black text-brand-700 disabled:opacity-50">{isSendingEmail ? '发送中…' : emailCodeSent ? '重新发送验证码' : '发送验证码'}</button> : <button type="button" onClick={() => void sendEmailCode()} disabled={isSendingEmail || emailVerified} className="mt-2 rounded-full border border-white/40 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{isSendingEmail ? '发送中…' : '重新发送验证码'}</button>}
          {emailCodeSent && !emailVerified ? <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} data-register-field="emailCode" inputMode="numeric" maxLength={6} className="min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none" placeholder="输入 6 位验证码" /><button type="button" onClick={() => void verifyEmailCode()} className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black text-white">验证并完成注册</button></div> : null}
          <FormError message={errors.emailCode} />
        </section> : null}

        <button type="submit" disabled={isSubmitting || !emailVerified || !form.acceptedAgreement} className="auth-submit-button w-full disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? '注册中…' : emailVerified ? '完成注册' : '完成注册（等待邮箱验证）'}</button>
        {message ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">{message}</p> : null}
      </form>

      {hospitalModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-5" role="dialog" aria-modal="true" aria-labelledby="hospital-modal-title">
          <div className="max-h-[calc(100dvh-24px)] w-[90%] max-w-[480px] overflow-y-auto rounded-md border border-white/10 bg-[#111827] p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:max-h-[90dvh] sm:p-5">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3"><div><p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">Eason 粉丝认证流程</p><h2 id="hospital-modal-title" className="mt-1 text-xl font-black text-white">🏥 E院体检</h2></div><button type="button" onClick={() => setHospitalModalOpen(false)} className="rounded-sm border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-black text-white/65 hover:bg-white/10">关闭</button></div>
            {hospitalStage === 'intro' ? (
              <div className="mt-5 border border-white/10 bg-white/[0.035] p-5 text-white">
                <h3 className="text-xl font-black text-white">欢迎进入E院体检</h3>
                <p className="mt-3 text-sm font-bold leading-7 text-white/80">本次体检共10题：</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-bold leading-6 text-white/75">
                  <li>每题播放7秒歌曲片段</li>
                  <li>根据歌曲选择正确答案</li>
                  <li>答对6题即可通过</li>
                </ul>
                <button type="button" onClick={() => void beginHospitalQuiz()} disabled={hospitalLoading} className="mt-5 w-full rounded-sm border border-white/15 bg-[#1f2937] px-4 py-3 text-sm font-black text-white transition hover:border-blue-300/60 hover:bg-blue-400/10 disabled:opacity-50">
                  {hospitalLoading ? '加载中…' : '我已明白，开始体检'}
                </button>
              </div>
            ) : hospitalState?.status === 'FAILED' ? (
              <div className="mt-5 border border-rose-300/20 bg-rose-950/35 p-5 text-center">
                <p className="text-lg font-black text-rose-100">🏥 体检未通过</p>
                <p className="mt-2 text-sm font-bold leading-6 text-rose-200/80">本次成绩：{hospitalState.correctCount} / {hospitalState.totalQuestions}<br />今日剩余机会：{hospitalState.remainingAttempts}次</p>
                <button type="button" onClick={() => setHospitalModalOpen(false)} className="mt-4 rounded-sm border border-white/15 bg-white/[0.05] px-5 py-2 text-sm font-black text-white hover:bg-white/10">返回注册页</button>
              </div>
            ) : hospitalState?.status === 'PASSED' ? (
              <div className="mt-5 border border-emerald-300/20 bg-emerald-950/35 p-5 text-center">
                <p className="text-lg font-black text-emerald-100">🏥 体检通过</p>
                <p className="mt-2 text-sm font-bold leading-6 text-emerald-200/80">你的音乐听力检查合格。</p>
              </div>
            ) : hospitalState ? (
              <>
                <div className="mt-4 flex items-center justify-between border-b border-white/10 pb-3 text-sm font-black text-white">
                  <span>第{hospitalState.currentPosition}/{hospitalState.totalQuestions}题</span>
                  <span className="text-blue-200">{hospitalState.score}分</span>
                </div>
                <div className="mt-4 border border-white/10 bg-black/20 p-4 text-center">
                  <p className="text-xs font-bold text-white/60">每题播放{hospitalState.audioSeconds}秒歌曲片段 · 单选</p>
                  <div className="ehospital-voice-wave mt-2" aria-label="声纹动画" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
                  <button type="button" onClick={playHospitalAudio} className="mx-auto flex h-14 w-14 items-center justify-center rounded-sm border border-blue-300/60 bg-blue-400/10 text-xl text-blue-100 transition hover:bg-blue-400/20" aria-label="播放歌曲片段">▶</button>
                  <audio ref={audioRef} className="sr-only" onEnded={() => setHasPlayed(true)} />
                </div>
                <p className="mt-3 text-center text-xs font-bold text-white/50">先播放歌曲片段，再选择正确歌曲。</p>
                <div className="mt-3 grid gap-2">
                  {hospitalState.question?.options.map((option, index) => (
                    <button
                      key={option.key}
                      type="button"
                      disabled={!hasPlayed || answering || Boolean(hospitalAnswerResult)}
                      aria-pressed={selectedAnswer === option.key}
                      onClick={() => {
                        if (!hasPlayed || answering || hospitalAnswerResult) return
                        setSelectedAnswer(option.key)
                        setErrors((current) => ({ ...current, hospitalCheck: undefined }))
                      }}
                      className={selectedAnswer === option.key
                        ? 'rounded-sm border border-blue-300/80 bg-blue-400/20 px-3 py-3 text-left text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-40'
                        : 'rounded-sm border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm font-black text-white transition hover:border-blue-300/60 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40'}
                    >
                      <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-sm border border-blue-300/20 bg-blue-400/10 text-xs text-blue-200">{String.fromCharCode(65 + index)}</span>
                      {option.label}
                    </button>
                  ))}
                </div>
                {!hospitalAnswerResult ? (
                  <button type="button" onClick={() => void answerHospitalQuestion()} disabled={!selectedAnswer || answering} className="mt-4 w-full rounded-sm border border-blue-300/60 bg-blue-400/10 px-4 py-3 text-sm font-black text-blue-100 transition hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:opacity-40">
                    {answering ? '提交中…' : '确认答案'}
                  </button>
                ) : (
                  <div className={hospitalAnswerResult.correct
                    ? 'mt-4 border border-emerald-300/30 bg-emerald-950/30 p-4'
                    : 'mt-4 border border-rose-300/30 bg-rose-950/30 p-4'}
                  >
                    <p className={hospitalAnswerResult.correct ? 'text-base font-black text-emerald-100' : 'text-base font-black text-rose-100'}>
                      {hospitalAnswerResult.correct ? '回答正确' : '回答错误'}
                    </p>
                    <p className="mt-1 text-sm font-bold text-white/80">
                      {hospitalAnswerResult.correct ? '获得 ' : '本题获得 '}
                      {hospitalAnswerResult.scoreEarned} 分
                    </p>
                    {!hospitalAnswerResult.correct ? <p className="mt-1 text-sm font-bold text-rose-100/90">正确答案：{hospitalAnswerResult.correctAnswer}</p> : null}
                    <button type="button" onClick={advanceHospitalQuestion} className="mt-4 w-full rounded-sm border border-white/20 bg-white/[0.08] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.14]">
                      {hospitalNextState?.status === 'STARTED' ? '下一题' : '完成体检'}
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
