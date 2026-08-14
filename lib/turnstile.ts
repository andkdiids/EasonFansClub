import { getClientIp } from '@/lib/client-ip'

export async function verifyTurnstileToken(token: unknown, request: Request) {
  const enabled = process.env.ENABLE_TURNSTILE === 'true' || process.env.NEXT_PUBLIC_ENABLE_TURNSTILE === 'true'
  if (!enabled) {
    return { success: true, skipped: true }
  }

  const secret = process.env.TURNSTILE_SECRET_KEY
  const responseToken = typeof token === 'string' ? token.trim() : ''

  if (!secret) {
    return { success: false, message: '人机验证尚未配置，请联系管理员' }
  }

  if (!responseToken) {
    return { success: false, message: '请先完成人机验证' }
  }

  const formData = new FormData()
  formData.append('secret', secret)
  formData.append('response', responseToken)
  const ip = getClientIp(request)
  if (ip !== 'unknown') formData.append('remoteip', ip)

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  })
  const result = await response.json().catch(() => null) as { success?: boolean } | null
  return result?.success ? { success: true } : { success: false, message: '人机验证失败，请重新验证' }
}
