import { normalizePhoneNumber, type PhoneCountryCode } from '@/lib/phone-number'

export type AuthFieldErrors = Partial<{
  username: string
  email: string
  phone: string
  password: string
  nickname: string
  identifier: string
}>

export function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateRegisterInput(input: {
  username: string
  email: string
  phone: string
  phoneCountry?: PhoneCountryCode
  password: string
  nickname: string
}) {
  const errors: AuthFieldErrors = {}

  if (input.username.length < 3) errors.username = '用户名至少需要 3 个字符'
  if (!input.email && !input.phone) errors.email = '邮箱和手机号至少填写一个'
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.email = '邮箱格式不正确'
  }
  if (input.phone && !normalizePhoneNumber(input.phone, input.phoneCountry)) {
    errors.phone = '手机号格式不正确'
  }
  if (input.password.length < 8) errors.password = '密码至少需要 8 位'
  if (!input.nickname) errors.nickname = '请填写昵称'

  return errors
}

export function validateLoginInput(input: { identifier: string; password: string }) {
  const errors: AuthFieldErrors = {}

  if (!input.identifier) errors.identifier = '请输入邮箱、手机号或用户名'
  if (!input.password) errors.password = '请输入密码'

  return errors
}

export function hasErrors(errors: AuthFieldErrors) {
  return Object.keys(errors).length > 0
}
