import { formatUid, MAX_UID } from '@/lib/uid'

export type NormalizedAdminUid = { uid: number; formattedUid: string }

export function normalizeAdminUid(value: unknown): NormalizedAdminUid | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{1,5}$/.test(raw)) return null
  const uid = Number(raw)
  if (!Number.isInteger(uid) || uid < 1 || uid > MAX_UID) return null
  return { uid, formattedUid: formatUid(uid) }
}

export function validateAdminResetPassword(password: unknown, confirmPassword: unknown) {
  if (typeof password !== 'string' || typeof confirmPassword !== 'string') return '请输入新密码和确认密码'
  if (password.length < 8) return '新密码至少需要 8 位'
  if (password.length > 128) return '新密码不能超过 128 位'
  if (password !== confirmPassword) return '两次输入的密码不一致'
  return null
}
