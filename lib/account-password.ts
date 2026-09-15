export type NewPasswordValidationError = {
  code: 'PASSWORD_REQUIRED' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'PASSWORD_MISMATCH'
  field: 'password' | 'confirmPassword'
  message: string
}

export function getNewPasswordValidationError(password: unknown, confirmPassword: unknown): NewPasswordValidationError | null {
  if (typeof password !== 'string' || typeof confirmPassword !== 'string') {
    return { code: 'PASSWORD_REQUIRED', field: 'password', message: '请输入新密码和确认密码' }
  }
  if (password.length < 8) return { code: 'PASSWORD_TOO_SHORT', field: 'password', message: '新密码至少需要 8 位' }
  if (password.length > 128) return { code: 'PASSWORD_TOO_LONG', field: 'password', message: '新密码不能超过 128 位' }
  if (password !== confirmPassword) return { code: 'PASSWORD_MISMATCH', field: 'confirmPassword', message: '两次输入的新密码不一致' }
  return null
}

export function validateNewPassword(password: unknown, confirmPassword: unknown) {
  return getNewPasswordValidationError(password, confirmPassword)?.message || null
}
